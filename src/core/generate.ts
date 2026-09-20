import { assertOutputFile } from "./config.js";
import { collectEnums, renderEnums } from "./enum-generator.js";
import { format } from "prettier";
import type { NormalizedDocument } from "./model.js";
import type {
  GenerationOptions,
  GenerationResult,
  TypeContext,
} from "./generation-model.js";
import { createGenerationPlan } from "./generation-plan.js";
import { renderApiModule } from "./api-generator.js";
import { renderSchemaDeclaration } from "./type-generator.js";

// Pure, in-memory emission. Ownership is final before any file is rendered.
export const generate = async (
  document: NormalizedDocument,
  options: GenerationOptions = {},
  formatFile: (path: string, source: string) => Promise<string> = (
    _path,
    source,
  ) => format(source, { parser: "typescript", endOfLine: "lf" }),
): Promise<GenerationResult> => {
  if (
    options.enum !== undefined &&
    (typeof options.enum !== "object" ||
      options.enum === null ||
      Array.isArray(options.enum) ||
      (options.enum.enabled !== undefined &&
        typeof options.enum.enabled !== "boolean"))
  )
    throw new Error("INVALID_CONFIG: enum.enabled must be boolean");
  const plan = createGenerationPlan(document, options);
  const enums = collectEnums(
    document,
    plan.diagnostics,
    options.enum?.enabled ?? true,
  );
  const files: GenerationResult["files"] = [];
  const names = Object.keys(document.schemas).sort();
  const context: TypeContext = {
    schemas: document.schemas,
    options: { ...options, int64: options.types?.int64 ?? options.int64 },
    diagnostics: plan.diagnostics,
  };
  const fileContext = (owner: string, api = false) => {
    const imports = new Map<string, Set<string>>();
    const reserved = new Set([
      options.requestClient?.mode === "custom"
        ? options.requestClient.identifier!
        : "axios",
      "APIS",
      "Array",
      "Record",
      "Blob",
      "AbortSignal",
      "String",
      "encodeURIComponent",
      ...(plan.modules
        .find((m) => m.name === owner)
        ?.operations.map((op) => "req" + op.name) ?? []),
    ]);
    const aliases = new Map<string, string>();
    const use = (name: string, target: string): string => {
      if (!api && target === owner) return name;
      const path = target === owner ? "./type" : "../" + target + "/type";
      let alias = aliases.get(name);
      if (!alias) {
        alias = name;
        if (api && reserved.has(alias)) {
          alias = "Imported" + name;
          while (reserved.has(alias) || names.includes(alias))
            alias = "_" + alias;
        }
        aliases.set(name, alias);
        reserved.add(alias);
      }
      const symbols = imports.get(path) ?? new Set<string>();
      symbols.add(alias === name ? name : name + " as " + alias);
      imports.set(path, symbols);
      return alias;
    };
    return {
      context: {
        ...context,
        localReference: (name: string) => use(name, owner),
        reference: (name: string) => {
          const target = plan.schemaOwners[name];
          if (!target)
            throw new Error("GRAPH_INCONSISTENCY: missing owner for " + name);
          return use(name, target);
        },
      },
      imports: () =>
        [...imports]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(
            ([path, symbols]) =>
              "import type { " +
              [...symbols].sort().join(", ") +
              " } from " +
              JSON.stringify(path) +
              ";",
          )
          .join("\n"),
    };
  };
  const emit = async (path: string, source: string) => {
    assertOutputFile(path);
    if (
      files.some(
        (file) =>
          file.path.normalize("NFC").toLowerCase() ===
          path.normalize("NFC").toLowerCase(),
      )
    )
      throw new Error("INVALID_OUTPUT_PATH: generated file collision");
    files.push({
      path,
      content: await formatFile(path, source),
    });
  };
  for (const module of plan.modules) {
    const types = fileContext(module.name);
    const apiTypes = fileContext(module.name, true);
    const api = module.operations.length
      ? renderApiModule(module, types.context, options, apiTypes.context)
      : { api: "", types: "" };
    const declarations = module.schemaNames
      .map((name) =>
        renderSchemaDeclaration(name, document.schemas[name]!, types.context),
      )
      .join("\n");
    if (module.operations.length)
      await emit(
        module.name + "/index.ts",
        apiTypes.imports() + "\n" + api.api,
      );
    await emit(
      module.name + "/type.ts",
      types.imports() + "\n" + declarations + "\n" + api.types + "\nexport {};",
    );
  }
  if (plan.sharedSchemaNames.length) {
    const shared = fileContext("_shared");
    const declarations = plan.sharedSchemaNames
      .map((name) =>
        renderSchemaDeclaration(name, document.schemas[name]!, shared.context),
      )
      .join("\n");
    await emit("_shared/type.ts", shared.imports() + "\n" + declarations);
  }
  if (enums.generated)
    await emit(options.enum?.output ?? "_shared/enum.ts", renderEnums(enums));
  if (options.barrel?.enabled) {
    const exports = plan.modules
      .filter((module) => module.operations.length)
      .map(
        (module, index) =>
          "export * as Module" +
          index +
          " from " +
          JSON.stringify("./" + module.name + "/index") +
          ";",
      );
    await emit("index.ts", exports.join("\n") || "export {};");
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  plan.diagnostics = [
    ...new Map(
      plan.diagnostics.map((diagnostic) => [
        JSON.stringify(diagnostic),
        diagnostic,
      ]),
    ).values(),
  ];
  return { plan, files, enums };
};
