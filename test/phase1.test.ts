import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  diagnose,
  normalizeSpec,
  parseSpec,
  detectVersion,
} from "../src/core/index.js";
import { loadSource } from "../src/cli/load.js";

const fixture = "test/fixtures/basic.json";
const fresh = async () => parseSpec(await loadSource(fixture));

test("3.0 JSON: counts, first tag, raw enum, nullable and recursive ref", async () => {
  const document = normalizeSpec(await fresh());
  const report = diagnose(document);
  assert.deepEqual(
    [
      report.version,
      report.operationCount,
      report.schemaCount,
      report.tagCount,
      report.moduleCount,
      report.multipartCount,
      report.xEnumNameCount,
    ],
    ["3.0.3", 2, 1, 4, 2, 1, 1],
  );
  assert.deepEqual(report.modules, ["files", "pets"]);
  const operation = document.operations.find(
    (operation) => operation.operationId === "getPet_1",
  )!;
  assert.equal(operation.module, "pets");
  assert.equal(operation.pathParams[0]?.required, true);
  assert.equal(operation.queryParams[0]?.name, "q");
  assert.equal(
    operation.responses[0]?.content["application/json"]?.ref,
    "#/components/schemas/PetVO",
  );
  assert.equal(document.schemas.PetVO?.properties?.name?.nullable, true);
  assert.equal(
    document.schemas.PetVO?.properties?.parent?.ref,
    "#/components/schemas/PetVO",
  );
  assert.deepEqual(
    (document.schemas.PetVO?.properties?.status?.raw as Record<string, unknown>)
      .enum,
    ["1:就绪(Ready)"],
  );
  assert.deepEqual(
    report.diagnostics.map((diagnostic) => diagnostic.code),
    ["UNSUPPORTED_MULTIPART"],
  );
});

test("3.1 YAML: null union, boolean schema, untagged operation", async () => {
  const document = normalizeSpec(
    parseSpec(await loadSource("test/fixtures/basic.yaml")),
  );
  assert.deepEqual(document.schemas.Nullable?.types, ["string"]);
  assert.equal(document.schemas.Nullable?.nullable, true);
  assert.equal(document.schemas.Anything?.raw, true);
  assert.equal(document.operations[0]?.module, null);
  assert.equal(diagnose(document).untaggedOperationCount, 1);
  assert.equal(diagnose(document).moduleCount, 0);
});

test("operation parameters override path parameters; preserve body, response and metadata", () => {
  const document = normalizeSpec(
    parseSpec(`
openapi: 3.1.1
info: {title: test, version: '1'}
paths:
  /items:
    parameters:
      - {name: q, in: query, schema: {type: string}}
    post:
      operationId: save_2
      summary: Save item
      parameters:
        - {name: q, in: query, required: true, schema: {type: integer}}
        - {name: X-Tenant, in: header, schema: {type: string}}
        - {name: session, in: cookie, schema: {type: string}}
      requestBody:
        content:
          application/json:
            schema: {allOf: [{type: object}, {additionalProperties: {type: string}}]}
      responses:
        '204': {description: Empty}
        '200': {description: OK, content: {application/json: {schema: {oneOf: [{type: string}, {type: integer}]}}}}
`),
  );
  const operation = document.operations[0]!;
  assert.equal(operation.queryParams.length, 1);
  assert.deepEqual(operation.queryParams[0]?.schema?.types, ["integer"]);
  assert.equal(operation.queryParams[0]?.required, true);
  assert.equal(operation.headerParams[0]?.name, "X-Tenant");
  assert.equal(operation.cookieParams.length, 1);
  assert.equal(operation.raw.summary, "Save item");
  assert.equal(operation.requestBody?.required, false);
  assert.equal(
    operation.requestBody?.content["application/json"]?.allOf?.length,
    2,
  );
  assert.deepEqual(
    operation.responses.map((response) => response.status),
    ["200", "204"],
  );
  assert.deepEqual(operation.responses[1]?.content, {});
});

test("duplicate operationId report includes all locations and is fatal", async () => {
  const raw = await fresh();
  const paths = raw.paths as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  paths["/upload"]!.post!.operationId = "getPet_1";
  const report = diagnose(normalizeSpec(raw));
  assert.deepEqual(report.duplicateOperationIds, [
    { operationId: "getPet_1", locations: ["GET /pets/{id}", "POST /upload"] },
  ]);
  assert.equal(report.diagnostics.at(-1)?.severity, "error");
});

