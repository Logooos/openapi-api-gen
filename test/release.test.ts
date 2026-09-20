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
  for (const [refType, refName, packageVersion, succeeds] of [
    ["tag", `v${version}`, version, true],
    ["tag", "v0.0.0", version, false],
    ["tag", version, version, false],
    ["branch", `v${version}`, version, false],
    ["tag", "v01.2.3", "01.2.3", false],
    ["tag", "v1.2", "1.2", false],
    ["tag", "v1.2.3-01", "1.2.3-01", false],
    ["tag", "v1.2.3-rc.1+build.2", "1.2.3-rc.1+build.2", true],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        script.replace(
          "JSON.parse(readFileSync('package.json', 'utf8'))",
          JSON.stringify({ version: packageVersion }),
        ),
      ],
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

test("release gates keep official-registry OIDC publishing ahead of GitHub Release", () => {
  const source = readFileSync(".github/workflows/publish.yml", "utf8");
  const { jobs } = parse(source);
  const steps = jobs.publish.steps;
  const index = (name: string) =>
    steps.findIndex((step: { name?: string }) => step.name === name);
  const publish = index("Publish to npm with OIDC");
  const verify = index("Verify published version");
  assert.ok(publish >= 0 && publish < verify);
  assert.ok(verify < index("Create GitHub Release"));
  assert.equal(
    steps[publish].run,
    "npm publish --access public --provenance --registry=https://registry.npmjs.org/",
  );
  assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  const config = JSON.parse(readFileSync(".release-it.json", "utf8"));
  assert.equal(config.npm.publish, false);
  assert.equal(config.npm.skipChecks, true);
  assert.deepEqual(config.hooks["before:init"], [
    "pnpm check",
    "npm pack --dry-run --registry=https://registry.npmjs.org/",
  ]);
});
