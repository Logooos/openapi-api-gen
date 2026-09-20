import type { Diagnostic, NormalizedDocument } from "./model.js";

// Count declarations in source schemas, not each use of a referenced schema.
const countEnumNames = (document: NormalizedDocument): number => {
  let count = 0;
  const walk = (value: unknown, schema = false): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, schema));
      return;
    }
    const node = value as Record<string, unknown>;
    if (schema && Object.hasOwn(node, "x-enum-name")) count++;
    for (const [key, child] of Object.entries(node)) {
      if (
        ["example", "examples", "default", "enum", "const"].includes(key) ||
        key.startsWith("x-")
      )
        continue;
      if (
        [
          "schemas",
          "properties",
          "patternProperties",
          "$defs",
          "definitions",
          "dependentSchemas",
        ].includes(key)
      ) {
        if (child && typeof child === "object")
          Object.values(child).forEach((entry) => walk(entry, true));
      } else {
        walk(
          child,
          key === "schema" ||
            (schema &&
              [
                "items",
                "prefixItems",
                "additionalProperties",
                "unevaluatedProperties",
                "contains",
                "allOf",
                "anyOf",
                "oneOf",
                "not",
                "if",
                "then",
                "else",
                "propertyNames",
              ].includes(key)),
        );
      }
    }
  };
  walk(document.raw);
  return count;
};

export const diagnose = (document: NormalizedDocument) => {
  const diagnostics: Diagnostic[] = [...document.diagnostics];
  const ids = new Map<string, string[]>();
  const modules = new Set<string>();
  let multipartCount = 0;
  for (const operation of document.operations) {
    const location = `${operation.method.toUpperCase()} ${operation.path}`;
    if (operation.operationId !== undefined) {
      const locations = ids.get(operation.operationId) ?? [];
      locations.push(location);
      ids.set(operation.operationId, locations);
    }
    if (operation.module !== null) modules.add(operation.module);
    if (
      operation.requestBody &&
      Object.hasOwn(operation.requestBody.content, "multipart/form-data")
    ) {
      multipartCount++;
      diagnostics.push({
        severity: "warning",
        code: "UNSUPPORTED_MULTIPART",
        message:
          "multipart/form-data operation is unsupported for v1 generation.",
        location,
      });
    }
    if (operation.raw.callbacks !== undefined)
      diagnostics.push({
        severity: "warning",
        code: "CALLBACKS_NOT_ANALYZED",
        message: "Phase 1 operation statistics cover paths only.",
        location,
      });
  }
  const duplicateOperationIds = [...ids]
    .filter(([, locations]) => locations.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([operationId, locations]) => ({ operationId, locations }));
  for (const duplicate of duplicateOperationIds)
    diagnostics.push({
      severity: "error",
      code: "DUPLICATE_OPERATION_ID",
      message: `Duplicate operationId: ${duplicate.operationId}`,
      location: duplicate.locations.join(", "),
    });
  return {
    version: document.version,
    operationCount: document.operations.length,
    schemaCount: Object.keys(document.schemas).length,
    tagCount: document.tags.length,
    moduleCount: modules.size,
    tags: document.tags,
    modules: [...modules].sort(),
    untaggedOperationCount: document.operations.filter(
      (operation) => operation.module === null,
    ).length,
    duplicateOperationIdCount: duplicateOperationIds.length,
    duplicateOperationIds,
    multipartCount,
    xEnumNameCount: countEnumNames(document),
    diagnostics,
  };
};
