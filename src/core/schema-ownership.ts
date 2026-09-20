import type { GenerationOptions } from "./generation-model.js";
import type { buildSchemaGraph } from "./schema-graph.js";

export const resolveSchemaOwners = (
  graph: ReturnType<typeof buildSchemaGraph>,
  modules: Set<string>,
  options: GenerationOptions,
): Record<string, string | null> => {
  const explicit =
    options.schemaOwners === undefined ? {} : options.schemaOwners;
  if (
    typeof explicit !== "object" ||
    explicit === null ||
    Array.isArray(explicit)
  )
    throw new Error("INVALID_CONFIG: schemaOwners must be an object");
  for (const [name, owner] of Object.entries(explicit)) {
    if (!Object.hasOwn(graph.dependencies, name))
      throw new Error("SCHEMA_OWNER_CONFLICT: unknown schema " + name);
    if (
      typeof owner !== "string" ||
      (owner !== "_shared" && !modules.has(owner))
    )
      throw new Error(
        "SCHEMA_OWNER_CONFLICT: unknown module for " + name + ": " + owner,
      );
  }
  const owners: Record<string, string | null> = Object.fromEntries(
    Object.entries(graph.usage).map(([name, usage]) => [
      name,
      Object.hasOwn(explicit, name)
        ? explicit[name]!
        : usage.length > 1
          ? "_shared"
          : (usage[0] ?? null),
    ]),
  );
  const hoist = (name: string, reason: string): void => {
    if (Object.hasOwn(explicit, name) && explicit[name] !== "_shared")
      throw new Error(
        "SCHEMA_OWNER_CONFLICT: " +
          name +
          " pinned to " +
          explicit[name] +
          "; " +
          reason +
          " requires _shared",
      );
    owners[name] = "_shared";
  };
  for (const component of graph.components) {
    if (new Set(component.map((name) => owners[name])).size > 1)
      component.forEach((name) =>
        hoist(name, "SCC [" + component.join(", ") + "]"),
      );
  }
  // Shared types must never depend back on a business module. Hoist their closure.
  for (const name of Object.keys(owners)) {
    if (owners[name] === "_shared")
      graph
        .closure([name])
        .forEach((target) => hoist(target, "dependency of " + name));
  }
  return owners;
};
