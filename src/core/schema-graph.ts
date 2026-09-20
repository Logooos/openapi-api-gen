import type { NormalizedDocument, NormalizedSchema } from "./model.js";
import {
  operationSchemas,
  schemaRefName,
  visitSchema,
} from "./generation-utils.js";

export const buildSchemaGraph = (document: NormalizedDocument) => {
  const names = Object.keys(document.schemas).sort();

  // Raw-only JSON Schema branches still influence ownership, even when type
  // emission falls back. Never walk example/default/enum payloads as schemas.
  const rawRefs = (value: unknown, add: (ref: string) => void): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (typeof node.$ref === "string") add(node.$ref);
    for (const key of [
      "properties",
      "patternProperties",
      "$defs",
      "definitions",
      "dependentSchemas",
    ]) {
      const map = node[key];
      if (map && typeof map === "object" && !Array.isArray(map))
        Object.values(map).forEach((child) => rawRefs(child, add));
    }
    for (const key of [
      "items",
      "additionalProperties",
      "not",
      "if",
      "then",
      "else",
      "contains",
      "propertyNames",
      "additionalItems",
      "unevaluatedProperties",
      "unevaluatedItems",
    ])
      rawRefs(node[key], add);
    for (const key of ["allOf", "oneOf", "anyOf", "prefixItems"])
      if (Array.isArray(node[key]))
        node[key].forEach((child) => rawRefs(child, add));
  };
  const refs = (schemas: NormalizedSchema[]): string[] => {
    const found = new Set<string>();
    const add = (ref: string): void => {
      const name = schemaRefName(ref);
      if (name !== undefined) {
        if (!Object.hasOwn(document.schemas, name))
          throw new Error("INVALID_REF: " + ref);
        found.add(name);
      }
    };
    schemas.forEach((schema) =>
      visitSchema(schema, (node) => {
        if (node.ref) add(node.ref);
        if (typeof node.raw !== "object") return;
        for (const key of [
          "not",
          "if",
          "then",
          "else",
          "contains",
          "propertyNames",
          "additionalItems",
          "unevaluatedProperties",
          "unevaluatedItems",
        ])
          rawRefs(node.raw[key], add);
        for (const key of [
          "patternProperties",
          "$defs",
          "definitions",
          "dependentSchemas",
        ]) {
          const map = node.raw[key];
          if (map && typeof map === "object" && !Array.isArray(map))
            Object.values(map).forEach((child) => rawRefs(child, add));
        }
        if (Array.isArray(node.raw.prefixItems))
          node.raw.prefixItems.forEach((child) => rawRefs(child, add));
      }),
    );
    return [...found].sort();
  };
  const dependencies = Object.fromEntries(
    names.map((name) => [name, refs([document.schemas[name]!])]),
  );
  const closure = (roots: string[]): string[] => {
    const found = new Set<string>();
    const pending = [...roots];
    while (pending.length) {
      const name = pending.pop()!;
      if (found.has(name)) continue;
      found.add(name);
      pending.push(...dependencies[name]!);
    }
    return [...found].sort();
  };
  const operationDependencies = document.operations.map((op) =>
    closure(refs(operationSchemas(op))),
  );
  const usage = new Map(names.map((name) => [name, new Set<string>()]));
  document.operations.forEach((op, index) =>
    operationDependencies[index]!.forEach((name) => {
      if (op.module !== null) usage.get(name)!.add(op.module);
    }),
  );

  // Tarjan: visit each schema and reference edge once, before file emission.
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  const connect = (name: string): void => {
    indices.set(name, indices.size);
    low.set(name, indices.get(name)!);
    stack.push(name);
    active.add(name);
    for (const target of dependencies[name]!) {
      if (!indices.has(target)) {
        connect(target);
        low.set(name, Math.min(low.get(name)!, low.get(target)!));
      } else if (active.has(target))
        low.set(name, Math.min(low.get(name)!, indices.get(target)!));
    }
    if (low.get(name) === indices.get(name)) {
      const component: string[] = [];
      let target: string;
      do {
        target = stack.pop()!;
        active.delete(target);
        component.push(target);
      } while (target !== name);
      components.push(component.sort());
    }
  };
  names.forEach((name) => {
    if (!indices.has(name)) connect(name);
  });
  components.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return {
    dependencies,
    usage: Object.fromEntries(
      [...usage].map(([name, modules]) => [name, [...modules].sort()]),
    ),
    components,
    operationDependencies,
    refs,
    closure,
  };
};
