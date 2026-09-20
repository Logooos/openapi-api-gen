import { parseDocument } from "yaml";
import type { ObjectValue, OpenApiVersion } from "./model.js";

export const object = (value: unknown, location: string): ObjectValue => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`INVALID_OPENAPI: ${location} must be an object`);
  }
  return value as ObjectValue;
};

export const string = (value: unknown, location: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`INVALID_OPENAPI: ${location} must be a non-empty string`);
  }
  return value;
};

export const detectVersion = (value: unknown): OpenApiVersion => {
  const doc = object(value, "document");
  if (typeof doc.openapi !== "string" || !/^3\.[01]\.\d+$/.test(doc.openapi)) {
    throw new Error(
      `UNSUPPORTED_VERSION: expected OpenAPI 3.0.x or 3.1.x, received ${String(doc.openapi ?? doc.swagger ?? "missing")}`,
    );
  }
  return doc.openapi as OpenApiVersion;
};

export const parseSpec = (text: string): ObjectValue => {
  const parsed = parseDocument(text, { uniqueKeys: true });
  if (parsed.errors.length || parsed.warnings.length) {
    throw new Error(
      `INVALID_DOCUMENT: ${[...parsed.errors, ...parsed.warnings].map((error) => error.message).join("; ")}`,
    );
  }
  const value: unknown = parsed.toJS({ maxAliasCount: 100 });
  // YAML aliases may form cycles or produce values that JSON cannot represent.
  const ancestors = new Set<object>();
  const check = (node: unknown): void => {
    if (node && typeof node === "object") {
      if (ancestors.has(node))
        throw new Error("INVALID_DOCUMENT: cyclic YAML alias");
      ancestors.add(node);
      for (const child of Object.values(node)) check(child);
      ancestors.delete(node);
    } else if (typeof node === "number" && !Number.isFinite(node)) {
      throw new Error("INVALID_DOCUMENT: non-finite number");
    }
  };
  check(value);
  return object(value, "document");
};
