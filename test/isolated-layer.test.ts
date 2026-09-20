import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  access,
  rm,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseSpec } from "../src/core/index.js";

const run = promisify(execFile);
test("isolated generated layer supports direct consumers and optional adapters without owning siblings", async () => {
  const root = resolve(".");
  const folder = await mkdtemp(join(root, ".phase2-test-"));
  try {
    const output = join(folder, "src/apis/generated");
    const adapter = join(folder, "src/apis/handwritten/index.ts");
    const sibling = join(folder, "src/apis/type.ts");
    await mkdir(dirname(adapter), { recursive: true });
    await writeFile(
      adapter,
      'import { reqGetAdmin } from "../generated/Items/index";\nexport const loadLabel = async () => (await reqGetAdmin()).data.label;\n',
    );
    await writeFile(sibling, "export type LocalId = string;\n");
    await writeFile(
      join(folder, "consumer.ts"),
      'import { reqGetAdmin } from "./src/apis/generated/Items/index";\nimport { loadLabel } from "./src/apis/handwritten";\nexport const direct = () => reqGetAdmin();\nexport const adapted = () => loadLabel();\n',
    );
    const protectedFiles = [adapter, sibling];
    const snapshot = () =>
      Promise.all(
        protectedFiles.map(async (p) => ({
          content: await readFile(p, "utf8"),
          mtime: (await stat(p)).mtimeMs,
        })),
      );
    const before = await snapshot();
    const input = join(folder, "input.json");
    const raw = parseSpec(await readFile("test/fixtures/phase5.yaml", "utf8"));
    await writeFile(input, JSON.stringify(raw));
    await writeFile(
      join(folder, "openapi-gen.config.ts"),
      'export default { input: "./input.json", output: "src/apis/generated", ignoredHeaders: ["Authorization"] };',
    );
    const cli = async (dry = false) =>
      JSON.parse(
        (
          await run(
            process.execPath,
            [
              "--import",
              "tsx",
              resolve("src/cli/index.ts"),
              "generate",
              ...(dry ? ["--dry-run"] : []),
            ],
            {
              cwd: folder,
              env: {
                ...process.env,
                OPENAPI_GEN_INPUT: "",
                OPENAPI_GEN_OUTPUT: "",
                OPENAPI_GEN_HEADERS: "{}",
              },
              maxBuffer: 8 * 1024 * 1024,
            },
          )
        ).stdout,
      );
    const dry = await cli(true);
    await assert.rejects(access(output));
    const first = await cli();
    assert.deepEqual(first.changes, dry.changes);
    assert.ok(first.summary.create > 0);
    const manifest = JSON.parse(
      await readFile(join(output, ".openapi-api-gen.json"), "utf8"),
    );
    assert.ok(
      manifest.files.every(
        (p: string) => !p.includes("..") && !p.includes("handwritten"),
      ),
    );
    const times = await Promise.all(
      manifest.files.map(
        async (p: string) => (await stat(join(output, p))).mtimeMs,
      ),
    );
    const second = await cli();
    assert.deepEqual(second.summary, {
      create: 0,
      modify: 0,
      delete: 0,
      unchanged: manifest.files.length + 1,
    });
    assert.deepEqual(
      times,
      await Promise.all(
        manifest.files.map(
          async (p: string) => (await stat(join(output, p))).mtimeMs,
        ),
      ),
    );
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
        include: ["src/**/*.ts", "consumer.ts"],
      }),
    );
    const compile = async () => {
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
    await compile();
    // A removed module may lose its managed files, never an unmanaged neighbor.
    const helper = join(output, "Other/helper.ts");
    await writeFile(helper, "export const keep = true;\n");
    delete (raw.paths as Record<string, unknown>)["/other"];
    await writeFile(input, JSON.stringify(raw));
    const stale = await cli(true);
    assert.deepEqual(
      stale.changes
        .filter((c: { action: string }) => c.action === "delete")
        .map((c: { path: string }) => c.path),
      ["Other/index.ts", "Other/type.ts"],
    );
    await access(join(output, "Other/index.ts"));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await cli()).changes, stale.changes);
    await assert.rejects(access(join(output, "Other/index.ts")));
    assert.equal(await readFile(helper, "utf8"), "export const keep = true;\n");
    assert.deepEqual(await snapshot(), before);
    assert.equal((await cli()).summary.modify, 0);
    await compile();
  } finally {
    assert.equal(dirname(folder), root);
    assert.ok(folder.startsWith(join(root, ".phase2-test-")));
    await rm(folder, { recursive: true, force: true });
  }
});
