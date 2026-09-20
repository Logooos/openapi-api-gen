import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import axios from "axios";
import type { AxiosRequestConfig } from "axios";
import { generate, normalizeSpec, parseSpec } from "../src/core/index.js";
import type { GenerationResult } from "../src/core/index.js";

const load = async (path: string) =>
  normalizeSpec(parseSpec(await readFile(path, "utf8")));
const compile = async (result: GenerationResult, consumer = "") => {
  const root = resolve(".");
  const folder = await mkdtemp(join(root, ".phase2-test-"));
  const cleanup = async () => {
    assert.equal(dirname(resolve(folder)), root);
    assert.ok(folder.startsWith(join(root, ".phase2-test-")));
    await rm(folder, { recursive: true, force: true });
  };
  try {
    for (const file of result.files) {
      const target = join(folder, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    await writeFile(join(folder, "consumer.ts"), consumer || "export {};");
    await writeFile(
      join(folder, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          types: [],
          noUnusedLocals: true,
          noUnusedParameters: true,
        },
        include: ["**/*.ts"],
      }),
    );
    try {
      await promisify(execFile)(process.execPath, [
        "node_modules/typescript/bin/tsc",
        "-p",
        join(folder, "tsconfig.json"),
      ]);
    } catch (error) {
      throw new Error((error as { stdout: string }).stdout, { cause: error });
    }
    return { folder, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
};

test("basic API/types compile with real Axios and preserve request semantics", async (t) => {
  const doc = await load("test/fixtures/phase2.yaml");
  const options = { ignoredHeaders: ["authorization"] };
  const result = await generate(doc, options);
  assert.deepEqual(result, await generate(doc, options));
  assert.deepEqual(result.plan.stats, {
    operations: 6,
    generatedOperations: 6,
    deferredOperations: 0,
    modules: 1,
    schemas: 3,
    generatedSchemas: 3,
    deferredSchemas: 0,
    unusedSchemas: 0,
  });
  const api = result.files.find((f) => f.path === "records/index.ts")!.content;
  const types = result.files.find((f) => f.path === "records/type.ts")!.content;
  assert.match(api, /export const APIS/);
  assert.match(api, /reqSaveRecord_1/);
  assert.match(api, /value\?: SaveRecord_1Params/);
  assert.match(api, /import type/);
  assert.doesNotMatch(api, /\.data\b|Authorization/);
  assert.match(types, /mode: string/);
  assert.match(types, /status\?: "READY" \| "FAILED"/);
  assert.match(types, /optional\?: string \| null/);
  assert.match(types, /Record<string, number>/);
  assert.match(types, /export type SaveRecord_1Response = RecordVO \| void/);
  assert.match(types, /\[key: string\]: any/);
  assert.doesNotMatch(types, /interface |export enum/);
  const compiled = await compile(
    result,
    `
import { reqSaveRecord_1, reqGetPage, reqUpdate, reqBinary } from './records/index.js';
import type { RecordDTO, SaveRecord_1Response } from './records/type.js';
import type { AxiosResponse } from 'axios';
const dto: RecordDTO = { name: 'x', mode: 'any primitive' };
const save: Promise<AxiosResponse<SaveRecord_1Response>> = reqSaveRecord_1(1, '/', undefined, dto, { 'X-Tenant': 'a' });
const binary: Promise<AxiosResponse<Blob>> = reqBinary();
reqUpdate();
reqGetPage({ page: 1 });
// @ts-expect-error required query object
reqGetPage();
// @ts-expect-error required field
const invalid: RecordDTO = { mode: 'x' };
// @ts-expect-error standard enum is constrained
const wrongEnum: RecordDTO = { name: 'x', mode: 'x', status: 'OTHER' };
export { save, binary, invalid, wrongEnum };
`,
  );
  t.after(compiled.cleanup);
  const generated = await import(
    pathToFileURL(join(compiled.folder, "records/index.ts")).href
  );
  const promise = Promise.resolve({ data: "unchanged" });
  const post = t.mock.method(axios, "post", () => promise);
  const signal = new AbortController().signal;
  const data = { name: "x", mode: "READY" };
  const params = { q: "a b" };
  assert.equal(
    generated.reqSaveRecord_1(
      1,
      "a/b ?",
      params,
      data,
      { "X-Tenant": "tenant" },
      signal,
    ),
    promise,
  );
  assert.deepEqual(post.mock.calls[0]?.arguments, [
    "/records/1/a%2Fb%20%3F",
    data,
    {
      params,
      signal,
      headers: { "X-Tenant": "tenant" },
    },
  ]);
  const del = t.mock.method(axios, "delete", () => promise);
  generated.reqRemove_2(2, "#", signal);
  assert.deepEqual(del.mock.calls[0]?.arguments, [
    "/records/2/%23",
    { signal },
  ]);
  const get = t.mock.method(axios, "get", () => promise);
  generated.reqBinary(signal);
  assert.deepEqual(get.mock.calls[0]?.arguments, [
    "/binary",
    { signal, responseType: "blob" },
  ]);
  const put = t.mock.method(axios, "put", () => promise);
  assert.equal(generated.reqUpdate(undefined, signal), promise);
  assert.deepEqual(put.mock.calls[0]?.arguments, [
    "/records",
    undefined,
    { signal },
  ]);
  const patch = t.mock.method(axios, "patch", () => promise);
  generated.reqPatch(signal);
  assert.deepEqual(patch.mock.calls[0]?.arguments, [
    "/records",
    undefined,
    { signal },
  ]);
});

test("shared dependencies generate while unsupported operations remain deferred", async (t) => {
  const result = await generate(
    await load("test/fixtures/phase2-deferred.yaml"),
  );
  assert.deepEqual(result.plan.sharedSchemas, ["Shared"]);
  assert.equal(result.plan.stats.generatedOperations, 3);
  assert.equal(result.plan.stats.deferredOperations, 3);
  assert.equal(result.plan.stats.generatedSchemas, 2);
  assert.equal(result.plan.stats.deferredSchemas, 0);
  assert.ok(
    !result.plan.deferredOperations.some((op) => op.operationId === "a"),
  );
  assert.deepEqual(
    result.plan.deferredOperations.find((op) => op.operationId === "fallback")
      ?.reasons,
    ["NO_SUCCESS_RESPONSE"],
  );
  assert.deepEqual(
    result.plan.deferredOperations.find((op) => op.operationId === "jsonBinary")
      ?.reasons,
    ["JSON_BINARY_REQUEST"],
  );
  assert.ok(result.files.some((f) => f.path === "_shared/type.ts"));
  assert.ok(
    result.files.filter((f) => f.content.includes("export type Shared"))
      .length === 1,
  );
  const compiled = await compile(result);
  t.after(compiled.cleanup);
});

test("3.1 type alternatives and query arrays keep valid type and wire semantics", async (t) => {
  const result = await generate(await load("test/fixtures/phase2-types.yaml"));
  assert.deepEqual(result.plan.deferredOperations[0]?.reasons, [
    "AMBIGUOUS_RESPONSE_TRANSPORT",
  ]);
  assert.ok(result.plan.diagnostics.some((d) => d.code === "UNKNOWN_FORMAT"));
  assert.ok(result.plan.diagnostics.some((d) => d.code === "SCHEMA_FALLBACK"));
  const compiled = await compile(
    result,
    `
import type { Value } from './values/type.js';
export const stringValue: Value = { mixed: 'value', nil: null };
export const objectValue: Value = { mixed: { id: 1 }, nil: null };
// @ts-expect-error null-only type must not widen to unknown
export const badNull: Value = { mixed: 'value', nil: 1 };
// @ts-expect-error mixed primitive excludes boolean
export const badType: Value = { mixed: false, nil: null };
`,
  );
  t.after(compiled.cleanup);
  const generated = await import(
    pathToFileURL(join(compiled.folder, "values/index.ts")).href
  );
  let uri = "";
  t.mock.method(axios, "get", (url: string, config?: AxiosRequestConfig) => {
    uri = axios.getUri({ ...config, url });
    return Promise.resolve({ data: null });
  });
  generated.reqValues({ labels: ["one", "two"] });
  assert.equal(uri, "/values?labels=one&labels=two");
});

test("default response references participate in audit and ownership", async () => {
  const input = "test/fixtures/audit-default-response.json";
  const result = await generate(await load(input));
  assert.deepEqual(result.plan.sharedSchemas, ["Child", "Value"]);
  assert.equal(result.plan.stats.generatedOperations, 1);
  assert.deepEqual(result.plan.sharedSchemaNames, ["Child", "Value"]);
  const { stdout } = await promisify(execFile)(process.execPath, [
    "scripts/audit-spec.mjs",
    input,
  ]);
  const audit = JSON.parse(stdout);
  assert.deepEqual(audit.moduleUsage.Value, ["a", "b"]);
  assert.deepEqual(audit.usageCounts, { unused: 0, single: 0, shared: 2 });
  assert.equal(audit.counts.$ref, 4);
  assert.deepEqual(audit.invalidRefs, []);
});

test("actual generated response alias collisions are still fatal", async () => {
  const doc = await load("test/fixtures/phase2-response-name.yaml");
  doc.operations[0]!.responses.push({
    status: "204",
    description: "Empty",
    content: {},
    raw: { description: "Empty" },
  });
  await assert.rejects(generate(doc), /GENERATED_NAME_COLLISION/);
});

test("generate CLI emits the in-memory result and rejects fatal input", async () => {
  const run = promisify(execFile);
  const args = [
    "--import",
    "tsx",
    "src/cli/index.ts",
    "generate",
    "--plan",
    "test/fixtures/phase2-response-name.yaml",
  ];
  const first = await run(process.execPath, args);
  const second = await run(process.execPath, args);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stderr, "");
  assert.deepEqual(
    JSON.parse(first.stdout).files.map((file: { path: string }) => file.path),
    ["result/index.ts", "result/type.ts"],
  );
  await assert.rejects(
    run(process.execPath, [
      ...args.slice(0, -1),
      "test/fixtures/duplicate.yaml",
    ]),
    /DUPLICATE_OPERATION_ID/,
  );
});

test("int64 options, input validation, names and module paths", async (t) => {
  const document = await load("test/fixtures/phase2.yaml");
  for (const int64 of ["string", "bigint"] as const) {
    const result = await generate(document, { int64 });
    assert.match(
      result.files.find((f) => f.path.endsWith("/type.ts"))!.content,
      new RegExp(`count\\?: ${int64}`),
    );
    t.after((await compile(result)).cleanup);
  }
  await assert.rejects(
    generate(await load("test/fixtures/duplicate.yaml")),
    /DUPLICATE_OPERATION_ID/,
  );
  const invalid = structuredClone(document);
  invalid.operations[0]!.module = "../escape";
  await assert.rejects(generate(invalid), /INVALID_OUTPUT_PATH/);
  const colliding = structuredClone(document);
  colliding.operations[0]!.module = "Records";
  await assert.rejects(generate(colliding), /MODULE_NAME_COLLISION/);
  const names = structuredClone(document);
  names.operations[0]!.operationId = "get-page";
  await assert.rejects(generate(names), /GENERATED_NAME_COLLISION/);
});

test("all existing valid small fixtures produce compileable files or explicit deferrals", async (t) => {
  for (const fixture of [
    "basic.json",
    "basic.yaml",
    "model-metadata.yaml",
    "phase2-response-name.yaml",
  ]) {
    const result = await generate(await load(`test/fixtures/${fixture}`));
    assert.equal(
      result.plan.stats.generatedOperations +
        result.plan.stats.deferredOperations,
      result.plan.stats.operations,
    );
    t.after((await compile(result)).cleanup);
  }
});

const fileContent = (result: GenerationResult, path: string) =>
  result.files.find((file) => file.path === path)!.content;
const assertUniqueSchemas = (result: GenerationResult) => {
  const names = [
    ...result.plan.sharedSchemaNames,
    ...result.plan.modules.flatMap((module) => module.schemaNames),
  ];
  assert.equal(names.length, new Set(names).size);
  assert.equal(names.length, result.plan.stats.generatedSchemas);
  for (const name of names) {
    const count = result.files
      .flatMap((file) => [
        ...file.content.matchAll(/export type ([\p{L}\p{N}_$]+)\s*=/gu),
      ])
      .filter((match) => match[1] === name).length;
    assert.equal(count, 1, name + " must have one definition");
  }
};

test("Phase 3 computes transitive usage, unique owners and shared imports before emission", async (t) => {
  const doc = await load("test/fixtures/phase3.yaml");
  const result = await generate(doc);
  assert.deepEqual(result.plan.schemaUsage.Shared, ["alpha", "beta"]);
  assert.deepEqual(result.plan.schemaUsage.Leaf, ["alpha", "beta"]);
  assert.deepEqual(result.plan.schemaDependencies.Alpha, [
    "Alpha",
    "LocalA",
    "Shared",
  ]);
  assert.deepEqual(result.plan.schemaOwners, {
    Alpha: "alpha",
    Beta: "beta",
    Leaf: "_shared",
    LocalA: "alpha",
    LocalB: "alpha",
    Shared: "_shared",
    Unused: null,
  });
  assert.deepEqual(result.plan.sharedSchemaNames, ["Leaf", "Shared"]);
  assert.ok(
    result.plan.stronglyConnectedComponents.some(
      (component) => JSON.stringify(component) === '["LocalA","LocalB"]',
    ),
  );
  assert.match(
    fileContent(result, "alpha/type.ts"),
    /import type \{ Shared \} from "\.\.\/_shared\/type"/,
  );
  assert.equal(
    fileContent(result, "alpha/type.ts").match(/import type/g)?.length,
    1,
  );
  assert.doesNotMatch(fileContent(result, "_shared/type.ts"), /import type/);
  assertUniqueSchemas(result);
  assert.deepEqual(result, await generate(doc));
  const reordered = structuredClone(doc);
  reordered.schemas = Object.fromEntries(
    Object.entries(reordered.schemas).reverse(),
  );
  assert.deepEqual(result, await generate(reordered));
  t.after((await compile(result)).cleanup);
});

test("explicit owners override inference and imports have stable paths and symbol order", async (t) => {
  const doc = await load("test/fixtures/phase3.yaml");
  const options = {
    schemaOwners: { Shared: "alpha", Leaf: "alpha", Beta: "alpha" },
  };
  const result = await generate(doc, options);
  assert.equal(result.plan.schemaOwners.Shared, "alpha");
  assert.deepEqual(result.plan.sharedSchemas, []);
  assert.match(
    fileContent(result, "beta/index.ts"),
    /import type \{ Beta \} from "\.\.\/alpha\/type"/,
  );
  assert.deepEqual(
    result,
    await generate(doc, {
      schemaOwners: { Beta: "alpha", Leaf: "alpha", Shared: "alpha" },
    }),
  );
  assertUniqueSchemas(result);
  t.after((await compile(result)).cleanup);

  // Moving a root to shared also hoists its entire dependency closure.
  const hoisted = await generate(doc, { schemaOwners: { Alpha: "_shared" } });
  assert.deepEqual(hoisted.plan.sharedSchemaNames, [
    "Alpha",
    "Leaf",
    "LocalA",
    "LocalB",
    "Shared",
  ]);
  assert.match(
    fileContent(hoisted, "alpha/type.ts"),
    /import type \{ Alpha \} from "\.\.\/_shared\/type"/,
  );
  t.after((await compile(hoisted)).cleanup);

  const sorted = await generate(doc, {
    schemaOwners: { LocalA: "_shared", LocalB: "_shared" },
  });
  assert.match(
    fileContent(sorted, "alpha/type.ts"),
    /import type \{ LocalA, Shared \} from "\.\.\/_shared\/type"/,
  );
  t.after((await compile(sorted)).cleanup);
});

test("owner-only module gets a type file even when its own operations are deferred", async (t) => {
  const doc = await load("test/fixtures/phase3.yaml");
  doc.operations.find((op) => op.module === "beta")!.responses[0]!.status =
    "default";
  const result = await generate(doc, { schemaOwners: { Alpha: "beta" } });
  assert.ok(result.files.some((file) => file.path === "beta/type.ts"));
  assert.ok(!result.files.some((file) => file.path === "beta/index.ts"));
  assert.match(
    fileContent(result, "alpha/type.ts"),
    /import type \{ Alpha \} from "\.\.\/beta\/type"/,
  );
  assertUniqueSchemas(result);
  t.after((await compile(result)).cleanup);
});

test("SCCs stay local or hoist together; conflicting explicit ownership is fatal", async (t) => {
  const doc = await load("test/fixtures/phase3-cycle.yaml");
  const result = await generate(doc);
  assert.deepEqual(result.plan.stronglyConnectedComponents, [["A", "B"]]);
  assert.deepEqual(result.plan.schemaOwners, { A: "_shared", B: "_shared" });
  assert.deepEqual(result.plan.sharedSchemaNames, ["A", "B"]);
  assertUniqueSchemas(result);
  t.after((await compile(result)).cleanup);
  const pinned = await generate(doc, {
    schemaOwners: { A: "alpha", B: "alpha" },
  });
  assert.deepEqual(pinned.plan.schemaOwners, { A: "alpha", B: "alpha" });
  t.after((await compile(pinned)).cleanup);
  await assert.rejects(
    generate(doc, { schemaOwners: { A: "alpha", B: "beta" } }),
    /SCHEMA_OWNER_CONFLICT.*SCC/,
  );
  await assert.rejects(
    generate(doc, { schemaOwners: { A: "alpha" } }),
    /SCHEMA_OWNER_CONFLICT.*SCC/,
  );

  const local = await load("test/fixtures/phase3.yaml");
  const hoisted = await generate(local, {
    schemaOwners: { LocalA: "_shared" },
  });
  assert.equal(hoisted.plan.schemaOwners.LocalB, "_shared");
  assertUniqueSchemas(hoisted);
  t.after((await compile(hoisted)).cleanup);
});

test("invalid owners and shared-to-module dependencies fail before producing output", async () => {
  const doc = await load("test/fixtures/phase3.yaml");
  await assert.rejects(
    generate(doc, { schemaOwners: { Missing: "alpha" } }),
    /SCHEMA_OWNER_CONFLICT.*unknown schema/,
  );
  await assert.rejects(
    generate(doc, { schemaOwners: { Alpha: "../escape" } }),
    /SCHEMA_OWNER_CONFLICT.*unknown module/,
  );
  await assert.rejects(
    generate(doc, { schemaOwners: { Alpha: "typo" } }),
    /SCHEMA_OWNER_CONFLICT.*unknown module/,
  );
  await assert.rejects(
    generate(doc, { schemaOwners: { Leaf: "alpha" } }),
    /SCHEMA_OWNER_CONFLICT.*dependency of Shared/,
  );
  await assert.rejects(
    generate(doc, { schemaOwners: { LocalA: "_shared", LocalB: "alpha" } }),
    /SCHEMA_OWNER_CONFLICT.*SCC/,
  );
  for (const schemaOwners of [null, [], "alpha", 42]) {
    await assert.rejects(
      generate(doc, { schemaOwners } as unknown as Parameters<
        typeof generate
      >[1]),
      /INVALID_CONFIG/,
    );
  }
  const dangling = structuredClone(doc);
  dangling.schemas.Alpha!.properties!.shared!.ref =
    "#/components/schemas/Missing";
  await assert.rejects(generate(dangling), /INVALID_REF/);
});

test("pure circular aliases remain explicit deferrals rather than invalid TypeScript", async (t) => {
  const raw = parseSpec(
    await readFile("test/fixtures/phase3-cycle.yaml", "utf8"),
  );
  (raw.components as { schemas: unknown }).schemas = {
    A: { $ref: "#/components/schemas/B" },
    B: { $ref: "#/components/schemas/A" },
  };
  const result = await generate(normalizeSpec(raw));
  assert.equal(result.plan.stats.generatedOperations, 0);
  assert.equal(result.plan.stats.deferredOperations, 2);
  assert.ok(
    result.plan.deferredOperations.every((op) =>
      op.reasons.includes("UNSUPPORTED_CIRCULAR_ALIAS"),
    ),
  );
  assert.deepEqual(result.files, []);
  t.after((await compile(result)).cleanup);
});

test("graph scans schema keywords including raw-only branches but ignores example values", async (t) => {
  const result = await generate(await load("test/fixtures/phase3-graph.yaml"));
  assert.deepEqual(result.plan.schemaDependencies.Root, ["Hidden", "Leaf"]);
  assert.deepEqual(result.plan.schemaUsage.Leaf, ["alpha", "beta"]);
  assert.equal(result.plan.schemaOwners.Hidden, "alpha");
  assert.match(
    fileContent(result, "alpha/type.ts"),
    /export type Root = unknown/,
  );
  assert.doesNotMatch(fileContent(result, "alpha/type.ts"), /import type/);
  assert.ok(result.plan.diagnostics.some((d) => d.code === "SCHEMA_FALLBACK"));
  assertUniqueSchemas(result);
  t.after((await compile(result)).cleanup);
});

test("cross-module imports are sorted by path and protect API parameter names", async (t) => {
  const doc = await load("test/fixtures/phase3.yaml");
  doc.operations.find((op) => op.module === "alpha")!.path =
    "/alpha/{SchemaRef0}";
  doc.operations
    .find((op) => op.module === "alpha")!
    .pathParams.push({
      name: "SchemaRef0",
      in: "path",
      required: true,
      raw: {},
      content: {},
      schema: { raw: { type: "string" }, types: ["string"], nullable: false },
    });
  const result = await generate(doc, {
    schemaOwners: { LocalA: "beta", LocalB: "beta" },
  });
  const types = fileContent(result, "alpha/type.ts");
  assert.ok(
    types.indexOf('from "../_shared/type"') <
      types.indexOf('from "../beta/type"'),
  );
  assert.match(fileContent(result, "alpha/index.ts"), /pathParam1: string/);
  assertUniqueSchemas(result);
  t.after((await compile(result)).cleanup);
  const reserved = structuredClone(doc);
  reserved.operations[1]!.module = "_SHARED";
  await assert.rejects(generate(reserved), /INVALID_OUTPUT_PATH/);
});

test("fallback does not leave unused cross-module imports behind", async (t) => {
  const doc = await load("test/fixtures/phase3.yaml");
  doc.schemas.Alpha!.properties!.shared!.enum = [{ invalid: "non-primitive" }];
  delete doc.schemas.Alpha!.properties!.again;
  const result = await generate(doc);
  assert.doesNotMatch(fileContent(result, "alpha/type.ts"), /import type/);
  assert.match(fileContent(result, "alpha/type.ts"), /shared\?: unknown/);
  t.after((await compile(result)).cleanup);
});

test("project enum members preserve raw strings, source order, comments and primitive fields", async (t) => {
  const doc = await load("test/fixtures/phase4.yaml");
  const result = await generate(doc);
  assert.deepEqual(result, await generate(doc));
  assert.equal(result.enums.generated, 3);
  assert.equal(result.enums.skipped, 0);
  const enums = fileContent(result, "_shared/enum.ts");
  assert.match(enums, /WIDE = "WIDE"/);
  assert.match(enums, /COMPACT = "COMPACT"/);
  assert.match(enums, /DARK_BLUE = "1"/);
  assert.match(enums, /LIGHT = "2"/);
  assert.match(enums, /NIGHT_LIGHT = "1"/);
  assert.match(enums, /READ_WRITE = "2"/);
  assert.match(enums, /WIDE_LAYOUT = "3"/);
  assert.match(enums, /NESTED_MENU_CUSTOM = "4"/);
  assert.match(enums, /宽布局/);
  assert.ok(enums.indexOf("WIDE =") < enums.indexOf("COMPACT ="));
  assert.equal([...enums.matchAll(/export enum DisplayMode/g)].length, 1);
  const types = fileContent(result, "values/type.ts");
  assert.match(types, /mode\?: string/);
  assert.match(types, /imaging\?: string/);
  assert.match(types, /standard\?: "IDLE" \| "READY" \| "FAILED"/);
  assert.doesNotMatch(types, /DisplayMode|ColorMode|enum.js/);
  assert.equal(
    result.plan.diagnostics.filter(
      (d) => d.location === "DisplayMode" && d.code === "ENUM_MISSING_METADATA",
    ).length,
    1,
  );
  const compiled = await compile(
    result,
    'import { DisplayMode, ColorMode } from "./_shared/enum.js";\nexport const a: "WIDE" = DisplayMode.WIDE;\nexport const b: "1" = ColorMode.DARK_BLUE;\n',
  );
  t.after(compiled.cleanup);
  const runtime = await import(
    pathToFileURL(join(compiled.folder, "_shared/enum.ts")).href
  );
  assert.equal(runtime.ColorMode.DARK_BLUE, "1");
  assert.equal(runtime.DisplayMode.WIDE, "WIDE");
});

test("malformed, duplicate and conflicting enums are never partially emitted", async (t) => {
  const result = await generate(
    await load("test/fixtures/phase4-invalid.yaml"),
  );
  assert.equal(result.enums.generated, 0);
  assert.equal(result.enums.skipped, 14);
  assert.equal(result.plan.stats.generatedOperations, 1);
  assert.match(fileContent(result, "cases/type.ts"), /mixed\?: string/);
  assert.match(fileContent(result, "cases/type.ts"), /mixedAgain\?: number/);
  assert.match(fileContent(result, "cases/type.ts"), /malformed\?: string/);
  assert.ok(!result.files.some((file) => file.path === "_shared/enum.ts"));
  for (const [name, cause] of [
    ["Duplicate", "ENUM_DUPLICATE_MEMBER"],
    ["NoEnglish", "ENUM_MISSING_ENGLISH"],
    ["Malformed", "ENUM_MALFORMED_ENTRY"],
    ["Conflict", "ENUM_DEFINITION_CONFLICT"],
    ["Mixed", "ENUM_PRIMITIVE_CONFLICT"],
    ["Missing", "ENUM_MISSING_METADATA"],
    ["EmptyValue", "ENUM_MALFORMED_ENTRY"],
    ["EmptyEnglish", "ENUM_INVALID_ENGLISH"],
    ["InvalidMember", "ENUM_INVALID_MEMBER"],
    ["NoChinese", "ENUM_MALFORMED_ENTRY"],
    ["BadParentheses", "ENUM_MALFORMED_ENTRY"],
    ["EmptyList", "ENUM_MALFORMED_ENTRY"],
    ["NumberEntry", "ENUM_MALFORMED_ENTRY"],
    ["invalid-name", "ENUM_INVALID_NAME"],
  ]) {
    assert.ok(
      result.enums.enums
        .find((item) => item.name === name)
        ?.reasons.includes(cause!),
      name,
    );
  }
  assert.ok(result.enums.enums.every((item) => item.members.length === 0));
  const keys = result.plan.diagnostics.map((d) => d.location + "/" + d.code);
  assert.equal(keys.length, new Set(keys).size);
  t.after((await compile(result)).cleanup);
});

test("enum generation can be disabled without changing APIs or primitive types", async (t) => {
  const doc = await load("test/fixtures/phase4.yaml");
  const enabled = await generate(doc);
  const disabled = await generate(doc, { enum: { enabled: false } });
  assert.deepEqual(
    disabled.files,
    enabled.files.filter((file) => file.path !== "_shared/enum.ts"),
  );
  assert.equal(disabled.enums.generated, 0);
  assert.ok(!disabled.plan.diagnostics.some((d) => d.code.startsWith("ENUM_")));
  for (const option of [null, [], true, { enabled: "yes" }])
    await assert.rejects(
      generate(doc, { enum: option } as unknown as Parameters<
        typeof generate
      >[1]),
      /INVALID_CONFIG/,
    );
  t.after((await compile(disabled)).cleanup);
});

test("global enum scan includes default responses and ignores schema example payloads", async (t) => {
  const raw = parseSpec(await readFile("test/fixtures/phase4.yaml", "utf8"));
  const paths = raw.paths as Record<
    string,
    { get: { responses: Record<string, unknown> } }
  >;
  paths["/value"]!.get.responses.default = {
    description: "Deferred metadata",
    content: {
      "application/json": {
        schema: {
          type: "string",
          "x-enum-name": "DefaultOnlyEnum",
          enum: ["A:甲(Alpha)"],
          example: {
            type: "string",
            "x-enum-name": "Fake",
            enum: ["B:乙(Beta)"],
          },
        },
      },
    },
  };
  const result = await generate(normalizeSpec(raw));
  assert.equal(result.enums.generated, 4);
  assert.ok(result.enums.enums.some((item) => item.name === "DefaultOnlyEnum"));
  assert.ok(!result.enums.enums.some((item) => item.name === "Fake"));
  t.after((await compile(result)).cleanup);
});

test("conflicts in comments or one malformed definition suppress the entire logical enum", async () => {
  for (const entries of [
    ["WIDE:其他描述(Wide Field Of View)", "COMPACT:紧凑(Compact)"],
    ["WIDE:宽布局(Wide Layout)", "BROKEN"],
  ]) {
    const raw = parseSpec(await readFile("test/fixtures/phase4.yaml", "utf8"));
    const components = raw.components as {
      schemas: { Value: { properties: Record<string, { enum?: string[] }> } };
    };
    components.schemas.Value.properties.repeated!.enum = entries;
    const result = await generate(normalizeSpec(raw));
    assert.ok(
      result.enums.enums.find((item) => item.name === "DisplayMode")!.reasons
        .length,
    );
    assert.doesNotMatch(
      fileContent(result, "_shared/enum.ts"),
      /enum DisplayMode/,
    );
  }
});

test("equivalent definitions with different ordering retain the first source order", async () => {
  const raw = parseSpec(await readFile("test/fixtures/phase4.yaml", "utf8"));
  const components = raw.components as {
    schemas: { Value: { properties: Record<string, { enum?: string[] }> } };
  };
  components.schemas.Value.properties.repeated!.enum!.reverse();
  const result = await generate(normalizeSpec(raw));
  const mode = result.enums.enums.find((item) => item.name === "DisplayMode")!;
  assert.deepEqual(mode.reasons, []);
  assert.deepEqual(
    mode.members.map((member) => member.value),
    ["WIDE", "COMPACT"],
  );
});

test("enum parser rejects ambiguous names without guessing and preserves raw value bytes", async (t) => {
  const make = (entries: unknown[]) =>
    normalizeSpec({
      openapi: "3.1.0",
      info: { title: "Parser", version: "1" },
      paths: {},
      components: {
        schemas: {
          Example: {
            type: "string",
            "x-enum-name": "ExampleEnum",
            enum: entries,
          },
        },
      },
    });
  const valid = await generate(
    make(["RAW:原文", " 1 :有空格(With Space)", "X:注释*/(Safe Comment)"]),
  );
  const members = valid.enums.enums[0]!.members;
  assert.equal(members[0]!.memberName, "RAW");
  assert.equal(members[1]!.value, " 1 ");
  assert.equal(members[1]!.memberName, "WITH_SPACE");
  t.after((await compile(valid)).cleanup);
  for (const entries of [
    ["1:中文(中文)"],
    ["1:甲(Alpha)", "1:乙(Beta)"],
    ["A:甲(Alpha)", "A:乙(Beta)"],
    ["A:甲((Alpha)"],
    ["__proto__:原文(Original)"],
    [" :原文(Original)"],
  ]) {
    const invalid = await generate(make(entries));
    assert.equal(invalid.enums.generated, 0, JSON.stringify(entries));
    assert.ok(invalid.enums.enums[0]!.reasons.length);
  }
});
