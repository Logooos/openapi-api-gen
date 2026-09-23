import { identifier } from "./generation-utils.js";
/**
 * OpenAPI API/type 生成配置；可通过 defineConfig 获得配置校验与编辑器提示。
 *
 * OpenAPI API/type generator configuration; use defineConfig for validation and editor hints.
 *
 * @example 独立生成目录 + 排除内部接口 / Isolated output with internal APIs excluded
 * ```ts
 * defineConfig({
 *   input: "./openapi.yaml",
 *   output: "src/apis/generated",
 *   excludeTags: ["internal"],
 * });
 * ```
 */
export type GeneratorConfig = {
  /**
   * OpenAPI JSON/YAML 文件路径或 HTTP(S) URL（CLI 使用）。
   *
   * OpenAPI file path or HTTP(S) URL (CLI only).
   *
   * @example 读取本地规范 / Read a local specification
   * ```ts
   * defineConfig({ input: "./openapi.yaml" });
   * ```
   */
  input?: string;
  /**
   * CLI 输出目录，默认 src/api；配置文件中的相对路径以配置文件目录为基准。
   *
   * CLI output directory, default src/api; config-relative paths resolve from the config directory.
   *
   * @example 隔离生成代码与手写代码 / Isolate generated code
   * ```ts
   * defineConfig({ output: "src/apis/generated" });
   * ```
   */
  output?: string;
  /**
   * 获取远程 OpenAPI 文档时的请求设置，不影响生成的 API 请求。
   *
   * Remote OpenAPI fetch settings, separate from generated API requests.
   *
   * @example 访问需要认证的规范地址 / Fetch a protected specification
   * ```ts
   * defineConfig({ source: { headers: { Authorization: "Bearer <token>" } } });
   * ```
   */
  source?: {
    /**
     * 获取 OpenAPI 的 HTTP headers；不会写入生成文件。
     *
     * HTTP headers for fetching OpenAPI; never emitted into generated files.
     *
     * @example 给规范下载请求添加认证 / Authenticate the specification fetch
     * ```ts
     * defineConfig({ source: { headers: { Authorization: "Bearer <token>" } } });
     * ```
     */
    headers?: Record<string, string>;
  };
  /**
   * 生成 API 使用的 Axios 兼容客户端，默认直接使用 axios。
   *
   * Axios-compatible client used by generated APIs; defaults to axios.
   *
   * @example 复用项目的鉴权拦截器 / Reuse application auth interceptors
   * ```ts
   * defineConfig({
   *   requestClient: { mode: "custom", importPath: "@/utils/request", identifier: "request" },
   * });
   * // @/utils/request must default-export an AxiosInstance.
   * ```
   */
  requestClient?: {
    /**
     * axios 使用默认客户端；custom 使用自定义默认导出的 AxiosInstance。
     *
     * axios uses the default client; custom uses a default-exported AxiosInstance.
     *
     * @example 无自定义客户端时直接使用 Axios / Use Axios directly
     * ```ts
     * defineConfig({ requestClient: { mode: "axios" } });
     * ```
     */
    mode?: "axios" | "custom";
    /**
     * custom 模式必填；按生成文件位置解析的导入路径，推荐 alias/package。
     *
     * Required in custom mode; import path relative to generated files, preferably an alias or package.
     *
     * @example 复用 src/utils/request 的默认导出 / Reuse the default export of src/utils/request
     * ```ts
     * defineConfig({
     *   requestClient: { mode: "custom", importPath: "@/utils/request", identifier: "request" },
     * });
     * // Generated: import request from "@/utils/request";
     * // 项目需配置 @ alias；目标模块默认导出 AxiosInstance。
     * // Configure the @ alias; the target must default-export an AxiosInstance.
     * ```
     */
    importPath?: string;
    /**
     * custom 模式必填；生成代码中的客户端变量名，须为安全的 TS 标识符。
     *
     * Required in custom mode; safe TypeScript identifier for the imported client.
     *
     * @example 指定生成代码中的客户端变量名 / Name the generated client binding
     * ```ts
     * defineConfig({
     *   requestClient: { mode: "custom", importPath: "@/utils/request", identifier: "http" },
     * });
     * // Generated: import http from "@/utils/request";
     * ```
     */
    identifier?: string;
  };
  /**
   * 不生成为 API 参数的 header 名，大小写不敏感；默认 []，常用于 Authorization。
   *
   * Header names omitted from API parameters, case-insensitive; default [], commonly Authorization.
   *
   * @example Authorization 由客户端拦截器统一注入 / Inject auth via client interceptors
   * ```ts
   * defineConfig({ ignoredHeaders: ["Authorization"] });
   * ```
   */
  ignoredHeaders?: string[];
  /**
   * 原始首位 tag → 模块名；优先级低于 path split 和 operation override。
   *
   * Raw first tag → module name; lower priority than path splits and operation overrides.
   *
   * @example 将 Catalog tag 输出到 catalog 模块 / Map the Catalog tag to catalog
   * ```ts
   * defineConfig({ moduleNames: { Catalog: "catalog" } });
   * ```
   */
  moduleNames?: Record<string, string>;
  /**
   * 按原始首位 tag 配置路径拆分；多条规则同时匹配时报错，未匹配时回退到 moduleNames/原 tag。
   *
   * Path split rules keyed by raw first tag; overlapping matches fail, unmatched paths fall back to moduleNames/raw tag.
   *
   * @example 将同一 tag 下的路径拆成两个模块 / Split one tag into two path-based modules
   * ```ts
   * defineConfig({ modules: { Inventory: [
   *   { name: "books", include: ["/books/**"] },
   *   { name: "tools", include: ["/tools/**"] },
   * ] } });
   * ```
   */
  modules?: Record<
    string,
    Array<{
      /**
       * 拆分后的模块名，不支持嵌套目录。
       *
       * Target module name; nested directories are unsupported.
       *
       * @example 将匹配的接口放入 books 模块 / Route matching APIs to books
       * ```ts
       * defineConfig({ modules: { Inventory: [{ name: "books", include: ["/books/**"] }] } });
       * ```
       */
      name: string;
      /**
       * 匹配 OpenAPI 路径的 glob；支持 *、**、?；省略表示全部匹配。
       *
       * OpenAPI path globs supporting *, ** and ?; omitted means match all.
       *
       * @example 只匹配 books 下的路径 / Match paths under books
       * ```ts
       * defineConfig({ modules: { Inventory: [{ name: "books", include: ["/books/**"] }] } });
       * ```
       */
      include?: string[];
      /**
       * 排除路径 glob，优先于此规则的 include；只取消本条映射，不排除接口。
       *
       * Excluded path globs take precedence over this rule's include; skip the mapping, not the operation.
       *
       * @example 管理路径不参与本条拆分，仍可生成 / Keep admin paths outside this split
       * ```ts
       * defineConfig({ modules: { Inventory: [{
       *   name: "books", include: ["/books/**"], exclude: ["/books/admin/**"],
       * }] } });
       * ```
       */
      exclude?: string[];
    }>
  >;
  /**
   * schema 名 → 显式所属模块或 _shared；优先于自动归属，与 overrides.schemas.owner 冲突时报错。
   *
   * Schema name → explicit module or _shared; overrides inference and must agree with overrides.schemas.owner.
   *
   * @example 将仍被引用的 PageVO 固定到共享类型 / Pin a referenced PageVO to shared types
   * ```ts
   * defineConfig({ schemaOwners: { PageVO: "_shared" } });
   * ```
   */
  schemaOwners?: Record<string, string>;
  /**
   * 原始 operationId 白名单；省略表示全选，[] 表示全排除；排除配置优先。
   *
   * Raw operationId allowlist; omitted selects all, [] selects none; exclusions take precedence.
   *
   * @example 只生成选中的 operationId / Generate selected operationIds only
   * ```ts
   * defineConfig({ includeOperations: ["getBooks", "getBook"] });
   * ```
   */
  includeOperations?: string[];
  /**
   * 按原始 operationId 排除接口，优先于 includeOperations；默认 []。
   *
   * Exclude raw operationIds, overriding includeOperations; default [].
   *
   * @example 跳过暂不接入的接口 / Omit an unwanted operation
   * ```ts
   * defineConfig({ excludeOperations: ["deleteAllBooks"] });
   * ```
   */
  excludeOperations?: string[];
  /**
   * 精确且区分大小写匹配任意原始 tag（不限首位）；命中即排除，优先于 includeOperations 和模块映射；默认 []。
   *
   * Exclude on any exact, case-sensitive raw tag match, before includeOperations and module mapping; default [].
   *
   * @example 屏蔽内部接口，任意位置的 tag 命中即排除 / Exclude any matching raw tag
   * ```ts
   * defineConfig({ excludeTags: ["internal", "debug", "测试接口"] });
   * // tags: ["Catalog", "internal"] → excluded
   * // tags: ["Catalog", "Internal"] → retained
   * ```
   */
  excludeTags?: string[];
  /**
   * 生成 TypeScript 类型的映射及属性顺序。
   *
   * TypeScript type mapping and property ordering.
   *
   * @example 调整类型映射与属性顺序 / Customize type mapping and ordering
   * ```ts
   * defineConfig({ types: { int64: "string", propertyOrder: "source" } });
   * ```
   */
  types?: {
    /**
     * int64 映射类型，默认 number；优先于顶层 int64。
     *
     * int64 representation, default number; overrides top-level int64.
     *
     * @example 后端用字符串传递 int64 ID / Backend sends int64 IDs as strings
     * ```ts
     * defineConfig({ types: { int64: "string" } });
     * // 只改变 TS 类型，不转换响应数据。 / Types only; no response conversion.
     * ```
     */
    int64?: "number" | "string" | "bigint";
    /**
     * 默认 union-null 保留 T | null；ignore 忽略 nullable。
     *
     * Default union-null preserves T | null; ignore drops nullability.
     *
     * @example 保留契约中的可空类型 / Preserve contract nullability
     * ```ts
     * defineConfig({ types: { nullable: "union-null" } });
     * // nullable string → string | null
     * ```
     */
    nullable?: "union-null" | "ignore";
    /**
     * 默认 alphabetical 按字符编码排序；source 保留声明顺序；仅影响类型属性。
     *
     * Default alphabetical uses code-unit ordering; source preserves declaration order; affects type properties only.
     *
     * @example 便于对照规范原始字段顺序 / Follow specification property order
     * ```ts
     * defineConfig({ types: { propertyOrder: "source" } });
     * ```
     */
    propertyOrder?: "alphabetical" | "source";
  };
  /**
   * 兼容旧 Core 配置的 int64 简写，默认 number；推荐 types.int64，且后者优先。
   *
   * Legacy Core shorthand, default number; prefer types.int64, which takes precedence.
   *
   * @example 旧配置迁移到 types.int64 / Migrate the legacy shorthand
   * ```ts
   * defineConfig({ int64: "string" }); // Legacy
   * defineConfig({ types: { int64: "string" } }); // Preferred
   * ```
   */
  int64?: "number" | "string" | "bigint";
  /**
   * x-enum-name 运行时枚举配置；普通 OpenAPI enum 仍生成字面量联合类型。
   *
   * Runtime x-enum-name enum settings; standard OpenAPI enums remain literal unions.
   *
   * @example 无需运行时枚举时关闭输出 / Disable runtime enum output
   * ```ts
   * defineConfig({ enum: { enabled: false } });
   * ```
   */
  enum?: {
    /**
     * 是否生成可可靠解析的运行时枚举，默认 true；DTO/VO 字段仍为原始 primitive。
     *
     * Emit reliably parsed runtime enums, default true; DTO/VO fields retain their primitive type.
     *
     * @example 保留默认的运行时枚举输出 / Enable runtime enum output
     * ```ts
     * defineConfig({ enum: { enabled: true } });
     * ```
     */
    enabled?: boolean;
    /**
     * 相对于输出目录的安全 .ts 文件路径，默认 _shared/enum.ts。
     *
     * Safe .ts path relative to the output directory, default _shared/enum.ts.
     *
     * @example 调整枚举文件位置 / Change the enum file location
     * ```ts
     * defineConfig({ enum: { output: "_shared/enums.ts" } });
     * ```
     */
    output?: string;
  };
  /**
   * 根目录模块汇总导出配置。
   *
   * Root module barrel export settings.
   *
   * @example 需要根目录汇总导出时启用 / Enable a root barrel
   * ```ts
   * defineConfig({ barrel: { enabled: true } });
   * ```
   */
  barrel?: {
    /**
     * 默认 false；启用后在 index.ts 以 Module0、Module1 等 namespace 导出。
     *
     * Default false; emits namespace exports such as Module0 and Module1 in index.ts.
     *
     * @example 从根入口按模块 namespace 导入 / Import module namespaces from the root
     * ```ts
     * defineConfig({ barrel: { enabled: true } });
     * // Generated: export * as Module0 from "./catalog/index";
     * ```
     */
    enabled?: boolean;
  };
  /**
   * 对指定 operation/schema 的显式覆盖规则。
   *
   * Explicit overrides for individual operations and schemas.
   *
   * @example 显式组织单个接口 / Customize a specific operation
   * ```ts
   * defineConfig({ overrides: { operations: { getBooks: { module: "catalog" } } } });
   * ```
   */
  overrides?: {
    /**
     * 以原始 operationId 为 key；未知 key 会报配置错误。
     *
     * Keyed by raw operationId; unknown keys are configuration errors.
     *
     * @example 覆盖已有 operationId 的命名 / Rename an existing operation
     * ```ts
     * defineConfig({ overrides: { operations: { getBooks: { name: "listBooks" } } } });
     * ```
     */
    operations?: Record<
      string,
      {
        /**
         * 覆盖 operationId 命名来源，同时影响 req 函数名和 APIS key。
         *
         * Override the operationId naming input for both req function names and APIS keys.
         *
         * @example 将 getBooks 生成为 reqListBooks / Generate reqListBooks from getBooks
         * ```ts
         * defineConfig({ overrides: { operations: { getBooks: { name: "listBooks" } } } });
         * ```
         */
        name?: string;
        /**
         * 显式模块归属，优先于路径拆分和 moduleNames；不能恢复被 excludeTags 排除的接口。
         *
         * Explicit module, overriding path splits and moduleNames; cannot restore tag-excluded operations.
         *
         * @example 将单个接口放到 catalog / Move one API into catalog
         * ```ts
         * defineConfig({ overrides: { operations: { getBooks: { module: "catalog" } } } });
         * ```
         */
        module?: string;
        /**
         * 覆盖选中响应：blob、void、primitive、本地 schema、[] 或 | 联合；2xx 优先，否则 default；不补造缺失契约。
         *
         * Override selected responses with blob, void, primitives, local schemas, [] or | unions; 2xx first, otherwise default; never invents a missing contract.
         *
         * @example 明确声明下载响应为 Blob / Explicitly select a Blob response
         * ```ts
         * defineConfig({ overrides: { operations: { download: { responseType: "blob" } } } });
         * ```
         */
        responseType?: string;
        /**
         * 排除此接口，优先于 includeOperations；默认 false。
         *
         * Exclude this operation even if included by includeOperations; default false.
         *
         * @example 保留规范但不生成某个接口 / Keep the spec but skip one API
         * ```ts
         * defineConfig({ overrides: { operations: { deleteAllBooks: { exclude: true } } } });
         * ```
         */
        exclude?: boolean;
      }
    >;
    /**
     * 以原始 schema 名为 key 的覆盖规则。
     *
     * Overrides keyed by original schema name.
     *
     * @example 显式配置已声明 schema 的归属 / Assign an existing schema owner
     * ```ts
     * defineConfig({ overrides: { schemas: { PageVO: { owner: "_shared" } } } });
     * ```
     */
    schemas?: Record<
      string,
      {
        /**
         * 显式所属模块或 _shared；与 schemaOwners 中同名配置必须一致。
         *
         * Explicit owning module or _shared; must agree with schemaOwners for this schema.
         *
         * @example 把仍被引用的 PageVO 放入共享类型 / Place referenced PageVO in shared types
         * ```ts
         * defineConfig({ overrides: { schemas: { PageVO: { owner: "_shared" } } } });
         * ```
         */
        owner?: string;
      }
    >;
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
