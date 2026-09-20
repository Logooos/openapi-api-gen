import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
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
  assert.doesNotMatch(source, /npm view openapi-api-gen version/);
  assert.equal(
    steps[publish].run.trim().split("\n").at(-1),
    "npm publish --access public --provenance --registry=https://registry.npmjs.org/",
  );
  assert.doesNotMatch(source, /NPM_TOKEN/);
  assert.doesNotMatch(
    source.replace(/^\s*unset NODE_AUTH_TOKEN\s*$/gm, ""),
    /NODE_AUTH_TOKEN/,
  );
  assert.match(steps[publish].run, /^unset NODE_AUTH_TOKEN\n/);
  assert.ok(
    steps[publish].run.includes(
      "npm config delete //registry.npmjs.org/:_authToken\n",
    ),
  );
  const setup = steps.find((step: { uses?: string }) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  assert.ok(setup);
  assert.equal(Object.hasOwn(setup.with, "registry-url"), false);
  assert.equal(setup.with["node-version"], "24");
  assert.equal(setup.with["package-manager-cache"], false);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.bin["openapi-api-gen"], "dist/cli/index.js");
  const config = JSON.parse(readFileSync(".release-it.json", "utf8"));
  assert.equal(config.npm.publish, false);
  assert.equal(config.npm.skipChecks, true);
  assert.deepEqual(config.hooks["before:init"], [
    "pnpm check",
    "npm pack --dry-run --registry=https://registry.npmjs.org/",
  ]);
});

test("registry retries verify the exact version independently of latest observation", () => {
  const workflow = parse(readFileSync(".github/workflows/publish.yml", "utf8"));
  const step = workflow.jobs.publish.steps.find(
    (step: { name?: string }) => step.name === "Verify published version",
  );
  assert.equal(step.env.NPM_CONFIG_FETCH_RETRIES, "0");
  assert.equal(step.env.NPM_CONFIG_FETCH_TIMEOUT, "15000");
  const bash =
    process.platform === "win32"
      ? resolve(
          execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
          "../../../bin/bash.exe",
        )
      : "bash";
  for (const [scenario, exact, observation, status, attempts] of [
    [
      "exact version available while latest is old",
      "echo 0.5.3",
      "echo 'latest: 0.5.2'",
      0,
      1,
    ],
    [
      "exact version appears on third attempt",
      'if [ "$attempt" -lt 3 ]; then return 1; else echo 0.5.3; fi',
      "echo 'latest: 0.5.2'",
      0,
      3,
    ],
    [
      "exact version remains unavailable",
      "return 1",
      "echo 'latest: 0.5.3'",
      1,
      12,
    ],
    [
      "wrong exact version is rejected",
      "echo 0.5.2",
      "echo 'latest: 0.5.3'",
      1,
      12,
    ],
    ["dist-tag observation fails", "echo 0.5.3", "return 1", 0, 1],
  ] as const) {
    const result = spawnSync(
      bash,
      [
        "--noprofile",
        "--norc",
        "-e",
        "-c",
        `
node() { echo 0.5.3; }
sleep() { [ "$1" = 10 ] || exit 90; }
npm() {
  if [ "$*" = "view openapi-api-gen@0.5.3 version --registry=https://registry.npmjs.org/" ]; then
    echo exact-query >&2
    ${exact}
  elif [ "$*" = "view openapi-api-gen dist-tags --registry=https://registry.npmjs.org/" ]; then
    echo dist-tags-observation >&2
    ${observation}
  else
    echo unexpected-query >&2
    return 91
  fi
}
${step.run}`,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, status, `${scenario}: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /unexpected-query/);
    assert.equal(
      (result.stderr.match(/exact-query/g) ?? []).length,
      attempts,
      scenario,
    );
    assert.equal(
      (result.stderr.match(/dist-tags-observation/g) ?? []).length,
      status === 0 ? 1 : 0,
      scenario,
    );
  }
});
