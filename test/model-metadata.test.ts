import type { NormalizedSchema } from "../src/core/model.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "../src/cli/load.js";
import { parseSpec, normalizeSpec } from "../src/core/index.js";

test("metadata is typed without interpreting enum, binary, default response or ref siblings", async () => {
  const raw = parseSpec(await loadSource("test/fixtures/model-metadata.yaml"));
  const original = structuredClone(raw);
  const doc = normalizeSpec(raw);
  assert.deepEqual(raw, original);
  const op = doc.operations.find((op) => op.operationId === "save_1")!;
  assert.equal(op.summary, "保存");
  assert.equal(op.description, "操作说明");
  assert.equal(op.deprecated, true);
  assert.equal(op.headerParams[0]?.description, "业务头");
  assert.equal(op.headerParams[0]?.deprecated, true);
  assert.deepEqual(op.headerParams[0]?.schema?.enum, ["A", "B"]);
  assert.equal(op.headerParams[0]?.schema?.default, "A");
  assert.equal(op.requestBody?.description, "请求说明");
  assert.equal(op.requestBody?.required, true);
  assert.equal(op.responses[0]?.status, "default");
  assert.equal(op.responses[0]?.description, "默认响应，不推断为成功");
  assert.equal(
    op.responses[0]?.content["*/*"]?.ref,
    "#/components/schemas/RecordDTO",
  );
  assert.equal(op.responses[0]?.content["*/*"]?.description, "引用处说明");
  const schema = doc.schemas.RecordDTO!;
  assert.deepEqual(schema.required, ["id"]);
  assert.equal(schema.description, "记录");
  const properties = schema.properties!;
  assert.equal(properties.id?.format, "int64");
  assert.equal(properties.id?.readOnly, true);
  assert.equal(properties.time?.format, "yyyy/MM/dd HH:mm:ss");
  assert.equal(properties.secret?.writeOnly, true);
  assert.equal(properties.secret?.default, "");
  assert.equal(
    (properties.secret?.raw as Record<string, unknown>).minLength,
    1,
  );
  assert.equal(properties.mode?.xEnumName, "Mode");
  assert.equal(properties.modeCode?.xEnumName, "Mode");
  assert.deepEqual(properties.modeCode?.types, ["integer"]);
  assert.equal(properties.modeCode?.enum, undefined);
  assert.deepEqual(properties.mode?.enum, [
    "1:启用(Enabled)",
    "2:禁用(Disabled)",
  ]);
  assert.equal(properties.mode?.deprecated, true);
  assert.equal(
    properties.variant?.oneOf?.[0]?.ref,
    "#/components/schemas/RecordDTO",
  );
  assert.equal(
    properties.children?.additionalProperties?.items?.ref,
    "#/components/schemas/RecordDTO",
  );
  assert.equal(
    properties.attributes?.additionalProperties?.ref,
    "#/components/schemas/RecordDTO",
  );
  assert.equal(
    doc.operations.find((op) => op.operationId === "read")?.responses[0]
      ?.content["*/*"]?.format,
    "binary",
  );
});

test("new typed metadata validates input rather than coercing it", async () => {
  const raw = parseSpec(await loadSource("test/fixtures/model-metadata.yaml"));
  for (const [key, value] of Object.entries({
    format: 1,
    description: false,
    readOnly: "true",
    writeOnly: 0,
    deprecated: "false",
    enum: {},
    "x-enum-name": 1,
    required: "id",
  })) {
    assert.throws(
      () =>
        normalizeSpec({
          ...raw,
          components: { schemas: { Bad: { type: "string", [key]: value } } },
        }),
      /INVALID_OPENAPI/,
    );
  }
});

test("synthetic integration preserves all typed metadata and source bytes", async () => {
  const input = "test/fixtures/integration/synthetic.json";
  const source = await loadSource(input);
  const parsed = parseSpec(source);
  const doc = normalizeSpec(parsed);
  assert.deepEqual(doc.raw, JSON.parse(source));
  const checkSchema = (schema: NormalizedSchema): void => {
    if (typeof schema.raw === "boolean") return;
    for (const key of [
      "description",
      "format",
      "required",
      "enum",
      "default",
      "readOnly",
      "writeOnly",
      "deprecated",
    ] as const)
      assert.deepEqual(schema[key], schema.raw[key]);
    assert.equal(schema.xEnumName, schema.raw["x-enum-name"]);
    assert.equal(schema.ref, schema.raw.$ref);
    Object.values(schema.properties ?? {}).forEach(checkSchema);
    for (const child of [
      schema.items,
      schema.additionalProperties,
      ...(schema.allOf ?? []),
      ...(schema.oneOf ?? []),
      ...(schema.anyOf ?? []),
    ])
      if (child) checkSchema(child);
  };
  Object.values(doc.schemas).forEach(checkSchema);
  for (const op of doc.operations) {
    assert.equal(op.summary, op.raw.summary);
    assert.equal(op.description, op.raw.description);
    const content = [
      ...Object.values(op.requestBody?.content ?? {}),
      ...op.responses.flatMap((r) => Object.values(r.content)),
    ];
    for (const parameter of [
      ...op.pathParams,
      ...op.queryParams,
      ...op.headerParams,
      ...op.cookieParams,
    ]) {
      assert.equal(parameter.description, parameter.raw.description);
      if (parameter.schema) checkSchema(parameter.schema);
      content.push(...Object.values(parameter.content));
    }
    content.forEach((schema) => {
      if (schema) checkSchema(schema);
    });
  }

  assert.equal(await loadSource(input), source);
});
