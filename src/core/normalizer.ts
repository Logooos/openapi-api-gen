import { detectVersion, object, string } from "./parser.js";
import type {
  HttpMethod,
  NormalizedDocument,
  NormalizedParameter,
  NormalizedSchema,
  ObjectValue,
} from "./model.js";

const methods: HttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
const strings = (value: unknown, location: string): string[] => {
  if (!Array.isArray(value))
    throw new Error(`INVALID_OPENAPI: ${location} must be an array`);
  return value.map((item) => string(item, location));
};

const optionalText = (value: unknown, location: string): string | undefined => {
  if (value !== undefined && typeof value !== "string")
    throw new Error(`INVALID_OPENAPI: ${location} must be a string`);
  return value;
};
const optionalBoolean = (
  value: unknown,
  location: string,
): boolean | undefined => {
  if (value !== undefined && typeof value !== "boolean")
    throw new Error(`INVALID_OPENAPI: ${location} must be boolean`);
  return value;
};

export const normalizeSpec = (raw: ObjectValue): NormalizedDocument => {
  const version = detectVersion(raw);
  const info = object(raw.info, "info");
  string(info.title, "info.title");
  string(info.version, "info.version");
  if (
    raw.paths === undefined &&
    (version.startsWith("3.0.") ||
      (raw.components === undefined && raw.webhooks === undefined))
  ) {
    throw new Error(
      "INVALID_OPENAPI: missing paths (or components/webhooks for 3.1)",
    );
  }
  const result: NormalizedDocument = {
    version,
    operations: [],
    schemas: {},
    tags: [],
    diagnostics: [],
    raw,
  };
  const resolve = (
    value: unknown,
    location: string,
    seen = new Set<string>(),
  ): ObjectValue => {
    const node = object(value, location);
    if (node.$ref === undefined) return node;
    const ref = string(node.$ref, `${location}.$ref`);
    if (!ref.startsWith("#/"))
      throw new Error(
        `UNSUPPORTED_REF: ${location}: ${ref}; external object references are not supported in Phase 1`,
      );
    if (seen.has(ref))
      throw new Error(`INVALID_REF: reference cycle at ${location}: ${ref}`);
    seen.add(ref);
    let target: unknown = raw;
    for (const key of decodeURIComponent(ref.slice(2))
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      const parent = object(target, ref);
      if (!Object.hasOwn(parent, key))
        throw new Error(`INVALID_REF: unresolved ${ref}`);
      target = parent[key];
    }
    return resolve(target, location, seen);
  };
  const schema = (value: unknown, location: string): NormalizedSchema => {
    if (typeof value === "boolean") {
      if (version.startsWith("3.0."))
        throw new Error(
          `INVALID_OPENAPI: boolean schema at ${location} requires 3.1`,
        );
      return { raw: value, types: [], nullable: false };
    }
    const node = object(value, location);
    const types =
      node.type === undefined
        ? []
        : typeof node.type === "string"
          ? [node.type]
          : strings(node.type, `${location}.type`);
    if (
      types.some(
        (type) =>
          ![
            "string",
            "number",
            "integer",
            "boolean",
            "object",
            "array",
            "null",
          ].includes(type),
      )
    )
      throw new Error(`INVALID_OPENAPI: invalid schema type at ${location}`);
    if (
      version.startsWith("3.0.") &&
      (Array.isArray(node.type) || types.includes("null"))
    )
      throw new Error(
        `INVALID_OPENAPI: 3.0 schema type must be a single non-null type at ${location}`,
      );
    if (node.nullable !== undefined && typeof node.nullable !== "boolean")
      throw new Error(
        `INVALID_OPENAPI: nullable must be boolean at ${location}`,
      );
    const normalized: NormalizedSchema = {
      raw: node,
      description: optionalText(node.description, `${location}.description`),
      format: optionalText(node.format, `${location}.format`),
      xEnumName: optionalText(node["x-enum-name"], `${location}.x-enum-name`),
      default: node.default,
      readOnly: optionalBoolean(node.readOnly, `${location}.readOnly`),
      writeOnly: optionalBoolean(node.writeOnly, `${location}.writeOnly`),
      deprecated: optionalBoolean(node.deprecated, `${location}.deprecated`),
      types: types.filter((type) => type !== "null"),
      nullable:
        types.includes("null") ||
        (version.startsWith("3.0.") &&
          node.nullable === true &&
          types.length > 0),
    };
    if (node.$ref !== undefined)
      normalized.ref = string(node.$ref, `${location}.$ref`);
    if (node.required !== undefined)
      normalized.required = strings(node.required, `${location}.required`);
    if (node.enum !== undefined) {
      if (!Array.isArray(node.enum))
        throw new Error(`INVALID_OPENAPI: ${location}.enum must be an array`);
      normalized.enum = node.enum;
    }
    if (node.properties !== undefined)
      normalized.properties = Object.fromEntries(
        Object.entries(object(node.properties, `${location}.properties`)).map(
          ([name, child]) => [
            name,
            schema(child, `${location}.properties.${name}`),
          ],
        ),
      );
    if (node.items !== undefined)
      normalized.items = schema(node.items, `${location}.items`);
    if (node.additionalProperties !== undefined)
      normalized.additionalProperties =
        typeof node.additionalProperties === "boolean"
          ? { raw: node.additionalProperties, types: [], nullable: false }
          : schema(
              node.additionalProperties,
              `${location}.additionalProperties`,
            );
    for (const keyword of ["allOf", "oneOf", "anyOf"] as const) {
      if (node[keyword] !== undefined) {
        if (!Array.isArray(node[keyword]))
          throw new Error(
            `INVALID_OPENAPI: ${location}.${keyword} must be an array`,
          );
        normalized[keyword] = node[keyword].map((item) =>
          schema(item, `${location}.${keyword}`),
        );
      }
    }
    return normalized;
  };
  const content = (
    value: unknown,
    location: string,
  ): Record<string, NormalizedSchema | undefined> =>
    Object.fromEntries(
      Object.entries(value === undefined ? {} : object(value, location))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([media, value]) => {
          const entry = object(value, `${location}.${media}`);
          return [
            media,
            entry.schema === undefined
              ? undefined
              : schema(entry.schema, `${location}.${media}.schema`),
          ];
        }),
    );
  const parameters = (
    value: unknown,
    location: string,
  ): NormalizedParameter[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value))
      throw new Error(`INVALID_OPENAPI: ${location} must be an array`);
    const keys = new Set<string>();
    return value.map((value) => {
      const node = resolve(value, location);
      const name = string(node.name, `${location}.name`);
      const position = string(node.in, `${location}.in`);
      if (!["path", "query", "header", "cookie"].includes(position))
        throw new Error(
          `INVALID_OPENAPI: invalid parameter location ${position}`,
        );
      if (node.required !== undefined && typeof node.required !== "boolean")
        throw new Error(
          `INVALID_OPENAPI: parameter required must be boolean at ${location}`,
        );
      if (position === "path" && node.required !== true)
        throw new Error(
          `INVALID_OPENAPI: path parameter ${name} must be required`,
        );
      const key = JSON.stringify([position, name]);
      if (keys.has(key))
        throw new Error(
          `INVALID_OPENAPI: duplicate parameter ${key} at ${location}`,
        );
      keys.add(key);
      if ((node.schema === undefined) === (node.content === undefined))
        throw new Error(
          `INVALID_OPENAPI: parameter ${name} must have exactly one of schema/content`,
        );
      return {
        name,
        description: optionalText(node.description, `${location}.description`),
        deprecated: optionalBoolean(node.deprecated, `${location}.deprecated`),
        in: position as NormalizedParameter["in"],
        required: node.required === true,
        schema:
          node.schema === undefined
            ? undefined
            : schema(node.schema, `${location}.${name}`),
        content: content(node.content, `${location}.content`),
        raw: node,
      };
    });
  };
  const components =
    raw.components === undefined ? {} : object(raw.components, "components");
  result.schemas = Object.fromEntries(
    Object.entries(
      components.schemas === undefined
        ? {}
        : object(components.schemas, "components.schemas"),
    )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, value]) => [
        name,
        schema(value, `components.schemas.${name}`),
      ]),
  );
  const tags = new Set<string>();
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags))
      throw new Error("INVALID_OPENAPI: tags must be an array");
    for (const tag of raw.tags)
      tags.add(string(object(tag, "tags").name, "tags.name"));
  }
  const paths = raw.paths === undefined ? {} : object(raw.paths, "paths");
  for (const path of Object.keys(paths).sort()) {
    if (path.startsWith("x-")) continue;
    if (!path.startsWith("/"))
      throw new Error(`INVALID_OPENAPI: invalid path ${path}`);
    const item = resolve(paths[path], path);
    const inherited = parameters(item.parameters, `${path}.parameters`);
    for (const method of methods) {
      if (item[method] === undefined) continue;
      const location = `${method.toUpperCase()} ${path}`;
      const operation = object(item[method], location);
      const operationId =
        operation.operationId === undefined
          ? undefined
          : string(operation.operationId, `${location}.operationId`);
      const operationTags =
        operation.tags === undefined
          ? []
          : strings(operation.tags, `${location}.tags`);
      operationTags.forEach((tag) => tags.add(tag));
      const merged = new Map(
        inherited.map((parameter) => [
          JSON.stringify([parameter.in, parameter.name]),
          parameter,
        ]),
      );
      for (const parameter of parameters(
        operation.parameters,
        `${location}.parameters`,
      ))
        merged.set(JSON.stringify([parameter.in, parameter.name]), parameter);
      const params = [...merged.values()];
      const body =
        operation.requestBody === undefined
          ? undefined
          : resolve(operation.requestBody, `${location}.requestBody`);
      if (
        body &&
        body.required !== undefined &&
        typeof body.required !== "boolean"
      )
        throw new Error(
          `INVALID_OPENAPI: requestBody.required must be boolean at ${location}`,
        );
      if (body && body.content === undefined)
        throw new Error(
          `INVALID_OPENAPI: requestBody.content missing at ${location}`,
        );
      const responses = object(operation.responses, `${location}.responses`);
      const statuses = Object.keys(responses)
        .filter((status) => !status.startsWith("x-"))
        .sort();
      if (!statuses.length)
        throw new Error(`INVALID_OPENAPI: empty responses at ${location}`);
      result.operations.push({
        operationId,
        summary: optionalText(operation.summary, `${location}.summary`),
        description: optionalText(
          operation.description,
          `${location}.description`,
        ),
        deprecated: optionalBoolean(
          operation.deprecated,
          `${location}.deprecated`,
        ),
        method,
        path,
        tags: operationTags,
        module: operationTags[0] ?? null,
        pathParams: params.filter((parameter) => parameter.in === "path"),
        queryParams: params.filter((parameter) => parameter.in === "query"),
        headerParams: params.filter((parameter) => parameter.in === "header"),
        cookieParams: params.filter((parameter) => parameter.in === "cookie"),
        requestBody: body
          ? {
              description: optionalText(
                body.description,
                `${location}.requestBody.description`,
              ),
              required: body.required === true,
              content: content(body.content, `${location}.requestBody.content`),
              raw: body,
            }
          : undefined,
        responses: statuses.map((status) => {
          if (!/^(default|[1-5](?:\d{2}|XX))$/.test(status))
            throw new Error(
              `INVALID_OPENAPI: invalid response status ${status} at ${location}`,
            );
          const response = resolve(
            responses[status],
            `${location}.responses.${status}`,
          );
          if (typeof response.description !== "string")
            throw new Error(
              `INVALID_OPENAPI: missing response description at ${location}.${status}`,
            );
          return {
            status,
            description: response.description,
            content: content(
              response.content,
              `${location}.responses.${status}.content`,
            ),
            raw: response,
          };
        }),
        raw: operation,
      });
      if (!operationId)
        result.diagnostics.push({
          severity: "warning",
          code: "MISSING_OPERATION_ID",
          message: "No operationId; no name is inferred.",
          location,
        });
      if (!operationTags.length)
        result.diagnostics.push({
          severity: "warning",
          code: "MISSING_TAG",
          message: "No first tag; module remains unassigned.",
          location,
        });
    }
  }
  result.tags = [...tags].sort();
  if (raw.webhooks !== undefined)
    result.diagnostics.push({
      severity: "warning",
      code: "WEBHOOKS_NOT_ANALYZED",
      message: "Phase 1 operation statistics cover paths only.",
      location: "webhooks",
    });
  return result;
};
