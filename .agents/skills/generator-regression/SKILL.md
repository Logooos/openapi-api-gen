---
name: generator-regression
description: Verify public synthetic generator regressions after changes to parsing, normalization, module mapping, schema ownership, type/API/enum emission, configuration, CLI or file lifecycle. Use for broad generator changes and unexpected output drift.
---

# Generator regression

Read the relevant PRD.md and AGENTS.md requirements before interpreting output changes. Use only public synthetic fixtures under test/fixtures; do not import private fixtures, reports or acceptance evidence. This workflow does not authorize changing consumer output or running release commands.

1. Add or extend the smallest synthetic fixture for the changed behavior, then add a focused test. Preserve unrelated output and existing supported configuration.
2. Run `pnpm check` from the repository root. It runs type checking, all tests, formatting checks and build. There is no separate lint script; inspect package.json if commands change.
3. Reuse the strict generated-code compile helpers in test/generation.test.ts and test/cli.test.ts. Test generated consumers against Axios, including runtime request semantics where relevant. Verify unique schema definitions, named type-only imports, shared ownership/SCCs, parameter order, encoded paths, optional final signal and unchanged Axios promises.
4. Use test/fixtures/integration/synthetic.json for broad integration coverage. The CLI/Core end-to-end test in test/cli.test.ts checks equivalent output, strict compilation, immutable source input, dry-run parity, repeat generation and unchanged file mtimes. Report measured generated/deferred/schema/module counts and diagnostic categories; update test expectations only for explained behavior changes, never substitute another project's baseline.
5. Exercise the changed fixture twice with identical input, configuration and formatting. Compare complete output bytes and diagnostics. Confirm a second filesystem generation has create/modify/delete all zero and all managed files unchanged, including the manifest. Existing tests do this for the integration fixture; add focused coverage if that fixture cannot expose the change.
6. For file lifecycle changes, retain writer coverage in test/cli.test.ts: dry-run writes nothing, real writes match the plan, only manifest-owned stale files are removed, and unrelated handwritten files survive. test/isolated-layer.test.ts covers direct generated API consumers, optional adapters and sibling-directory protection. Never use a consumer's real API directory for regression output.
7. Enum changes also need test/fixtures/phase4.yaml, test/fixtures/phase4-invalid.yaml and the runtime enum regressions in test/generation.test.ts and test/style.test.ts. Use enum-parser-check for parsing details.

For a manual public-fixture check, use a fresh temporary output under the repository, for example:

```sh
pnpm generate test/fixtures/integration/synthetic.json --output .phase2-test-regression/api --dry-run
pnpm generate test/fixtures/integration/synthetic.json --output .phase2-test-regression/api
pnpm generate test/fixtures/integration/synthetic.json --output .phase2-test-regression/api
pnpm generate test/fixtures/integration/synthetic.json --output .phase2-test-regression/api --dry-run
```

Prefer existing test temporary-directory helpers; remove only the temporary directory created by this run after verifying its resolved path. Invalid fixtures should produce their expected fatal error or explicit deferral, not be forced to generate.

Finish with `git diff --check`. Report commands actually run, fixture coverage, strict compile and determinism results, second-run changes, baseline/diagnostic changes and remaining gaps. The release workflow has separate checks; passing regression does not authorize a version bump, tag, push or publication.
