import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generate, normalizeSpec, parseSpec } from "../src/core/index.js";
import { propertyAccess, jsdoc } from "../src/core/generation-utils.js";
import type { GenerationResult } from "../src/core/index.js";

const load = async () =>
  normalizeSpec(parseSpec(await readFile("test/fixtures/style.yaml", "utf8")));
const compile = async (result: GenerationResult) => {
  const root = resolve("."),
    folder = await mkdtemp(join(root, ".phase2-test-"));
  try {
    for (const f of result.files) {
      await mkdir(dirname(join(folder, f.path)), { recursive: true });
      await writeFile(join(folder, f.path), f.content);
    }
    await writeFile(
      join(folder, "consumer.ts"),
      'import {Mode} from "./_shared/enum";\nimport {reqSaveFoo} from "./foo/index";\nexport const mode:string=Mode.READY;\nexport const call=()=>reqSaveFoo(void 0,{},{"X-Tenant":"a"});\n',
    );
    await writeFile(
      join(folder, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          types: [],
        },
        include: ["**/*.ts"],
      }),
    );
    try {
      await promisify(execFile)(process.execPath, [
        resolve("node_modules/typescript/bin/tsc"),
        "-p",
        join(folder, "tsconfig.json"),
      ]);
    } catch (e) {
      throw Error((e as { stdout: string }).stdout);
    }
    const enums = await import(
      pathToFileURL(join(folder, "_shared/enum.ts")).href
    );
    assert.equal(enums.Mode.READY, "READY");
  } finally {
    assert.equal(dirname(folder), root);
    await rm(folder, { recursive: true, force: true });
  }
};
test("style output preserves headers, optional values, runtime enums and only used named types", async () => {
  const result = await generate(await load());
  const api = result.files.find((f) => f.path === "foo/index.ts")!.content,
    all = result.files.map((f) => f.content).join("\n");
  assert.doesNotMatch(
    all,
    /\bundefined\b|Types\.|import type \*|\bfrom "[.][^"]*\.js"/,
  );
  assert.doesNotMatch(api, /Content-Type/);
  assert.match(api, /headers: \{\s*\.\.\.headers/);
  assert.match(all, /"X-Tenant": string/);
  assert.match(api, /APIS\.complete, void 0/);
  assert.match(
    api,
    /import type \{ FooDTO, SaveFooHeaders, SaveFooParams \} from "\.\/type"/,
  );
  assert.match(api, /import type \{ FooVO \} from "\.\.\/_shared\/type"/);
  assert.doesNotMatch(api, /Unused|Mode/);
  assert.match(api, /\/\*\* 保存/);
  const types = result.files.find((f) => f.path === "foo/type.ts")!.content;
  assert.match(types, /\/\*\* 单行 DTO \*\//);
  assert.match(types, /\/\*\* 末尾 \*\/\s*z\?: string/);
  assert.match(types, /\/\*\*\n\s+\* 第一行\n\s+\* 第二行\n\s+\*\//);
  assert.doesNotMatch(types, /;\n\s*\n\s*\/\*\*/);
  await compile(result);
});
test("propertyOrder controls properties only, with deterministic source and code-unit alphabetical output", async () => {
  const doc = await load();
  const sorted = await generate(doc),
    source = await generate(doc, { types: { propertyOrder: "source" } });
  assert.deepEqual(
    sorted,
    await generate(doc, { types: { propertyOrder: "alphabetical" } }),
  );
  assert.deepEqual(
    source,
    await generate(doc, { types: { propertyOrder: "source" } }),
  );
  const find = (r: GenerationResult, p: string) =>
    r.files.find((f) => f.path === p)!.content;
  assert.ok(
    find(sorted, "foo/type.ts").indexOf("a?:") <
      find(sorted, "foo/type.ts").indexOf("z?:"),
  );
  assert.ok(
    find(source, "foo/type.ts").indexOf("z?:") <
      find(source, "foo/type.ts").indexOf("a?:"),
  );
  for (const path of ["foo/index.ts", "other/index.ts", "_shared/enum.ts"])
    assert.equal(find(sorted, path), find(source, path));
  assert.ok(
    find(sorted, "foo/type.ts").indexOf("alpha?:") <
      find(sorted, "foo/type.ts").indexOf("zeta?:"),
  );
  assert.ok(
    find(source, "foo/type.ts").indexOf("zeta?:") <
      find(source, "foo/type.ts").indexOf("alpha?:"),
  );
  const edge = await load();
  edge.schemas.FooDTO!.properties!["ä"] = {
    raw: { type: "string" },
    types: ["string"],
    nullable: false,
  };
  edge.schemas.FooDTO!.properties!.Z = {
    raw: { type: "string" },
    types: ["string"],
    nullable: false,
  };
  const edgeTypes = find(await generate(edge), "foo/type.ts");
  assert.ok(edgeTypes.indexOf("Z?:") < edgeTypes.indexOf("a?:"));
  assert.ok(edgeTypes.indexOf("z?:") < edgeTypes.indexOf("ä?:"));
  await compile(source);
  await assert.rejects(
    generate(doc, { types: { propertyOrder: "random" as "source" } }),
    /INVALID_CONFIG/,
  );
});
test("property access accepts IdentifierName edges and brackets invalid keys", () => {
  for (const key of [
    "complete",
    "managementTree",
    "getPage_1",
    "default",
    "class",
    "$value",
    "_value",
    "中文",
    "a\u200c",
  ])
    assert.equal(propertyAccess("APIS", key), "APIS." + key);
  for (const key of ["invalid-key", "1first", "", "a b", 'a"b'])
    assert.equal(
      propertyAccess("APIS", key),
      "APIS[" + JSON.stringify(key) + "]",
    );
  assert.equal(jsdoc("one */ line"), "/** one * / line */\n");
  assert.match(jsdoc("one\ntwo"), /^\/\*\*\n/);
});
test("named imports alias collisions without duplicating definitions", async () => {
  const doc = await load();
  doc.schemas.axios = {
    raw: { type: "string" },
    types: ["string"],
    nullable: false,
  };
  doc.schemas.FooDTO!.properties!.client = {
    raw: { $ref: "#/components/schemas/axios" },
    ref: "#/components/schemas/axios",
    types: [],
    nullable: false,
  };
  // Response imports can collide with the request value; retain the schema's original exported name.
  doc.operations.find((o) => o.operationId === "complete")!.responses = [
    {
      ...doc.operations[0]!.responses[0]!,
      status: "200",
      content: {
        "application/json": {
          raw: { $ref: "#/components/schemas/axios" },
          ref: "#/components/schemas/axios",
          types: [],
          nullable: false,
        },
      },
    },
  ];
  const result = await generate(doc);
  assert.match(
    result.files.find((f) => f.path === "foo/index.ts")!.content,
    /axios as Importedaxios/,
  );
  await compile(result);
});
