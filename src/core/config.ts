import { identifier } from "./generation-utils.js";
export type GeneratorConfig = {
  input?: string;
  output?: string;
  source?: { headers?: Record<string, string> };
  requestClient?: {
    mode?: "axios" | "custom";
    importPath?: string;
    identifier?: string;
  };
  ignoredHeaders?: string[];
  moduleNames?: Record<string, string>;
  modules?: Record<
    string,
    Array<{ name: string; include?: string[]; exclude?: string[] }>
  >;
  schemaOwners?: Record<string, string>;
  includeOperations?: string[];
  excludeOperations?: string[];
  excludeTags?: string[];
  types?: {
    int64?: "number" | "string" | "bigint";
    nullable?: "union-null" | "ignore";
    propertyOrder?: "alphabetical" | "source";
  };
  int64?: "number" | "string" | "bigint";
  enum?: { enabled?: boolean; output?: string };
  barrel?: { enabled?: boolean };
  overrides?: {
    operations?: Record<
      string,
      {
        name?: string;
        module?: string;
        responseType?: string;
        exclude?: boolean;
      }
    >;
    schemas?: Record<string, { owner?: string }>;
  };
};
export const assertOutputFile = (path: string): void => {
  if (
    typeof path !== "string" ||
    !path.endsWith(".ts") ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[<>:"\\|?*\u0000-\u001f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new Error("INVALID_OUTPUT_PATH: expected safe relative .ts file");
};
type Rule = "text" | "boolean" | "list" | { [key: string]: Rule };
const shape: Rule = {
  input: "text",
  output: "text",
  source: { headers: { "*": "text" } },
  requestClient: { mode: "text", importPath: "text", identifier: "text" },
  ignoredHeaders: "list",
  moduleNames: { "*": "text" },
  modules: {
    "*": { "[]": { name: "text", include: "list", exclude: "list" } },
  },
  schemaOwners: { "*": "text" },
  includeOperations: "list",
  excludeOperations: "list",
  excludeTags: "list",
  types: { int64: "text", nullable: "text", propertyOrder: "text" },
  int64: "text",
  enum: { enabled: "boolean", output: "text" },
  barrel: { enabled: "boolean" },
  overrides: {
    operations: {
      "*": {
        name: "text",
        module: "text",
        responseType: "text",
        exclude: "boolean",
      },
    },
    schemas: { "*": { owner: "text" } },
  },
};
export function validateConfig(
  value: unknown,
): asserts value is GeneratorConfig {
  const fail = (path: string): never => {
    throw new Error("INVALID_CONFIG: " + path);
  };
  const check = (v: unknown, rule: Rule, path: string): void => {
    if (rule === "text") {
      if (typeof v !== "string" || !v.trim() || /[\r\n]/.test(v))
        fail(path + " must be nonempty text");
      return;
    }
    if (rule === "boolean") {
      if (typeof v !== "boolean") fail(path + " must be boolean");
      return;
    }
    if (rule === "list") {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x))
        fail(path + " must be string[]");
      return;
    }
    if (rule["[]"]) {
      if (!Array.isArray(v) || !v.length)
        fail(path + " must be nonempty array");
      (v as unknown[]).forEach((x) => check(x, rule["[]"]!, path));
      return;
    }
    if (!v || typeof v !== "object" || Array.isArray(v))
      fail(path + " must be object");
    for (const [key, item] of Object.entries(v as object)) {
      if (item === undefined) continue;
      const child = Object.hasOwn(rule, key) ? rule[key] : rule["*"];
      if (!child) fail(path + "." + key + " is unknown");
      check(item, child!, path + "." + key);
    }
  };
  check(value, shape, "config");
  const c = value as GeneratorConfig;
  for (const v of [c.int64, c.types?.int64])
    if (v !== undefined && !["number", "string", "bigint"].includes(v))
      fail("int64");
  if (
    c.types?.nullable !== undefined &&
    !["union-null", "ignore"].includes(c.types.nullable)
  )
    fail("types.nullable");
  if (
    c.types?.propertyOrder !== undefined &&
    !["alphabetical", "source"].includes(c.types.propertyOrder)
  )
    fail("types.propertyOrder");
  const r = c.requestClient;
  if (r) {
    if (r.mode !== undefined && !["axios", "custom"].includes(r.mode))
      fail("requestClient.mode");
    if (r.mode === "custom") {
      if (
        !r.importPath ||
        !r.identifier ||
        !identifier(r.identifier) ||
        /^(Types|APIS|String|encodeURIComponent|params|data|headers|signal|AbortSignal|Blob|Array|Record|SchemaRef\d+)$/.test(
          r.identifier,
        )
      )
        fail("custom request requires safe importPath/identifier");
    } else if (r.importPath !== undefined || r.identifier !== undefined)
      fail("custom import requires mode custom");
  }
  if (c.enum?.output !== undefined) assertOutputFile(c.enum.output);
  for (const rules of Object.values(c.modules ?? {}))
    for (const rule of rules) {
      if (!rule.name) fail("module rule requires name");
      if (
        [...(rule.include ?? []), ...(rule.exclude ?? [])].some((p) =>
          /[\[\]{}\\]/.test(p),
        )
      )
        fail("glob supports *, ** and ? only");
    }
}
export const defineConfig = (config: GeneratorConfig): GeneratorConfig => {
  validateConfig(config);
  return config;
};
