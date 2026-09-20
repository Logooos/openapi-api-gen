import type {
  GenerationOptions,
  PlannedModule,
  TypeContext,
} from "./generation-model.js";
import {
  binaryResponse,
  identifier,
  jsdoc,
  propertyAccess,
  successfulResponses,
} from "./generation-utils.js";
import { renderParameters, renderType, union } from "./type-generator.js";

export const renderApiModule = (
  module: PlannedModule,
  context: TypeContext,
  options: GenerationOptions,
  apiContext: TypeContext = context,
): { api: string; types: string } => {
  const client =
    options.requestClient?.mode === "custom"
      ? options.requestClient.identifier!
      : "axios";
  const importPath =
    options.requestClient?.mode === "custom"
      ? options.requestClient.importPath!
      : "axios";
  const localType = (name: string) => apiContext.localReference?.(name) ?? name;
  const typeDeclarations: string[] = [];
  const declaredTypes = new Set([
    ...module.schemaNames,
    ...module.operations.flatMap((op) => op.schemaNames),
  ]);
  const declare = (name: string, source: string): void => {
    if (declaredTypes.has(name))
      throw new Error(`GENERATED_NAME_COLLISION: ${module.name}/${name}`);
    declaredTypes.add(name);
    typeDeclarations.push(source);
  };
  const functions: string[] = [];
  const paths: string[] = [];
  const ignored = new Set(
    (options.ignoredHeaders ?? []).map((header) => header.toLowerCase()),
  );
  for (const { operation: op, name } of module.operations) {
    if (client === "req" + name)
      throw new Error("GENERATED_NAME_COLLISION: request client");
    const key = name[0]!.toLowerCase() + name.slice(1);
    paths.push(`${JSON.stringify(key)}: ${JSON.stringify(op.path)}`);
    const location = `${op.method.toUpperCase()} ${op.path}`;
    const args: Array<{
      name: string;
      type: string;
      optional: boolean;
      description?: string;
    }> = [];
    const variables = new Map<string, string>();
    const reserved = new Set([
      "params",
      "data",
      "headers",
      "signal",
      "APIS",
      client,
      "Types",
      "String",
      "encodeURIComponent",
    ]);
    for (const [index, parameter] of op.pathParams.entries()) {
      let variable = parameter.name;
      if (
        !identifier(variable) ||
        reserved.has(variable) ||
        /^SchemaRef\d+$/.test(variable)
      )
        variable = `pathParam${index + 1}`;
      while (reserved.has(variable)) variable = `_${variable}`;
      reserved.add(variable);
      variables.set(parameter.name, variable);
      args.push({
        name: variable,
        type: renderType(
          parameter.schema,
          apiContext,
          `${location}.${parameter.name}`,
        ),
        optional: false,
        description: parameter.description,
      });
    }
    if (op.queryParams.length) {
      declare(
        `${name}Params`,
        `export type ${name}Params = ${renderParameters(op.queryParams, context, `${location}.params`)};`,
      );
      args.push({
        name: "params",
        type: localType(name + "Params"),
        optional: !op.queryParams.some((p) => p.required),
      });
    }
    const bodyMedia = Object.keys(op.requestBody?.content ?? {})[0];
    if (op.requestBody)
      args.push({
        name: "data",
        type: renderType(
          op.requestBody.content[bodyMedia!],
          apiContext,
          `${location}.body`,
        ),
        optional: !op.requestBody.required,
        description: op.requestBody.description,
      });
    const headers = op.headerParams.filter(
      (p) => !ignored.has(p.name.toLowerCase()),
    );
    if (headers.length) {
      declare(
        `${name}Headers`,
        `export type ${name}Headers = ${renderParameters(headers, context, `${location}.headers`)};`,
      );
      args.push({
        name: "headers",
        type: localType(name + "Headers"),
        optional: !headers.some((p) => p.required),
      });
    }
    const responses = successfulResponses(op);
    const responseTypes = (typeContext: TypeContext): string[] =>
      responses.flatMap((response) => {
        const entries = Object.entries(response.content);
        return entries.length
          ? entries.map(([media, schema]) =>
              binaryResponse(media, schema, context.schemas)
                ? "Blob"
                : schema
                  ? renderType(
                      schema,
                      typeContext,
                      `${location}.response.${response.status}.${media}`,
                    )
                  : "void",
            )
          : ["void"];
      });
    const localTypes = [
      ...new Set(responseTypes({ ...context, reference: undefined })),
    ];
    let responseType: string;
    if (localTypes.length > 1) {
      declare(
        `${name}Response`,
        `${jsdoc(...responses.map((r) => `${r.status}: ${r.description}`))}export type ${name}Response = ${union(responseTypes(context))};`,
      );
      responseType = localType(name + "Response");
    } else responseType = union(responseTypes(apiContext));
    const config = [op.queryParams.length ? "params" : "", "signal"];
    if (
      op.queryParams.some((parameter) =>
        parameter.schema?.types.includes("array"),
      )
    )
      config.push("paramsSerializer: { indexes: null }");
    const explicitMedia =
      bodyMedia && bodyMedia.toLowerCase() !== "application/json"
        ? bodyMedia
        : undefined;
    if (headers.length || explicitMedia)
      config.push(
        `headers: { ${explicitMedia ? `${JSON.stringify("Content-Type")}: ${JSON.stringify(explicitMedia)},` : ""} ${headers.length ? "...headers" : ""} }`,
      );
    if (
      responses.some((r) =>
        Object.entries(r.content).some(([media, schema]) =>
          binaryResponse(media, schema, context.schemas),
        ),
      )
    )
      config.push('responseType: "blob"');
    let url = propertyAccess("APIS", key);
    for (const match of op.path.matchAll(/\{([^}]+)\}/g))
      url += `.replace(${JSON.stringify(match[0])}, encodeURIComponent(String(${variables.get(match[1]!)})))`;
    let call: string;
    if (["post", "put", "patch"].includes(op.method))
      call = `${client}.${op.method}<${responseType}>(${url}, ${op.requestBody ? "data" : "void 0"}, { ${config.filter(Boolean).join(", ")} })`;
    else {
      if (op.requestBody) config.push("data");
      call =
        op.method === "trace"
          ? `${client}.request<${responseType}>({ method: "trace", url: ${url}, ${config.filter(Boolean).join(", ")} })`
          : `${client}.${op.method}<${responseType}>(${url}, { ${config.filter(Boolean).join(", ")} })`;
    }
    // Indexed access preserves optional-before-required values without a void union.
    const signature = args.map((arg, index) => {
      const laterRequired = args
        .slice(index + 1)
        .some((later) => !later.optional);
      return `${arg.name}${arg.optional && !laterRequired ? "?" : ""}: ${arg.optional && laterRequired ? `{ value?: ${arg.type} }["value"]` : arg.type}`;
    });
    signature.push("signal?: AbortSignal");
    functions.push(
      `${jsdoc(op.summary, op.description, op.deprecated ? "@deprecated" : undefined, ...args.filter((arg) => arg.description).map((arg) => `@param ${arg.name} ${arg.description}`))}export const req${name} = (${signature.join(", ")}) => { return ${call}; };`,
    );
  }
  const code = `export const APIS = { ${paths.join(",\n")} } as const;\n\n${functions.join("\n\n")}`;
  return {
    api: `import ${client} from ${JSON.stringify(importPath)};\n\n${code}\n`,
    types: typeDeclarations.join("\n\n"),
  };
};
