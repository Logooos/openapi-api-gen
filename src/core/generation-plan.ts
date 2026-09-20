import { validateConfig } from "./config.js";
import { resolveDocument } from "./module-resolver.js";
import { buildSchemaGraph } from "./schema-graph.js";
import { resolveSchemaOwners } from "./schema-ownership.js";
import { diagnose } from "./diagnostics.js";
import type { NormalizedDocument, NormalizedSchema } from "./model.js";
import type {
  GenerationOptions,
  GenerationPlan,
  PlannedModule,
} from "./generation-model.js";
import {
  binaryResponse,
  identifier,
  operationSchemas,
  pascalCase,
  schemaRefName,
  successfulResponses,
  visitSchema,
} from "./generation-utils.js";

export const createGenerationPlan = (
  document: NormalizedDocument,
  options: GenerationOptions = {},
): GenerationPlan => {
  validateConfig(options);
  const resolved = resolveDocument(document, options);
  document = resolved.document;
  options = {
    ...options,
    schemaOwners: resolved.owners,
    int64: options.types?.int64 ?? options.int64,
  };
  if (
    options.int64 !== undefined &&
    !["number", "string", "bigint"].includes(options.int64)
  )
    throw new Error("INVALID_CONFIG: invalid int64 option");
  if (
    options.ignoredHeaders !== undefined &&
    (!Array.isArray(options.ignoredHeaders) ||
      options.ignoredHeaders.some((name) => typeof name !== "string"))
  )
    throw new Error("INVALID_CONFIG: ignoredHeaders must be string[]");
  const diagnostics = diagnose(document).diagnostics;
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    throw new Error("DUPLICATE_OPERATION_ID: cannot create generation plan");
  const graph = buildSchemaGraph(document);
  const {
    refs,
    closure,
    operationDependencies,
    dependencies: schemaDependencies,
  } = graph;
  const modules = new Map<string, PlannedModule>();
  const modulePaths = new Map<string, string>();
  const deferredOperations: GenerationPlan["deferredOperations"] = [];
  const unsupported = (
    schemas: NormalizedSchema[],
    predicate: (schema: NormalizedSchema) => boolean,
  ): boolean => {
    let found = false;
    for (const schema of [
      ...schemas,
      ...closure(refs(schemas)).map((name) => document.schemas[name]!),
    ])
      visitSchema(schema, (node) => {
        if (predicate(node)) found = true;
      });
    return found;
  };
  const symbolNames = new Map<string, Set<string>>();
  for (const [index, op] of document.operations.entries()) {
    const location = `${op.method.toUpperCase()} ${op.path}`;
    const reasons = new Set<string>();
    const name = pascalCase(op.operationId ?? "");
    const dependencies = operationDependencies[index]!;
    if (op.module !== null) {
      if (
        !op.module ||
        /[<>:"/\\|?*\u0000-\u001f]/.test(op.module) ||
        /[. ]$/.test(op.module) ||
        op.module.normalize("NFC").toLowerCase() === "_shared" ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(op.module)
      )
        throw new Error(`INVALID_OUTPUT_PATH: module ${op.module}`);
      const canonical = op.module.normalize("NFC").toLowerCase();
      const previous = modulePaths.get(canonical);
      if (previous !== undefined && previous !== op.module)
        throw new Error(`MODULE_NAME_COLLISION: ${previous} / ${op.module}`);
      modulePaths.set(canonical, op.module);
    }
    if (resolved.excluded.has(location)) continue;
    if (!op.operationId || !identifier(name))
      reasons.add("INVALID_OPERATION_NAME");
    if (!op.module) reasons.add("MISSING_MODULE");
    if (
      dependencies.some(
        (schema) =>
          !identifier(schema) ||
          ["Record", "Array", "Blob", "AbortSignal"].includes(schema),
      )
    )
      reasons.add("UNSUPPORTED_SCHEMA_NAME");
    const responses = successfulResponses(op);
    if (!responses.length) reasons.add("NO_SUCCESS_RESPONSE");
    const binaryModes = new Set(
      responses.flatMap((r) =>
        Object.entries(r.content)
          .filter(
            ([media, schema]) =>
              schema !== undefined ||
              binaryResponse(media, schema, document.schemas),
          )
          .map(([media, schema]) =>
            binaryResponse(media, schema, document.schemas),
          ),
      ),
    );
    if (binaryModes.size > 1) reasons.add("AMBIGUOUS_RESPONSE_TRANSPORT");
    const bodyMedia = Object.keys(op.requestBody?.content ?? {});
    if (bodyMedia.includes("multipart/form-data"))
      reasons.add("UNSUPPORTED_MULTIPART");
    else if (
      op.requestBody &&
      (bodyMedia.length !== 1 ||
        !/^application\/(?:json|[^;]+\+json)$/.test(bodyMedia[0]!))
    )
      reasons.add("UNSUPPORTED_REQUEST_MEDIA");
    else if (
      unsupported(
        Object.values(op.requestBody?.content ?? {}).filter(
          (s): s is NormalizedSchema => !!s,
        ),
        (s) => s.format === "binary",
      )
    )
      reasons.add("JSON_BINARY_REQUEST");
    if (op.requestBody && ["get", "head"].includes(op.method))
      reasons.add("UNSUPPORTED_METHOD_BODY");
    if (op.cookieParams.length) reasons.add("UNSUPPORTED_COOKIE_PARAMETER");
    const ignored = new Set(
      (options.ignoredHeaders ?? []).map((header) => header.toLowerCase()),
    );
    const parameters = [
      ...op.pathParams,
      ...op.queryParams,
      ...op.headerParams.filter((p) => !ignored.has(p.name.toLowerCase())),
    ];
    if (
      parameters.some(
        (p) =>
          !p.schema ||
          (p.raw.style !== undefined &&
            p.raw.style !== (p.in === "query" ? "form" : "simple")) ||
          (p.raw.explode !== undefined &&
            p.raw.explode !== (p.in === "query")) ||
          p.raw.allowReserved === true ||
          p.schema.ref ||
          p.schema.types.length !== 1 ||
          p.schema.types.some((type) => type === "object") ||
          (p.schema.types.includes("array") &&
            (!p.schema.items ||
              p.schema.items.types.length !== 1 ||
              !["string", "integer", "number", "boolean"].includes(
                p.schema.items.types[0]!,
              ))) ||
          (p.in === "header" &&
            p.schema.format === "int64" &&
            options.int64 === "bigint") ||
          (p.in !== "query" && p.schema.types.includes("array")),
      )
    )
      reasons.add("UNSUPPORTED_PARAMETER_SERIALIZATION");
    const placeholders = [...op.path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    if (
      placeholders.some(
        (param) => !op.pathParams.some((p) => p.name === param),
      ) ||
      op.pathParams.some((p) => !placeholders.includes(p.name))
    )
      throw new Error(`INVALID_PATH_PARAMETER: ${location}`);
    if (
      unsupported(operationSchemas(op), (s) => !!s.ref && !schemaRefName(s.ref))
    )
      reasons.add("UNSUPPORTED_SCHEMA_REF");
    // Pure aliases/compositions can form illegal TS circular aliases; structural recursion is safe.
    const hasAliasCycle = (
      schema: NormalizedSchema,
      trail: Set<string>,
    ): boolean => {
      if (schema.ref) {
        const ref = schemaRefName(schema.ref);
        if (ref && trail.has(ref)) return true;
        if (
          ref &&
          hasAliasCycle(document.schemas[ref]!, new Set([...trail, ref]))
        )
          return true;
      }
      return [
        ...(schema.allOf ?? []),
        ...(schema.oneOf ?? []),
        ...(schema.anyOf ?? []),
      ].some((child) => hasAliasCycle(child, trail));
    };
    if (
      dependencies.some((schema) =>
        hasAliasCycle(document.schemas[schema]!, new Set([schema])),
      )
    )
      reasons.add("UNSUPPORTED_CIRCULAR_ALIAS");
    if (reasons.size) {
      deferredOperations.push({
        operationId: op.operationId,
        location,
        reasons: [...reasons].sort(),
      });
      for (const code of reasons)
        if (code !== "UNSUPPORTED_MULTIPART")
          diagnostics.push({
            severity: "warning",
            code,
            location,
            message: "Operation deferred: " + code + ".",
          });
      continue;
    }
    const module = modules.get(op.module!) ?? {
      name: op.module!,
      operations: [],
      schemaNames: [],
    };
    const symbols = symbolNames.get(module.name) ?? new Set<string>();
    for (const symbol of [
      `req${name}`,
      ...(op.queryParams.length ? [`${name}Params`] : []),
      ...(op.headerParams.some((p) => !ignored.has(p.name.toLowerCase()))
        ? [`${name}Headers`]
        : []),
    ]) {
      if (symbols.has(symbol) || Object.hasOwn(document.schemas, symbol))
        throw new Error(`GENERATED_NAME_COLLISION: ${module.name}/${symbol}`);
      symbols.add(symbol);
    }
    symbolNames.set(module.name, symbols);
    module.operations.push({ operation: op, name, schemaNames: dependencies });
    module.schemaNames = [
      ...new Set([...module.schemaNames, ...dependencies]),
    ].sort();
    modules.set(module.name, module);
  }
  const schemaOwners = resolveSchemaOwners(
    graph,
    new Set(modulePaths.values()),
    options,
  );
  const emitted = new Set(
    [...modules.values()].flatMap((module) => module.schemaNames),
  );
  for (const module of modules.values()) module.schemaNames = [];
  const sharedSchemaNames: string[] = [];
  for (const name of [...emitted].sort()) {
    const owner = schemaOwners[name];
    if (!owner)
      throw new Error("GRAPH_INCONSISTENCY: missing owner for " + name);
    if (owner === "_shared") sharedSchemaNames.push(name);
    else {
      const module = modules.get(owner) ?? {
        name: owner,
        operations: [],
        schemaNames: [],
      };
      module.schemaNames.push(name);
      modules.set(owner, module);
    }
  }
  const plannedModules = [...modules.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const generatedSchemas = emitted.size;
  const unusedSchemas = Object.values(graph.usage).filter(
    (modules) => !modules.length,
  ).length;
  return {
    modules: plannedModules,
    schemaDependencies,
    schemaUsage: graph.usage,
    schemaOwners,
    stronglyConnectedComponents: graph.components,
    sharedSchemas: Object.keys(schemaOwners).filter(
      (name) => schemaOwners[name] === "_shared",
    ),
    sharedSchemaNames,
    excludedOperations: [...resolved.excluded].sort(),
    deferredOperations,
    diagnostics,
    stats: {
      operations: document.operations.length,
      generatedOperations:
        document.operations.length -
        deferredOperations.length -
        resolved.excluded.size,
      deferredOperations: deferredOperations.length,
      modules: plannedModules.length,
      schemas: Object.keys(document.schemas).length,
      generatedSchemas,
      deferredSchemas:
        Object.keys(document.schemas).length - generatedSchemas - unusedSchemas,
      unusedSchemas,
    },
  };
};
