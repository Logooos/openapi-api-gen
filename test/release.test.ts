import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";

test("publish workflow rejects mismatched versions and branch refs before publishing", () => {
  const workflow = parse(readFileSync(".github/workflows/publish.yml", "utf8"));
  const steps = workflow.jobs.publish.steps;
  const guardIndex = steps.findIndex(
    (step: { name?: string }) => step.name === "Verify release tag",
  );
  assert.ok(guardIndex >= 0);
  assert.ok(
    guardIndex <
      steps.findIndex(
        (step: { name?: string }) => step.name === "Publish to npm with OIDC",
      ),
  );
  const script = steps[guardIndex].run
    .split("<<'NODE'\n")[1]
    .split("\nNODE")[0];
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  for (const [refType, refName, succeeds] of [
    ["tag", `v${version}`, true],
    ["tag", "v0.0.0", false],
    ["tag", version, false],
    ["branch", `v${version}`, false],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        env: {
          ...process.env,
          GITHUB_REF_TYPE: refType,
          GITHUB_REF_NAME: refName,
        },
        encoding: "utf8",
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, succeeds ? 0 : 1, result.stderr);
  }
});
