import type { NormalizedParameter, NormalizedSchema } from "./model.js";
import type { TypeContext } from "./generation-model.js";
import { jsdoc, schemaRefName } from "./generation-utils.js";

export const union = (types: string[]): string =>
  [...new Set(types)].join(" | ") || "never";
export const renderType = (
  schema: NormalizedSchema | undefined,
  context: TypeContext,
  location: string,
): string => {
  const warn = (message: string): string => {
    context.diagnostics.push({
      severity: "warning",
      code: "SCHEMA_FALLBACK",
      location,
      message,
    });
    return "unknown";
  };
  if (!schema) return warn("Missing schema; using unknown.");
  if (schema.nullable && context.options.types?.nullable === "ignore")
    schema = { ...schema, nullable: false };
  if (typeof schema.raw === "boolean") return schema.raw ? "unknown" : "never";
  for (const key of [
    "not",
    "if",
    "then",
    "else",
    "prefixItems",
    "patternProperties",
    "unevaluatedProperties",
    "const",
    "$dynamicRef",
  ])
    if (Object.hasOwn(schema.raw, key))
      return warn(`${key} is outside Phase 2; using unknown.`);
  if (schema.types.length > 1) {
    return union([
      ...schema.types.map(
        (type) =>
          `(${renderType({ ...schema, types: [type], nullable: false, properties: type === "object" ? schema.properties : undefined, additionalProperties: type === "object" ? schema.additionalProperties : undefined }, context, location)})`,
      ),
      ...(schema.nullable ? ["null"] : []),
    ]);
  }
  if (
    schema.format &&
    ![
      "int32",
      "int64",
      "float",
      "double",
      "date",
      "date-time",
      "byte",
      "binary",
      "password",
      "uuid",
      "uri",
    ].includes(schema.format)
  )
    context.diagnostics.push({
      severity: "warning",
      code: "UNKNOWN_FORMAT",
      location,
      message: `Format ${schema.format} retains its base type.`,
    });
  if (
    schema.xEnumName === undefined &&
    schema.enum &&
    schema.enum.some(
      (value) =>
        value !== null &&
        !["string", "number", "boolean"].includes(typeof value),
    )
  )
    return warn("Non-primitive enum is outside Phase 2; using unknown.");

  const parts: string[] = [];
  if (schema.ref) {
    const name = schemaRefName(schema.ref);
    if (!name || !Object.hasOwn(context.schemas, name))
      return warn(`Unsupported reference ${schema.ref}; using unknown.`);
    parts.push(
      context.reference
        ? context.reference(name)
        : (context.prefix ?? "") + name,
    );
  }
  if (schema.xEnumName === undefined && schema.enum) {
    parts.push(`(${union(schema.enum.map((value) => JSON.stringify(value)))})`);
  }
  const primitives = schema.types
    .map((type) => {
      if (type === "integer" || type === "number")
        return schema.format === "int64"
          ? (context.options.int64 ?? "number")
          : "number";
      if (type === "string") return "string";
      if (type === "boolean") return "boolean";
      if (type === "array")
        return `Array<${renderType(schema.items, context, `${location}.items`)}>`;
      if (type === "object") return undefined;
      return warn(`Unsupported type ${type}; using unknown.`);
    })
    .filter((type): type is string => type !== undefined);
  // Standard enum literals already carry their primitive type. Project enums do not.
  if (primitives.length && (!schema.enum || schema.xEnumName !== undefined))
    parts.push(`(${union(primitives)})`);
  if (
    schema.properties ||
    schema.additionalProperties ||
    (schema.types.includes("object") &&
      !schema.ref &&
      !schema.allOf &&
      !schema.oneOf &&
      !schema.anyOf)
  ) {
    const properties = Object.entries(schema.properties ?? {})
      .sort(([a], [b]) =>
        context.options.types?.propertyOrder === "source"
          ? 0
          : a < b
            ? -1
            : a > b
              ? 1
              : 0,
      )
      .map(
        ([name, child]) =>
          `${jsdoc(child.description, child.deprecated ? "@deprecated" : undefined)}${JSON.stringify(name)}${schema.required?.includes(name) ? "" : "?"}: ${renderType(child, context, `${location}.${name}`)};`,
      );
    if (properties.length) parts.push(`{\n${properties.join("\n")}\n}`);
    if (
      schema.additionalProperties?.raw !== false &&
      schema.additionalProperties
    )
      parts.push(
        `Record<string, ${renderType(schema.additionalProperties, context, `${location}.additionalProperties`)}>`,
      );
    if (!properties.length && !schema.additionalProperties)
      parts.push("Record<string, unknown>");
    if (!properties.length && schema.additionalProperties?.raw === false)
      parts.push("Record<string, never>");
  }
  for (const [keyword, separator] of [
    ["allOf", " & "],
    ["oneOf", " | "],
    ["anyOf", " | "],
  ] as const) {
    if (schema[keyword])
      parts.push(
        `(${[...new Set(schema[keyword].map((child, index) => `(${renderType(child, context, `${location}.${keyword}[${index}]`)})`))].join(separator) || "never"})`,
      );
  }
  const type = parts.length
    ? parts.map((part) => `(${part})`).join(" & ")
    : schema.nullable &&
        (schema.raw.type === "null" ||
          (Array.isArray(schema.raw.type) &&
            schema.raw.type.every((type) => type === "null")))
      ? "null"
      : warn("Unconstrained schema; using unknown.");
  return schema.nullable && type !== "null" ? `(${type}) | null` : type;
};

export const renderParameters = (
  parameters: NormalizedParameter[],
  context: TypeContext,
  location: string,
): string =>
  `{\n${[...parameters]
    .sort((a, b) =>
      context.options.types?.propertyOrder === "source"
        ? 0
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
    )
    .map(
      (p) =>
        `${jsdoc(p.description, p.deprecated ? "@deprecated" : undefined)}${JSON.stringify(p.name)}${p.required ? "" : "?"}: ${renderType(p.schema, context, `${location}.${p.name}`)};`,
    )
    .join("\n")}\n}`;
export const renderSchemaDeclaration = (
  name: string,
  schema: NormalizedSchema,
  context: TypeContext,
): string =>
  `${jsdoc(schema.description, schema.deprecated ? "@deprecated" : undefined)}export type ${name} = ${name === "JsonNode" ? "{ [key: string]: any }" : renderType(schema, context, name)};\n`;
