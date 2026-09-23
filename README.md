# openapi-api-gen

OpenAPI 3.0.x / 3.1.x → TypeScript API/type generator，提供 Core API 和 CLI。已发布到 npm，要求 **Node.js ≥22.12**。

[npm package](https://www.npmjs.com/package/openapi-api-gen) · [GitHub](https://github.com/Logooos/openapi-api-gen) · [MIT License](LICENSE)

## Quick Start

### 1. 安装

在使用生成代码的项目中安装：

```sh
pnpm add -D openapi-api-gen
```

或使用 npm：

```sh
npm install -D openapi-api-gen
```

生成代码默认使用 Axios；项目尚未安装时，添加运行时依赖：

```sh
pnpm add axios
# npm 用户：npm install axios
```

也可以在配置中指定项目已有的、默认导出的 AxiosInstance request。

### 2. 创建配置

在项目根目录创建 `openapi-gen.config.ts`，将 OpenAPI 3.0/3.1 JSON 或 YAML 文件保存为 `openapi.yaml`（也可将 input 替换为自己的文件路径或 HTTP(S) URL）：

```ts
import { defineConfig } from "openapi-api-gen";

export default defineConfig({
  input: "./openapi.yaml",
  output: "src/apis/generated",
});
```

推荐将 `src/apis/generated` 用作 generated transport layer。`output` 完全可配置，不是硬编码目录；省略时默认输出到 `src/api`。

### 3. 添加 script

在项目 `package.json` 的 `scripts` 中添加：

```json
{
  "scripts": {
    "api:generate": "openapi-api-gen --config openapi-gen.config.ts"
  }
}
```

### 4. 生成

```sh
pnpm api:generate
```

npm 用户可运行 `npm run api:generate`。若要先预览文件变更而不写入：

```sh
pnpm api:generate --dry-run
```

普通 generated API 可直接导入调用，返回 Axios promise，不自动解包 `.data`。手写 adapter 仅用于业务特殊场景，不是强制层。

建议将 generated 文件及管理清单 `.openapi-api-gen.json` 一起提交 Git。不要手工修改生成文件；更新 OpenAPI 或配置后，重新 generate，review diff，再提交变更。

## CLI

```sh
pnpm exec openapi-api-gen https://example.com/v3/api-docs --header "Authorization=Bearer TOKEN" --output generated/api
pnpm exec openapi-api-gen --config openapi-gen.config.ts
pnpm exec openapi-api-gen --module catalog --dry-run
pnpm exec openapi-api-gen diagnose ./openapi.json
pnpm exec openapi-api-gen generate ./openapi.yaml --plan
pnpm exec openapi-api-gen --help
```

JSON/YAML 按内容解析；HTTP(S) 使用 Node 原生 fetch、30 秒超时并支持重定向。`diagnose` 输出规范统计；`--plan` 输出内存中的 `{ plan, files, enums }` JSON，不写文件。普通生成输出 JSON 统计、diagnostics 和文件变更计划。

## 既有项目的独立生成层

推荐将生成文件与手写业务包装隔离，例如配置 output 为 `src/apis/generated`：

```text
src/apis/
├─ generated/       # 工具管理的 transport API/type，内部使用单层 module
├─ custom-workflows/ # 可选的手写业务 adapter
└─ type.ts          # 手写类型，不由工具管理
```

普通调用可直接使用 generated API；特殊业务也可通过手写 adapter 调用 generated API，或独立保留请求。adapter 不是强制层。该目录名仅为示例，`output` 完全可配置，默认仍为 `src/api`。当前不支持嵌套模块路径或任意多 tag 合并；生成模块用于组织 transport 文件。

## 配置

当前工作目录自动发现 `openapi-gen.config.ts`；也可用 `--config` 指定。配置是执行的 TypeScript 模块，应来自可信项目。完整示例（schema/tag/operation 名称须替换为自己的规范内容）：

```ts
import { defineConfig } from "openapi-api-gen";

export default defineConfig({
  input: "./openapi.yaml",
  output: "src/apis/generated",
  source: {
    headers: { Authorization: process.env.OPENAPI_TOKEN ?? "" },
  },
  requestClient: {
    mode: "custom",
    importPath: "@/utils/request",
    identifier: "request",
  },
  ignoredHeaders: [
    "Authorization",
    "Accept-Language",
    "Time-Zone",
    "language",
    "module",
  ],
  moduleNames: { Catalog: "catalog" },
  modules: {
    Inventory: [
      { name: "books", include: ["/books/**"] },
      { name: "tools", include: ["/tools/**"] },
    ],
  },
  schemaOwners: { JsonNode: "_shared" },
  types: {
    int64: "number",
    nullable: "union-null",
    propertyOrder: "alphabetical",
  },
  enum: { enabled: true, output: "_shared/enum.ts" },
  barrel: { enabled: false },
  // includeOperations: ["getPage_1", "download"], // 省略表示全选；空数组表示全排除
  excludeOperations: [],
  excludeTags: ["internal", "debug", "测试接口"], // 任意原始 tag 精确命中即排除
  overrides: {
    operations: {
      getPage_1: { name: "getCatalogPage", module: "catalog" },
      download: { responseType: "blob" },
    },
    schemas: { JsonNode: { owner: "_shared" } },
  },
});
```

零配置 request 为 `{ mode: "axios" }`；custom 必须提供默认导出的 AxiosInstance `importPath` 和 `identifier`。路径按生成文件位置解释，建议项目 alias 或 package import。不会 unwrap `.data`。

优先级为显式 CLI > config > environment > defaults。未提供的 CLI 项不覆盖配置；列表整体替换，types/enum/barrel 的字段合并。源请求 headers 按不区分大小写的 key 合并。配置中的相对 input/output 以配置文件目录为基准；CLI 和环境相对路径以工作目录为基准。

环境变量：`OPENAPI_GEN_INPUT`、`OPENAPI_GEN_OUTPUT`、`OPENAPI_GEN_HEADERS`（JSON 字符串对象）。也可在 TS config 读取 `process.env`；工具不自动加载 `.env`。源 HTTP headers 与生成 API 的 ignoredHeaders 是不同配置。CLI 不输出 header 值。

CLI 覆盖项：`--output/-o`、`--config/-c`、重复 `--header key=value`、`--ignored-header`、`--include-operation`、`--exclude-operation`、`--int64`、`--nullable`、`--barrel/--no-barrel`、`--no-enum`。未知配置/参数和值错误均报错；完整参数见 `--help`。

## 模块与 override

- 仅采用第一个 tag。归属优先级：operation override → 匹配的 path split → moduleNames → 原 tag。glob 支持 `*`（不跨 `/`）、`**`（跨目录）、`?`；exclude 优先；未命中 split 回到原 tag/rename；命中多个 split 报冲突。
- operation include/exclude 和 override key 使用原始 operationId，exclude 优先。name 同步影响函数和 APIS；保留 `_1`、`_2` 后缀；原始重复 operationId 始终致命。
- `excludeTags?: string[]` 默认 `[]`。区分大小写、精确匹配 operation 的所有原始 tags，任意一个命中即排除整个接口（包括非首位 tag）；无 tags 的接口不受影响。优先于 includeOperations、moduleNames、path split 和 operation module override，不能用 includeOperations 重新纳入。excludeOperations 的既有行为保持不变；配置文件同时用于 Core、CLI plan、dry-run 和实际生成。
- 按 tag 排除的接口不计入 deferred，不产生该接口的 unsupported warning，也不参与 schema usage/ownership；仅由它引用的类型不再生成，仍被其他接口引用的 shared/SCC 类型继续保留或重新归属。独立 schema 和 runtime enum 的既有全局处理策略不变。变更过滤条件后建议先 dry-run，再全量 generate 并 review diff：manifest 管理的过期文件会清理，可能涉及整个模块和类型迁移，handwritten/非生成文件保留。
- responseType 支持 `blob`、`void`、`string/number/boolean/integer`、本地命名 schema、数组后缀 `[]` 和 `|` 联合；不执行任意 TS 类型表达式。替换选中的显式 2xx 响应；没有 2xx 时替换 default fallback，不补造不存在的 response contract。
- schemaOwners 和 overrides.schemas.owner 都覆盖自动推导；两处显式配置不一致会报错。全局图和 SCC 仍保证唯一 schema 定义及稳定 import type。
- `types.int64` 支持 number/string/bigint；`types.nullable` 支持 union-null/ignore。`types.propertyOrder` 默认为 alphabetical（不依赖 locale），可设 source 保留规范声明顺序；只控制类型属性，不改变 import、APIS、函数或 enum 成员顺序。旧 Core `int64` 简写继续有效，types.int64 优先。
- root barrel 默认关闭；开启后以排序模块对应的 `Module0`、`Module1` 等 namespace 导出，避免不同模块 APIS 同名冲突。模块集合变化可能改变这些别名，业务代码宜直接导入模块。

## 文件写入与单模块

先完整计算并格式化所有目标文件，再与磁盘内容比较。报告的 `changes`/`summary` 包含 create/modify/delete/unchanged；**管理清单 `.openapi-api-gen.json` 也计为一个文件**。不生成时间戳，unchanged 不写，mtime 保持不变。

已有同名目标 index.ts/type.ts 会直接覆盖，不合并手写内容。清单记录工具管理的路径：删掉 operation 后重写模块，消失的 schema/module 文件在全量生成时清理。其他手写文件不删除，空目录保留。丢失清单时无法自动判断历史文件归属，不猜测删除；清单应随生成目录保留。工具管理的文件中追加的手写内容不受保护。

`--dry-run` 不创建目录、清单或文件，计划与同状态下的真实写入相同。写入前校验全部路径和清单，拒绝路径越界、链接目标、大小写/Unicode 冲突；清单最后写入。多文件写入不是事务，磁盘 I/O 中断后应重新运行完整生成；同一输出目录应串行运行。

`--module` 接收最终模块名，仍计算全局 ownership，并写入该模块及其类型依赖和全局枚举；不重复 schema，不清理其他模块。若已经管理的未选模块也需要变化，则报 `PARTIAL_REQUIRES_FULL_RUN`，需执行一次全量生成以恢复一致性。全量变更模块归属、删除整个模块或调整 root barrel 时使用全量生成。首次单模块运行不创建 root barrel。

每个目标文件发现项目 Prettier 配置（含 overrides、editorconfig），无配置则使用内置 TypeScript/LF 默认格式。没有额外格式化配置框架。

## Core、诊断与边界

```ts
import {
  generate,
  normalizeSpec,
  parseSpec,
  defineConfig,
} from "openapi-api-gen";
const result = await generate(
  normalizeSpec(parseSpec(sourceText)),
  defineConfig({
    ignoredHeaders: ["Authorization"],
  }),
);
// result.files: { path, content }[]；Core 无磁盘写入、配置加载或网络访问。
```

Core 默认固定 Prettier 格式。可选第三参数 `(path, source) => Promise<string>` 提供目标项目格式化器；CLI 用同一个 Core 加载项目 Prettier，因此相同输入、配置和格式化上下文逐字节一致。

生成目录为 `<module>/index.ts` + `type.ts`、`_shared/type.ts`、可解析时 `_shared/enum.ts`。API 保持 Axios promise、可选末尾 signal、path 编码替换、专用 query Params、业务 Headers。显式 2xx（含受支持的 `2XX`）优先，多种 body 为去重 union，不混入 default/error schema。没有显式 2xx 时使用声明的 default response contract，正常生成 API 和引用类型，并报告非阻断 warning `DEFAULT_RESPONSE_FALLBACK`；无 content/body 时返回 void。两者都没有才因 `NO_SUCCESS_RESPONSE` deferred，其他不支持的请求/类型规则仍适用。generator 不猜测不存在的 response schema，Axios 的响应和错误处理语义不变。

正常和 recoverable warning/operation 暂缓退出 0；fatal 输入/config/归属/输出/加载错误退出 1。调用方必须检查 stats 和 diagnostics，0 不表示每个 operation 都生成。diagnose 提供版本、operation/schema/tag/module 数、重复/缺失 operationId、multipart 和 x-enum-name 数。

当前不支持 multipart 自动 FormData、未声明的响应推断、JSON binary body 猜测、React Query hooks、enum-list 网络请求。cookie、复杂参数序列化、非 JSON body 等不支持的情况会给出明确诊断，必要时跳过 operation。外部引用与未知 schema/format 按 Core 策略回退并报告诊断；本工具不是完整 JSON Schema 验证器。

x-enum-name 字段保持 primitive；runtime enum 仅解析 OpenAPI metadata，不翻译、不猜测。普通 enum 仍为 literal union。未知 schema 使用 documented unknown fallback + warning；未知 format 保留基础类型。

## 开发与验证

在 GitHub 仓库中运行 `pnpm install --frozen-lockfile` 安装开发依赖，`pnpm check` 运行 typecheck、test、format:check、build。回归测试使用合成 fixtures，覆盖 CLI/Core 一致性、严格编译、共享 schema/SCC、枚举、dry-run、零变化重复写入与独立生成层保护。

## 维护者发布

1. 更新 `CHANGELOG.md` 并提交，在干净的 `main` 分支上执行发布。
2. 明确选择一个命令：`pnpm release:patch`、`pnpm release:minor` 或 `pnpm release:major`。release-it 依次运行 `pnpm check` 和 `npm pack --dry-run`，更新版本并刷新锁文件，创建 `chore: release vX.Y.Z` commit 和 `vX.Y.Z` tag，然后一并 push。
3. GitHub Actions 的 `publish` job 在安装项目依赖前校验 tag，随后冻结安装、运行回归和打包检查，通过 npm Trusted Publishing 发布到官方 registry（显式启用 provenance）。发布前查询 exact version，已存在且与 `package.json` 一致则跳过 publish。本地不执行 npm publish。

独立的 `release` job 依赖 `publish` 成功，检出当前 tag 后查询 `openapi-api-gen@${expected}`。npm 新版本可见性可能延迟，因此每 2 分钟检查一次，最多 15 次，单次请求超时 15 秒；只有返回值严格等于 `package.json.version` 才创建 GitHub Release。dist-tags/latest 仅供日志观察，不阻塞 Release；该 tag 的 Release 已存在时跳过创建。

如果 npm publish 成功但等待可见性超时，在 Actions 中选择 **Re-run failed jobs**，安全重试独立的 `release` job，它不会调用 npm publish。误选 **Re-run all jobs** 时，已可查询的 exact version 会阻止重复 publish，已存在的 GitHub Release 也不会重复创建。若刚发布的版本仍不可见，发布前查询无法证明它已存在，因此应优先仅重试失败的 release job；不要修改或移动已发布 tag 来恢复。

## 生成代码风格（0.5.1）

普通 application/json 请求不注入 Content-Type，业务 header 仍保留。值占位使用 `void 0`；可选参数位于必填参数之前时，用 `{ value?: T }["value"]` 保持原来的可传空值语义，不输出该关键字。

APIS 使用合法 IdentifierName 的 dot access，其他 key 回退 bracket access。类型引用仅使用已用到、去重排序的 named import type；有名字冲突时稳定分配别名。生成的相对 import 默认不带 .js，面向 Vite/Bundler；这不改变 generator 包本身的 Node ESM import。runtime enum 保持运行时值。

单行描述为 `/** 描述 */`，真实多行描述或多个文档段落保留多行 JSDoc，属性之间不自动添加空行。相关行为由公开自动化回归测试验证。

## License

本项目采用 [MIT License](LICENSE)，Copyright (c) 2026 Logooos。
