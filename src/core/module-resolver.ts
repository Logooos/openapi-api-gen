import type { NormalizedDocument, NormalizedSchema } from "./model.js";
import type { GeneratorConfig } from "./config.js";
import { normalizeSpec } from "./normalizer.js";
import { diagnose } from "./diagnostics.js";
const matches = (path: string, glob: string): boolean => {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        pattern += "(?:.*/)?";
      } else pattern += ".*";
    } else if (ch === "*") pattern += "[^/]*";
    else if (ch === "?") pattern += "[^/]";
    else pattern += /[a-z0-9/_-]/i.test(ch) ? ch : "\\" + ch;
  }
  return new RegExp("^" + pattern + "$").test(path);
};
const responseSchema = (
  type: string,
  doc: NormalizedDocument,
): NormalizedSchema => {
  const node = (text: string): Record<string, unknown> => {
    const value = text.trim();
    if (value.includes("|")) return { oneOf: value.split("|").map(node) };
    if (value.endsWith("[]"))
      return { type: "array", items: node(value.slice(0, -2)) };
    if (["string", "number", "boolean", "integer"].includes(value))
      return { type: value };
    if (value === "blob") return { type: "string", format: "binary" };
    if (Object.hasOwn(doc.schemas, value))
      return {
        $ref:
          "#/components/schemas/" +
          value.replaceAll("~", "~0").replaceAll("/", "~1"),
      };
    throw new Error(
      "INVALID_CONFIG: responseType must be blob, void, primitive, local schema, array or union",
    );
  };
  return normalizeSpec({
    openapi: doc.version,
    info: { title: "override", version: "1" },
    paths: {},
    components: { schemas: { Value: node(type) } },
  }).schemas.Value!;
};
export const resolveDocument = (
  document: NormalizedDocument,
  config: GeneratorConfig,
) => {
  if (diagnose(document).duplicateOperationIdCount)
    throw new Error(
      "DUPLICATE_OPERATION_ID: cannot override duplicate source ids",
    );
  const ids = new Set(document.operations.map((op) => op.operationId));
  for (const id of Object.keys(config.overrides?.operations ?? {}))
    if (!ids.has(id))
      throw new Error("INVALID_CONFIG: unknown operation override " + id);
  const owners = { ...config.schemaOwners };
  for (const [name, o] of Object.entries(config.overrides?.schemas ?? {}))
    if (o.owner !== undefined) {
      if (owners[name] !== undefined && owners[name] !== o.owner)
        throw new Error(
          "SCHEMA_OWNER_CONFLICT: conflicting explicit owners for " + name,
        );
      owners[name] = o.owner;
    }
  const origins = new Map<string, string>();
  const excluded = new Set<string>();
  const operations = document.operations.map((op) => {
    const o = op.operationId
      ? config.overrides?.operations?.[op.operationId]
      : undefined;
    const tag = op.module;
    const candidates = (
      tag === null ? [] : (config.modules?.[tag] ?? [])
    ).filter(
      (r) =>
        (!r.include || r.include.some((g) => matches(op.path, g))) &&
        !r.exclude?.some((g) => matches(op.path, g)),
    );
    if (candidates.length > 1)
      throw new Error(
        "MODULE_NAME_COLLISION: overlapping path rules for " + op.path,
      );
    const module =
      o?.module ??
      candidates[0]?.name ??
      (tag === null ? null : (config.moduleNames?.[tag] ?? tag));
    if (module !== null && !o?.module) {
      const previous = origins.get(module);
      if (previous !== undefined && previous !== tag)
        throw new Error("MODULE_NAME_COLLISION: tags resolve to " + module);
      origins.set(module, tag ?? "untagged");
    }
    const id = op.operationId;
    if (
      o?.exclude ||
      (id &&
        (config.excludeOperations?.includes(id) ||
          (config.includeOperations && !config.includeOperations.includes(id))))
    )
      excluded.add(op.method.toUpperCase() + " " + op.path);
    const replacement =
      o?.responseType && o.responseType !== "void"
        ? responseSchema(o.responseType, document)
        : undefined;
    const responses = o?.responseType
      ? op.responses.map((r) =>
          /^2(?:\d\d|XX)$/.test(r.status)
            ? {
                ...r,
                content: replacement ? { "application/json": replacement } : {},
              }
            : r,
        )
      : op.responses;
    return { ...op, module, operationId: o?.name ?? id, responses };
  });
  return { document: { ...document, operations }, owners, excluded };
};
