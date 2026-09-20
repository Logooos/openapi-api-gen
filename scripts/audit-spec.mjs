// Read-only audit tooling; no schema ownership or generation decisions.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const bytes = await readFile(process.argv[2]);
const doc = JSON.parse(bytes.toString("utf8"));
const methods = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
];
const counts = {};
const examples = {};
const hit = (key, location) => {
  counts[key] = (counts[key] ?? 0) + 1;
  if ((examples[key] ??= []).length < 10) examples[key].push(location);
};
const walk = (node, path, visit) => {
  if (!node || typeof node !== "object") return;
  visit(node, path);
  for (const [key, child] of Object.entries(node)) {
    const dictionary =
      /\/(?:properties|schemas|responses|patternProperties|\$defs)$/.test(path);
    if (
      !dictionary &&
      ["example", "examples", "enum", "const", "default"].includes(key)
    )
      continue;
    walk(
      child,
      `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      visit,
    );
  }
};
const refs = (node) => {
  const found = new Set();
  walk(node, "", (n) => {
    if (n.$ref) found.add(n.$ref);
  });
  return [...found];
};
const schemas = doc.components?.schemas ?? {};
const schemaNodes = new WeakSet();
const schemaKeys = {};
const collectSchema = (node) => {
  if (!node || typeof node !== "object" || schemaNodes.has(node)) return;
  schemaNodes.add(node);
  for (const key of Object.keys(node))
    schemaKeys[key] = (schemaKeys[key] ?? 0) + 1;
  for (const key of [
    "properties",
    "patternProperties",
    "$defs",
    "dependentSchemas",
  ])
    for (const child of Object.values(node[key] ?? {})) collectSchema(child);
  for (const key of [
    "items",
    "additionalProperties",
    "not",
    "if",
    "then",
    "else",
    "contains",
  ])
    collectSchema(node[key]);
  for (const key of ["allOf", "oneOf", "anyOf", "prefixItems"])
    for (const child of node[key] ?? []) collectSchema(child);
};
Object.values(schemas).forEach(collectSchema);
walk(doc.paths, "#/paths", (node) => {
  if (node.schema) collectSchema(node.schema);
});
const schemaName = (ref) =>
  ref.startsWith("#/components/schemas/")
    ? ref.slice(21).replaceAll("~1", "/").replaceAll("~0", "~")
    : null;
const graph = Object.fromEntries(
  Object.entries(schemas).map(([name, node]) => [
    name,
    refs(node)
      .map(schemaName)
      .filter((n) => n !== null),
  ]),
);
const reachable = (roots) => {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(graph[name] ?? []));
  }
  return seen;
};
const usage = Object.fromEntries(
  Object.keys(schemas).map((name) => [name, new Set()]),
);
const ids = {};
const operations = [];
for (const [path, item] of Object.entries(doc.paths ?? {}))
  for (const method of methods) {
    const op = item[method];
    if (!op) continue;
    const location = `${method.toUpperCase()} ${path}`;
    operations.push(location);
    hit(`method:${method}`, location);
    hit(`module:${op.tags?.[0] ?? "(untagged)"}`, location);
    if (!op.operationId) hit("missingOperationId", location);
    else (ids[op.operationId] ??= []).push(location);
    const params = new Map(
      [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => [
        JSON.stringify([p.in, p.name]),
        p,
      ]),
    );
    const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    for (const name of placeholders)
      if (![...params.values()].some((p) => p.in === "path" && p.name === name))
        hit("missingPathParameter", `${location} ${name}`);
    for (const p of params.values())
      if (p.in === "path" && !placeholders.includes(p.name))
        hit("extraPathParameter", `${location} ${p.name}`);
    for (const p of params.values()) {
      hit(`parameter:${p.in}`, `${location} ${p.name}`);
      if (p.in === "header") hit(`header:${p.name}`, location);
    }
    for (const media of Object.keys(op.requestBody?.content ?? {}))
      hit(`request:${media}`, location);
    const successes = Object.entries(op.responses ?? {}).filter(([status]) =>
      /^2(?:\d\d|XX)$/.test(status),
    );
    if (!successes.length) hit("noExplicit2xx", location);
    if (successes.length > 1) hit("multiple2xx", location);
    for (const [status, response] of Object.entries(op.responses ?? {})) {
      hit(`status:${status}`, location);
      if (!/^2(?:\d\d|XX)$/.test(status)) continue;
      if (!response.content || !Object.keys(response.content).length)
        hit("2xx:noContent", location);
      for (const [media, entry] of Object.entries(response.content ?? {})) {
        hit(`2xx:media:${media}`, location);
        hit(
          `2xx:shape:${entry.schema?.$ref ? "$ref" : (entry.schema?.type ?? (entry.schema ? "other" : "noSchema"))}`,
          location,
        );
      }
    }
    for (const name of reachable(
      refs({ op, parameters: [...params.values()] })
        .map(schemaName)
        .filter((n) => n !== null),
    ))
      usage[name]?.add(op.tags?.[0] ?? "(untagged)");
  }
const enumFields = [];
const invalidRefs = [];
walk(doc, "#", (node, location) => {
  if (Array.isArray(node)) return;
  if (
    !schemaNodes.has(node) &&
    (location.endsWith("/properties") || location === "#/components/schemas")
  )
    return;
  for (const keyword of [
    "allOf",
    "oneOf",
    "anyOf",
    "additionalProperties",
    "discriminator",
    "readOnly",
    "writeOnly",
    "deprecated",
    "style",
    "explode",
    "encoding",
    "headers",
    "links",
    "callbacks",
    "webhooks",
    "security",
    "servers",
    "required",
    "description",
    "summary",
    "format",
  ])
    if (Object.hasOwn(node, keyword)) hit(keyword, location);
  if (node.nullable === true) hit("nullable:3.0", location);
  if (
    node.type === "null" ||
    (Array.isArray(node.type) && node.type.includes("null"))
  )
    hit("nullable:3.1", location);
  if (node.format) hit(`format:${node.format}`, location);
  if (node.additionalProperties !== undefined)
    hit(
      `additionalProperties:${typeof node.additionalProperties === "boolean" ? node.additionalProperties : node.additionalProperties.$ref ? "$ref" : (node.additionalProperties.type ?? "other")}`,
      location,
    );
  if (node.$ref) {
    hit("$ref", location);
    if (Object.keys(node).length > 1) hit("$ref:siblings", location);
    let target = doc;
    if (!node.$ref.startsWith("#/"))
      invalidRefs.push({ location, ref: node.$ref, reason: "external" });
    else {
      for (const key of decodeURIComponent(node.$ref.slice(2))
        .split("/")
        .map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~")))
        target = target?.[key];
      if (target === undefined)
        invalidRefs.push({ location, ref: node.$ref, reason: "missing" });
    }
  }
  if (schemaNodes.has(node) && node.enum && !Object.hasOwn(node, "x-enum-name"))
    hit("standardEnum", location);
  if (!schemaNodes.has(node) || !Object.hasOwn(node, "x-enum-name")) return;
  hit("x-enum-name", location);
  const issues = [],
    members = [];
  if (!Array.isArray(node.enum) || !node.enum.length)
    issues.push("missing metadata");
  for (const value of node.enum ?? []) {
    if (typeof value !== "string" || !value.includes(":")) {
      issues.push("missing colon");
      continue;
    }
    const index = value.indexOf(":");
    const raw = value.slice(0, index);
    const display = value.slice(index + 1);
    const match = /^([^()]*)\((.*)\)$/.exec(display);
    if (!raw || !(match?.[1] ?? display).trim())
      issues.push("empty value/display");
    const identifier = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
    const member = identifier.test(raw)
      ? raw
      : (match?.[2] ?? "")
          .trim()
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
          .replace(/[^A-Za-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toUpperCase();
    if (!identifier.test(raw) && !match?.[2]) issues.push("missing English");
    if (!identifier.test(member)) issues.push("invalid identifier");
    if (members.some((m) => m.member === member))
      issues.push("duplicate member");
    members.push({
      value: raw,
      member,
      zhText: match?.[1] ?? display,
      enText: match?.[2],
    });
  }
  enumFields.push({
    location,
    name: node["x-enum-name"],
    type: node.type,
    enum: node.enum,
    members,
    issues: [...new Set(issues)],
  });
});
const enumGroups = Object.groupBy(enumFields, (e) => e.name);
const conflicts = Object.entries(enumGroups)
  .filter(
    ([, fields]) =>
      new Set(fields.map((f) => JSON.stringify([f.type, f.enum]))).size > 1,
  )
  .map(([name]) => name);
const metadataConflicts = Object.entries(enumGroups)
  .filter(
    ([, fields]) =>
      new Set(fields.filter((f) => f.enum).map((f) => JSON.stringify(f.enum)))
        .size > 1,
  )
  .map(([name]) => name);
const primitiveConflicts = Object.entries(enumGroups)
  .filter(([, fields]) => new Set(fields.map((f) => f.type)).size > 1)
  .map(([name]) => name);
// ponytail: reachability is O(V*(V+E)); use Tarjan if audit size makes this costly.
const reach = Object.fromEntries(
  Object.keys(graph).map((name) => [name, reachable(graph[name])]),
);
const assigned = new Set();
const cycles = [];
for (const name of Object.keys(graph)) {
  if (assigned.has(name) || !reach[name].has(name)) continue;
  const group = Object.keys(graph).filter(
    (other) => reach[name].has(other) && reach[other].has(name),
  );
  group.forEach((n) => assigned.add(n));
  cycles.push({
    schemas: group,
    modules: [...new Set(group.flatMap((n) => [...usage[n]]))].sort(),
  });
}
const moduleUsage = Object.fromEntries(
  Object.entries(usage).map(([name, tags]) => [name, [...tags].sort()]),
);
console.log(
  JSON.stringify(
    {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      version: doc.openapi,
      operations: operations.length,
      schemas: Object.keys(schemas).length,
      declaredTags: doc.tags?.length ?? 0,
      usedTags: [
        ...new Set(
          Object.values(doc.paths ?? {}).flatMap((p) =>
            methods.flatMap((m) => p[m]?.tags ?? []),
          ),
        ),
      ],
      duplicates: Object.entries(ids).filter(
        ([, locations]) => locations.length > 1,
      ),
      counts,
      examples,
      enumFields,
      enumNames: Object.keys(enumGroups).length,
      enumConflicts: conflicts,
      metadataConflicts,
      primitiveConflicts,
      schemaKeys,
      invalidRefs,
      graph,
      cycles,
      usageCounts: {
        unused: Object.values(usage).filter((s) => s.size === 0).length,
        single: Object.values(usage).filter((s) => s.size === 1).length,
        shared: Object.values(usage).filter((s) => s.size > 1).length,
      },
      moduleUsage,
    },
    null,
    2,
  ),
);
