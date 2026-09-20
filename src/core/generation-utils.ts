import type { NormalizedOperation, NormalizedSchema } from "./model.js";

const reserved = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield implements interface package private protected public static abstract any boolean constructor declare infer is keyof module namespace never number object readonly require string symbol type undefined unique unknown as asserts global bigint intrinsic".split(
    " ",
  ),
);
export const identifier = (name: string): boolean =>
  /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name) &&
  !reserved.has(name);
export const propertyAccess = (object: string, key: string): string =>
  /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(key)
    ? object + "." + key
    : object + "[" + JSON.stringify(key) + "]";
export const pascalCase = (id: string): string => {
  const suffix = id.match(/(?:_\d+)+$/)?.[0] ?? "";
  const words = id
    .slice(0, id.length - suffix.length)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}$]+/u)
    .filter(Boolean);
  return (
    words
      .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
      .join("") + suffix
  );
};
export const jsdoc = (...parts: Array<string | undefined>): string => {
  const text = parts
    .filter((part) => part !== undefined && part !== "")
    .join("\n");
  if (text && !/[\r\n]/.test(text))
    return "/** " + text.replaceAll("*/", "* /") + " */\n";
  return text
    ? `/**\n${text
        .replaceAll("*/", "* /")
        .split(/\r?\n/)
        .map((line) => ` * ${line}`)
        .join("\n")}\n */\n`
    : "";
};
export const schemaRefName = (ref: string): string | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    return undefined;
  }
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(decoded);
  return match?.[1]?.replaceAll("~1", "/").replaceAll("~0", "~");
};
export const visitSchema = (
  schema: NormalizedSchema,
  visit: (schema: NormalizedSchema) => void,
): void => {
  visit(schema);
  for (const child of [
    ...Object.values(schema.properties ?? {}),
    schema.items,
    schema.additionalProperties,
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ])
    if (child) visitSchema(child, visit);
};
export const operationSchemas = (op: NormalizedOperation): NormalizedSchema[] =>
  [
    ...[
      ...op.pathParams,
      ...op.queryParams,
      ...op.headerParams,
      ...op.cookieParams,
    ].flatMap((p) => [p.schema, ...Object.values(p.content)]),
    ...Object.values(op.requestBody?.content ?? {}),
    ...op.responses.flatMap((r) => Object.values(r.content)),
  ].filter((schema): schema is NormalizedSchema => schema !== undefined);
export const successfulResponses = (op: NormalizedOperation) =>
  op.responses
    .filter((r) => /^2(?:\d\d|XX)$/.test(r.status))
    .sort((a, b) => (a.status < b.status ? -1 : a.status > b.status ? 1 : 0));
export const binaryResponse = (
  media: string,
  schema: NormalizedSchema | undefined,
  schemas: Record<string, NormalizedSchema>,
): boolean => {
  const base = media.split(";")[0]!.trim().toLowerCase();
  if (
    ["application/octet-stream", "application/pdf", "application/zip"].includes(
      base,
    ) ||
    /^(image|audio|video)\//.test(base)
  )
    return true;
  const seen = new Set<string>();
  while (schema) {
    if (schema.format === "binary") return true;
    if (!schema.ref || seen.has(schema.ref)) break;
    seen.add(schema.ref);
    const name = schemaRefName(schema.ref);
    schema = name ? schemas[name] : undefined;
  }
  return false;
};
