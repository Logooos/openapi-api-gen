import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  access,
  link,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import {
  defineConfig,
  generate,
  normalizeSpec,
  parseSpec,
} from "../src/core/index.js";
import { resolveConfig } from "../src/cli/config.js";
import { projectFormatter } from "../src/cli/format.js";
import { selectFiles, writeOutput } from "../src/cli/output.js";

const root = resolve(".");
const fixture = resolve("test/fixtures/phase5.yaml");
const run = promisify(execFile);
const temp = async (t: TestContext) => {
  const dir = await mkdtemp(join(root, ".phase2-test-"));
  t.after(async () => {
    assert.equal(dirname(dir), root);
    assert.ok(dir.startsWith(join(root, ".phase2-test-")));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
};
const cli = async (
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
) => {
  const result = await run(
    process.execPath,
    ["--import", "tsx", resolve("src/cli/index.ts"), ...args],
    {
      cwd,
      env: {
        ...process.env,
        OPENAPI_GEN_INPUT: "",
        OPENAPI_GEN_OUTPUT: "",
        OPENAPI_GEN_HEADERS: "{}",
        ...env,
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return result.stdout;
};
const load = async () =>
  normalizeSpec(parseSpec(await readFile(fixture, "utf8")));
const compile = async (folder: string) => {
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
      include: ["out/**/*.ts"],
    }),
  );
  try {
    await run(process.execPath, [
      resolve("node_modules/typescript/bin/tsc"),
      "-p",
      join(folder, "tsconfig.json"),
    ]);
  } catch (e) {
    throw new Error((e as { stdout: string }).stdout, { cause: e });
  }
};
test("excludeTags filters raw tags before mapping, ownership and manifest cleanup", async (t) => {
  const dir = await temp(t);
  const output = join(dir, "out");
  const input = resolve("test/fixtures/exclude-tags.json");
  const doc = normalizeSpec(parseSpec(await readFile(input, "utf8")));
  const base = defineConfig({
    overrides: { operations: { untagged: { module: "untagged" } } },
    moduleNames: { internal: "hiddenModule" },
  });
  const before = await generate(doc, base);
  assert.deepEqual(before, await generate(doc, { ...base, excludeTags: [] }));
  await writeOutput(output, before.files);
  const handwritten = join(output, "hiddenModule/handwritten.ts");
  await writeFile(handwritten, "export const handwritten = true;\n");
  const config = defineConfig({
    ...base,
    excludeTags: ["internal", "debug", "测试接口"],
    includeOperations: doc.operations.map((op) => op.operationId!),
    excludeOperations: ["legacy"],
    // These overlapping rules must never run for an excluded operation.
    modules: { internal: [{ name: "one" }, { name: "two" }] },
  });
  const result = await generate(doc, config);
  assert.deepEqual(result, await generate(doc, config));
  assert.deepEqual(result.plan.excludedOperations, [
    "GET /chinese",
    "GET /hidden",
    "GET /legacy",
    "GET /multi",
    "POST /debug",
  ]);
  assert.equal(result.plan.stats.operations, 9);
  assert.equal(result.plan.stats.generatedOperations, 4);
  assert.deepEqual(result.plan.deferredOperations, []);
  assert.deepEqual(
    result.plan.diagnostics.map((d) => d.code),
    ["MISSING_TAG"],
  );
  assert.deepEqual(result.plan.schemaUsage.CycleA, ["alpha", "beta"]);
  assert.equal(result.plan.schemaOwners.CycleA, "_shared");
  assert.equal(result.plan.schemaOwners.CycleB, "_shared");
  assert.ok(
    result.plan.stronglyConnectedComponents.some(
      (scc) => scc.join() === "CycleA,CycleB",
    ),
  );
  assert.equal(result.plan.schemaOwners.Solo, "alpha");
  assert.deepEqual(result.plan.schemaUsage.Hidden, []);
  assert.equal(result.plan.schemaOwners.Hidden, null);
  assert.deepEqual(result.enums, before.enums);
  assert.equal(result.enums.generated, 1);
  assert.deepEqual(
    result.plan.schemaDependencies,
    before.plan.schemaDependencies,
  );
  assert.ok(result.files.some((f) => f.path === "case/index.ts"));
  assert.ok(result.files.some((f) => f.path === "untagged/index.ts"));
  assert.ok(result.files.some((f) => f.path === "_shared/type.ts"));
  assert.ok(!result.files.some((f) => /Hidden|Standalone/.test(f.content)));
  const mapped = await generate(doc, {
    ...base,
    excludeTags: ["hiddenModule"],
  });
  assert.ok(mapped.files.some((f) => f.path === "hiddenModule/index.ts"));
  for (const invalid of ["internal", [1], [""], null]) {
    assert.throws(
      () => defineConfig({ excludeTags: invalid } as never),
      /INVALID_CONFIG.*excludeTags/,
    );
    await assert.rejects(
      generate(doc, { excludeTags: invalid } as never),
      /INVALID_CONFIG.*excludeTags/,
    );
  }
  await writeFile(
    join(dir, "openapi-gen.config.ts"),
    "export default " + JSON.stringify({ ...config, input, output }),
  );
  const planned = JSON.parse(await cli(dir, ["generate", "--plan"]));
  assert.deepEqual(planned.plan, JSON.parse(JSON.stringify(result.plan)));
  assert.deepEqual(planned.files, result.files);
  const dry = JSON.parse(await cli(dir, ["generate", "--dry-run"]));
  assert.ok(
    dry.changes.some(
      (c: { path: string; action: string }) =>
        c.path === "hiddenModule/index.ts" && c.action === "delete",
    ),
  );
  await access(join(output, "hiddenModule/index.ts"));
  const actual = JSON.parse(await cli(dir, ["generate"]));
  assert.deepEqual(actual.changes, dry.changes);
  for (const file of [
    "hiddenModule/index.ts",
    "hiddenModule/type.ts",
    "removed/index.ts",
    "removed/type.ts",
  ])
    await assert.rejects(access(join(output, file)));
  assert.equal(
    await readFile(handwritten, "utf8"),
    "export const handwritten = true;\n",
  );
  for (const file of result.files)
    assert.equal(await readFile(join(output, file.path), "utf8"), file.content);
  await compile(dir);
  const repeat = JSON.parse(await cli(dir, ["generate"]));
  assert.deepEqual(repeat.summary, {
    create: 0,
    modify: 0,
    delete: 0,
    unchanged: result.files.length + 1,
  });
});

test("writer creates, overwrites targets, leaves unchanged mtimes and only removes managed stale files", async (t) => {
  const dir = await temp(t),
    output = join(dir, "out");
  const result = await generate(await load());
  const dry = await writeOutput(output, result.files, { dryRun: true });
  await assert.rejects(access(output));
  assert.equal(dry.summary.create, result.files.length + 1);
  assert.deepEqual(
    (await writeOutput(output, result.files)).changes,
    dry.changes,
  );
  const times = await Promise.all(
    result.files.map((f) => stat(join(output, f.path)).then((s) => s.mtimeMs)),
  );
  const second = await writeOutput(output, result.files);
  assert.equal(second.summary.unchanged, result.files.length + 1);
  assert.deepEqual(
    await Promise.all(
      result.files.map((f) =>
        stat(join(output, f.path)).then((s) => s.mtimeMs),
      ),
    ),
    times,
  );
  await writeFile(join(output, "Items/index.ts"), "handwritten target");
  await writeFile(
    join(output, "Other/handwritten.ts"),
    "export const keep = 1;",
  );
  const raw = parse(await readFile(fixture, "utf8"));
  delete raw.paths["/other"];
  delete raw.components.schemas.Other;
  const changed = await generate(normalizeSpec(raw));
  const plan = await writeOutput(output, changed.files, { dryRun: true });
  assert.ok(plan.changes.some((c) => c.action === "modify"));
  assert.ok(plan.changes.some((c) => c.action === "delete"));
  assert.ok(plan.changes.some((c) => c.action === "unchanged"));
  assert.equal(
    await readFile(join(output, "Items/index.ts"), "utf8"),
    "handwritten target",
  );
  assert.deepEqual(
    (await writeOutput(output, changed.files)).changes,
    plan.changes,
  );
  assert.equal(
    await readFile(join(output, "Other/handwritten.ts"), "utf8"),
    "export const keep = 1;",
  );
  await assert.rejects(access(join(output, "Other/type.ts")));
  // Removing a schema reference from a retained module updates, rather than duplicates, its type file.
  delete raw.paths["/items/admin/a"];
  raw.paths["/items/a"].get.responses["200"] = { description: "empty" };
  delete raw.components.schemas.Item;
  const removed = await generate(normalizeSpec(raw));
  await writeOutput(output, removed.files);
  assert.doesNotMatch(
    await readFile(join(output, "Items/type.ts"), "utf8"),
    /export type Item\b/,
  );
});
test("configuration drives module split, names, owners, primitives, request import and barrel", async (t) => {
  const dir = await temp(t);
  const config = defineConfig({
    ignoredHeaders: ["authorization"],
    moduleNames: { Other: "other" },
    modules: {
      Items: [
        { name: "items", include: ["/items/**"], exclude: ["/items/admin/**"] },
        { name: "admin", include: ["/items/admin/*"] },
      ],
    },
    requestClient: {
      mode: "custom",
      identifier: "request",
      importPath: "axios",
    },
    types: { int64: "string", nullable: "ignore" },
    barrel: { enabled: true },
    overrides: {
      operations: {
        getItem: { name: "fetchItem_1" },
        other: { responseType: "blob" },
      },
      schemas: { Item: { owner: "items" } },
    },
  });
  const result = await generate(await load(), config);
  assert.deepEqual(result, await generate(await load(), config));
  const all = result.files.map((f) => f.content).join("\n");
  assert.match(all, /reqFetchItem_1/);
  assert.match(all, /import request from "axios"/);
  assert.match(all, /responseType: "blob"/);
  assert.doesNotMatch(all, /Authorization/);
  assert.match(all, /id\?: string/);
  assert.doesNotMatch(all, /label\?: string \| null/);
  assert.equal(result.files.filter((f) => f.path === "index.ts").length, 1);
  assert.equal((all.match(/export type Item =/g) ?? []).length, 1);
  assert.equal(result.plan.schemaOwners.Item, "items");
  await writeOutput(join(dir, "out"), result.files);
  await compile(dir);
  const filtered = await generate(await load(), {
    includeOperations: ["getItem", "getAdmin"],
    overrides: {
      operations: {
        getAdmin: { exclude: true },
        getItem: { module: "moved", responseType: "Item[]" },
      },
    },
  });
  assert.equal(filtered.plan.stats.generatedOperations, 1);
  assert.equal(filtered.plan.excludedOperations.length, 2);
  assert.match(
    filtered.files.find((f) => f.path === "moved/index.ts")!.content,
    /Item\[\]/,
  );
  assert.ok(
    !(await generate(await load())).files.some((f) => f.path === "index.ts"),
  );
  await assert.rejects(
    generate(await load(), {
      schemaOwners: { Item: "Items" },
      overrides: { schemas: { Item: { owner: "Other" } } },
    }),
    /SCHEMA_OWNER_CONFLICT/,
  );
  await assert.rejects(
    generate(await load(), { moduleNames: { Items: "same", Other: "same" } }),
    /MODULE_NAME_COLLISION/,
  );
  await assert.rejects(
    generate(await load(), {
      overrides: {
        operations: { getItem: { responseType: "Guess<Unknown>" } },
      },
    }),
    /INVALID_CONFIG/,
  );
});
test("partial module writes dependency closure, preserves other modules and rejects stale outside consumers", async (t) => {
  const dir = await temp(t),
    out = join(dir, "out");
  const config = {
    modules: {
      Items: [
        { name: "items", include: ["/items/a"] },
        { name: "admin", include: ["/items/admin/**"] },
      ],
    },
  };
  const result = await generate(await load(), config);
  const selected = selectFiles(result, "items");
  assert.ok(selected.some((f) => f.path === "_shared/type.ts"));
  assert.ok(!selected.some((f) => f.path === "admin/index.ts"));
  await writeOutput(out, selected, {
    module: "items",
    fullFiles: result.files,
  });
  await compile(dir);
  await writeOutput(out, result.files);
  const before = (await stat(join(out, "admin/index.ts"))).mtimeMs;
  assert.equal(
    (
      await writeOutput(out, selected, {
        module: "items",
        fullFiles: result.files,
      })
    ).summary.modify,
    0,
  );
  assert.equal((await stat(join(out, "admin/index.ts"))).mtimeMs, before);
  const raw = parse(await readFile(fixture, "utf8"));
  raw.paths["/items/admin/a"].get.summary = "changed admin";
  const changed = await generate(normalizeSpec(raw), config);
  await assert.rejects(
    writeOutput(out, selectFiles(changed, "items"), {
      module: "items",
      fullFiles: changed.files,
    }),
    /PARTIAL_REQUIRES_FULL_RUN/,
  );
  const response = JSON.parse(
    await cli(dir, [
      fixture,
      "--output",
      join(dir, "single"),
      "--module",
      "Items",
    ]),
  );
  assert.equal(response.summary.delete, 0);
  await assert.rejects(access(join(dir, "single", "Other/index.ts")));
});
test("config loading and explicit CLI precedence preserve nested settings and case-insensitive source headers", async (t) => {
  const dir = await temp(t);
  await writeFile(
    join(dir, "openapi-gen.config.ts"),
    "import {defineConfig} from " +
      JSON.stringify(pathToFileURL(resolve("src/core/index.ts")).href) +
      ";\nexport default defineConfig(" +
      JSON.stringify({
        input: fixture,
        output: "configured",
        types: { int64: "string", nullable: "ignore" },
        source: { headers: { "X-Token": "config", "X-Config": "c" } },
        barrel: { enabled: true },
      }) +
      ");",
  );
  const resolved = await resolveConfig(
    dir,
    {
      output: "cli",
      types: { int64: "bigint" },
      source: { headers: { "x-token": "cli" } },
    },
    undefined,
    {
      OPENAPI_GEN_OUTPUT: "env",
      OPENAPI_GEN_HEADERS: JSON.stringify({ "X-Token": "env", "X-Env": "e" }),
    },
  );
  assert.equal(resolved.config.output, "cli");
  assert.deepEqual(resolved.config.types, {
    int64: "bigint",
    nullable: "ignore",
  });
  assert.deepEqual(resolved.config.source?.headers, {
    "x-config": "c",
    "x-env": "e",
    "x-token": "cli",
  });
  const response = JSON.parse(
    await cli(dir, [
      "--output",
      "out",
      "--int64",
      "bigint",
      "--no-barrel",
      "--ignored-header",
      "Authorization",
    ]),
  );
  assert.equal(response.output, join(dir, "out"));
  assert.match(
    await readFile(join(dir, "out/Items/type.ts"), "utf8"),
    /id\?: bigint/,
  );
  await assert.rejects(access(join(dir, "out/index.ts")));
  assert.doesNotMatch(
    await readFile(join(dir, "out/Items/index.ts"), "utf8"),
    /Authorization/,
  );
  await assert.rejects(
    resolveConfig(dir, {}, undefined, { OPENAPI_GEN_HEADERS: "bad" }),
    /INVALID_CONFIG/,
  );
  await assert.rejects(cli(dir, ["--config", "missing.ts"]), /INVALID_CONFIG/);
  assert.match(await cli(dir, ["--help"]), /dry-run/);
  assert.equal(
    (await cli(dir, ["--version"])).trim(),
    JSON.parse(await readFile("package.json", "utf8")).version,
  );
});
test("project Prettier config is discovered and no config uses Core fallback", async (t) => {
  const dir = await temp(t),
    out = join(dir, "out"),
    doc = await load();
  const normal = await generate(doc);
  assert.deepEqual(
    (await generate(doc, {}, projectFormatter(out))).files,
    normal.files,
  );
  await writeFile(
    join(dir, ".prettierrc.json"),
    JSON.stringify({ singleQuote: true, semi: false, tabWidth: 4 }),
  );
  const formatted = await generate(doc, {}, projectFormatter(out));
  assert.match(
    formatted.files.find((f) => f.path === "Items/index.ts")!.content,
    /from 'axios'\n/,
  );
  assert.notDeepEqual(formatted.files, normal.files);
  await writeOutput(out, formatted.files);
  await compile(dir);
});
test("HTTP CLI honors environment and config headers; recoverable exits zero and fatal exits one", async (t) => {
  const dir = await temp(t);
  const body = await readFile(fixture, "utf8");
  const server = createServer((req, res) => {
    if (
      req.headers["x-token"] !== "cli-secret" ||
      req.headers["x-env"] !== "env"
    ) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Content-Type", "application/yaml");
    res.end(body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = "http://127.0.0.1:" + address.port + "/spec";
  await writeFile(
    join(dir, "openapi-gen.config.ts"),
    "export default " +
      JSON.stringify({ source: { headers: { "X-Token": "config-secret" } } }),
  );
  const stdout = await cli(
    dir,
    ["--header", "X-Token=cli-secret", "--dry-run"],
    {
      OPENAPI_GEN_INPUT: url,
      OPENAPI_GEN_OUTPUT: "out",
      OPENAPI_GEN_HEADERS: JSON.stringify({
        "X-Token": "env-secret",
        "X-Env": "env",
      }),
    },
  );
  assert.equal(JSON.parse(stdout).stats.generatedOperations, 3);
  assert.doesNotMatch(stdout, /cli-secret|config-secret|env-secret/);
  const deferred = JSON.parse(
    await cli(dir, [
      resolve("test/fixtures/phase2-deferred.yaml"),
      "--dry-run",
    ]),
  );
  assert.ok(deferred.stats.deferredOperations > 0);
  await assert.rejects(
    cli(dir, [fixture, "--int64", "wrong"]),
    (e) => (e as { code: number }).code === 1,
  );
  await assert.rejects(
    cli(dir, [resolve("test/fixtures/duplicate.yaml"), "--dry-run"]),
    (e) => (e as { code: number }).code === 1,
  );
});
test("writer preflights traversal, malformed manifests, duplicate paths and hard links without changing disk", async (t) => {
  const dir = await temp(t),
    out = join(dir, "out");
  await mkdir(out);
  await writeFile(join(dir, "keep.ts"), "keep");
  await assert.rejects(
    writeOutput(out, [{ path: "../keep.ts", content: "bad" }]),
    /INVALID_OUTPUT_PATH/,
  );
  await assert.rejects(
    writeOutput(out, [
      { path: "A.ts", content: "a" },
      { path: "a.ts", content: "b" },
    ]),
    /duplicate/,
  );
  await writeFile(
    join(out, ".openapi-api-gen.json"),
    JSON.stringify({ version: 1, files: ["../keep.ts"] }),
  );
  await assert.rejects(writeOutput(out, []), /INVALID_OUTPUT_PATH/);
  await rm(join(out, ".openapi-api-gen.json"));
  await link(join(dir, "keep.ts"), join(out, "linked.ts"));
  await assert.rejects(
    writeOutput(out, [{ path: "linked.ts", content: "changed" }]),
    /UNSAFE_OUTPUT/,
  );
  assert.equal(await readFile(join(dir, "keep.ts"), "utf8"), "keep");
});
test("synthetic integration CLI/Core end-to-end: dry-run parity, zero second writes, strict output compilation, immutable input", async (t) => {
  const dir = await temp(t),
    out = join(dir, "out"),
    path = resolve("test/fixtures/integration/synthetic.json");
  const input = await readFile(path, "utf8"),
    hash = createHash("sha256").update(input).digest("hex");
  const config = {
    ignoredHeaders: [
      "Authorization",
      "Accept-Language",
      "Time-Zone",
      "language",
      "module",
    ],
  };
  await writeFile(
    join(dir, "openapi-gen.config.ts"),
    "export default " + JSON.stringify(config),
  );
  const args = [path, "--output", out];
  const dry = JSON.parse(await cli(dir, [...args, "--dry-run"]));
  await assert.rejects(access(out));
  const first = JSON.parse(await cli(dir, args));
  assert.deepEqual(first.changes, dry.changes);
  assert.equal(first.stats.generatedOperations, 4);
  assert.equal(first.stats.deferredOperations, 2);
  const core = await generate(
    normalizeSpec(parseSpec(input)),
    config,
    projectFormatter(out),
  );
  assert.deepEqual(core.plan.sharedSchemaNames, ["Item", "Order"]);
  assert.equal(core.enums.generated, 1);
  assert.deepEqual(
    [
      ...new Set(core.plan.deferredOperations.flatMap((op) => op.reasons)),
    ].sort(),
    ["JSON_BINARY_REQUEST", "UNSUPPORTED_MULTIPART"].sort(),
  );
  assert.deepEqual(
    await generate(
      normalizeSpec(parseSpec(input)),
      config,
      projectFormatter(out),
    ),
    core,
  );
  for (const file of core.files)
    assert.equal(await readFile(join(out, file.path), "utf8"), file.content);
  const mtime = await Promise.all(
    core.files.map((f) => stat(join(out, f.path)).then((s) => s.mtimeMs)),
  );
  const second = JSON.parse(await cli(dir, args));
  assert.deepEqual(second.summary, {
    create: 0,
    modify: 0,
    delete: 0,
    unchanged: core.files.length + 1,
  });
  assert.deepEqual(
    await Promise.all(
      core.files.map((f) => stat(join(out, f.path)).then((s) => s.mtimeMs)),
    ),
    mtime,
  );
  assert.deepEqual(
    JSON.parse(await cli(dir, [...args, "--dry-run"])).changes,
    second.changes,
  );
  await compile(dir);
  assert.equal(
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    hash,
  );

  console.log(
    "Phase 5 E2E: " +
      JSON.stringify({
        stats: first.stats,
        first: first.summary,
        second: second.summary,
        hash,
      }),
  );
});

test("configured enum path, overlapping globs, response void and output rename conflicts stay explicit", async (t) => {
  const dir = await temp(t);
  const enums = await generate(
    normalizeSpec(
      parseSpec(await readFile("test/fixtures/phase4.yaml", "utf8")),
    ),
    { enum: { output: "runtime/enums.ts" } },
  );
  assert.ok(enums.files.some((f) => f.path === "runtime/enums.ts"));
  assert.ok(
    selectFiles(enums, enums.plan.modules[0]!.name).some(
      (f) => f.path === "runtime/enums.ts",
    ),
  );
  const doc = await load();
  await assert.rejects(
    generate(doc, {
      modules: {
        Items: [
          { name: "a", include: ["/**"] },
          { name: "b", include: ["/items/*"] },
        ],
      },
    }),
    /MODULE_NAME_COLLISION/,
  );
  const result = await generate(doc, {
    overrides: { operations: { getItem: { responseType: "void" } } },
  });
  assert.match(
    result.files.find((f) => f.path === "Items/index.ts")!.content,
    /get<void>/,
  );
  const out = join(dir, "out");
  await writeOutput(out, [{ path: "Name.ts", content: "export {};" }]);
  await assert.rejects(
    writeOutput(out, [{ path: "name.ts", content: "export {};" }]),
    /INVALID_OUTPUT_PATH/,
  );
  assert.equal(await readFile(join(out, "Name.ts"), "utf8"), "export {};");
  await assert.rejects(
    generate(doc, {
      requestClient: {
        mode: "custom",
        identifier: "APIS",
        importPath: "axios",
      },
    }),
    /INVALID_CONFIG/,
  );
});

test("custom request identifiers cannot shadow function arguments or built-in types", async () => {
  for (const identifier of [
    "signal",
    "data",
    "params",
    "headers",
    "AbortSignal",
    "Blob",
    "Array",
    "Record",
  ]) {
    await assert.rejects(
      generate(await load(), {
        requestClient: { mode: "custom", identifier, importPath: "axios" },
      }),
      /INVALID_CONFIG/,
    );
  }
});