test("x-enum-name counts source schema occurrences, including inline, not examples or ref uses", async () => {
  const raw = await fresh();
  const schemas = (raw.components as Record<string, unknown>).schemas as Record<
    string,
    unknown
  >;
  schemas.Other = {
    type: "string",
    "x-enum-name": "Status",
    example: { "x-enum-name": "Fake" },
  };
  schemas.Container = {
    properties: {
      "x-enum-name": { type: "string" },
      nested: { anyOf: [{ type: "string", "x-enum-name": "Nested" }] },
    },
  };
  assert.equal(diagnose(normalizeSpec(raw)).xEnumNameCount, 3);
});

test("reject unsupported versions, malformed documents and invalid structures", async () => {
  for (const value of [
    { swagger: "2.0" },
    { openapi: "3.2.0" },
    { openapi: "3.10.0" },
    {},
    null,
  ])
    assert.throws(() => detectVersion(value));
  for (const text of ["[", "null", "a: 1\na: 2", "a: &a {self: *a}", "a: .nan"])
    assert.throws(() => parseSpec(text));
  const raw = await fresh();
  assert.throws(() => normalizeSpec({ ...raw, info: {} }), /info.title/);
  const invalidPaths = parseSpec(
    await loadSource("test/fixtures/invalid-paths.yaml"),
  );
  assert.throws(() => normalizeSpec(invalidPaths), /paths must be an object/);
  assert.throws(() => normalizeSpec({ ...raw, paths: [] }), /paths/);
  assert.throws(
    () =>
      normalizeSpec({ ...raw, paths: { "/bad": { get: { responses: {} } } } }),
    /empty responses/,
  );
  assert.throws(
    () => normalizeSpec({ ...raw, paths: { "/bad": { $ref: "#/missing" } } }),
    /INVALID_REF/,
  );
  assert.throws(
    () => normalizeSpec({ ...raw, paths: { "/bad": { $ref: "other.yaml" } } }),
    /UNSUPPORTED_REF/,
  );
  assert.throws(
    () =>
      normalizeSpec({ ...raw, paths: { "/bad": { $ref: "#/paths/~1bad" } } }),
    /reference cycle/,
  );
  await assert.rejects(loadSource("test/fixtures/missing.json"), /ENOENT/);
  await assert.rejects(
    loadSource("ftp://example.com/spec"),
    /UNSUPPORTED_SOURCE/,
  );
});

test("HTTP loads JSON/YAML, follows redirects, reports failure and parses extensionless content", async (t) => {
  const json = await readFile(fixture, "utf8");
  const yaml = await readFile("test/fixtures/basic.yaml", "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/yaml" });
      response.end();
    } else if (request.url === "/json") response.end(json);
    else if (request.url === "/yaml") response.end(yaml);
    else {
      response.writeHead(503);
      response.end("Unavailable");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal(
    normalizeSpec(parseSpec(await loadSource(`${base}/json`))).version,
    "3.0.3",
  );
  assert.equal(
    normalizeSpec(parseSpec(await loadSource(`${base}/redirect`))).version,
    "3.1.0",
  );
  await assert.rejects(loadSource(`${base}/missing`), /HTTP_ERROR: 503/);
});

test("HTTPS uses native fetch with timeout and propagates transport errors", async (t) => {
  const json = await readFile(fixture, "utf8");
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(input, "https://example.test/spec");
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(json);
    },
  );
  assert.equal(
    normalizeSpec(parseSpec(await loadSource("https://example.test/spec")))
      .version,
    "3.0.3",
  );
  fetchMock.mock.mockImplementation(async () => {
    throw new Error("connection failed");
  });
  await assert.rejects(
    loadSource("https://example.test/spec"),
    /connection failed/,
  );
});

test("CLI reports deterministic JSON twice, handles usage and fatal errors", async () => {
  const run = promisify(execFile);
  const args = ["--import", "tsx", "src/cli/index.ts", "diagnose", fixture];
  const first = await run(process.execPath, args);
  const second = await run(process.execPath, args);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stderr, "");
  assert.equal(JSON.parse(first.stdout).operationCount, 2);
  await assert.rejects(
    run(process.execPath, [
      ...args.slice(0, -1),
      "test/fixtures/duplicate.yaml",
    ]),
    (error: unknown) => {
      const failure = error as { code: number; stdout: string };
      assert.equal(failure.code, 1);
      assert.equal(JSON.parse(failure.stdout).duplicateOperationIdCount, 1);
      return true;
    },
  );
  await assert.rejects(
    run(process.execPath, ["--import", "tsx", "src/cli/index.ts"]),
    /Usage:/,
  );
  await assert.rejects(
    run(process.execPath, [...args.slice(0, -1), "test/fixtures/missing.json"]),
    /ENOENT/,
  );
});
