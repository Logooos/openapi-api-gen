# AGENTS.md

## Repository purpose

This repository implements an OpenAPI 3.0.x / 3.1.x → TypeScript API/type generator.

The frozen product and technical requirements live in `PRD.md`. Read the relevant PRD sections before changing generation semantics. Do not silently reinterpret the PRD.

## Working agreements

- Use Node.js + TypeScript.
- Prefer `pnpm`.
- Keep the architecture logically separated into parser/normalizer, module resolution, schema dependency graph, type generation, enum generation, API generation, formatting, diagnostics, and CLI concerns.
- Start simple. Do not introduce a monorepo/package split, plugin framework, cache layer, or other infrastructure unless the current task requires it.
- Keep the core generator deterministic: identical OpenAPI + config must produce byte-for-byte identical output.
- Never add generation timestamps or other nondeterministic content.
- Do not use AI/LLM inference inside the generator for naming, translation, schema ownership, or enum interpretation.
- Do not silently correct malformed OpenAPI semantics. Use explicit configured project rules, fallback + diagnostic, or a fatal error as defined by the PRD.

## Transport scope and compatibility

- Treat the product as an OpenAPI-driven transport API/type generator, including runtime enums, generated module organization, deterministic output, and generator-owned file lifecycle. Preserve accepted capabilities; migration convenience must not remove or weaken them.
- Before changing behavior, identify whether the concern belongs to the generator, a consumer adapter/request layer, business logic, or an external OpenAPI contract. Do not hardcode a single consumer project's architecture or behavior into Core.
- Ordinary generated APIs remain directly callable. Handwritten adapters are optional, valid long-term integration points; they may call generated APIs or handle special requests independently. Full replacement of a legacy handwritten API layer is not a v1 acceptance requirement.
- v1 does not automatically infer undocumented business transformations or orchestration. Do not reverse-engineer missing OpenAPI semantics from handwritten behavior into general generator rules; retain explicit diagnostics and existing supported configuration/overrides.
- Preserve per-generation custom request configuration, standalone Axios mode, configurable output, module rename/path split/operation module override, and schema ownership. Generated module mapping organizes transport files, not a complete legacy architecture migration; output isolation is advice, not a mandatory Core path.
- Keep consumer migration policy states and approval decisions outside the Core generation/diagnostics model. A scope clarification is not authorization to implement candidate enhancements or change accepted runtime behavior.

## Versioning and maintenance

- Follow Semantic Versioning.
- Update CHANGELOG.md for user-visible changes.
- Maintain the repository milestone version whenever a PRD Phase is completed.
- A milestone version does not imply npm publish, a Git tag, or a GitHub Release; those are separate, explicitly requested actions.
- Milestone mapping: Phase 1/1.5 = `0.1.0`; Phase 2 = `0.2.0`; Phase 3 = `0.3.0`; Phase 4 = `0.4.0`; Phase 5 = `0.5.0`; full v1 acceptance passed = `1.0.0`.
- At each Phase completion, update the package version and CHANGELOG.md, and record the milestone version in the phase report. Do not advance the milestone before its Phase is completed.
- Before a release, run the full generator regression workflow.
- Publish npm releases with the official registry explicitly specified: `npm publish --access public --registry=https://registry.npmjs.org/`. Never rely on the configured default registry, which may be a mirror. Use the same explicit registry for npm authentication and release verification.
- Dependency or runtime upgrades must pass the real OpenAPI integration suite.
- Do not modify the stable real-world fixture merely to make a regression pass.

## Required generation invariants

- Support OpenAPI 3.0.x and 3.1.x. Do not add Swagger/OpenAPI 2.0 support unless explicitly requested.
- Default module ownership is the first OpenAPI tag. Module rename and path-glob split rules may override it.
- Generate API function names from the raw `operationId`: `req${PascalCase(operationId)}`.
- Preserve backend suffixes such as `_1` and `_2`; never remove them automatically.
- Duplicate `operationId` is fatal.
- Generate an `APIS` constant per module.
- Path parameters use chained `.replace()` with `encodeURIComponent(String(value))`.
- Query parameters are grouped into a dedicated `XxxParams` type and passed through Axios `{ params }`.
- API parameter order is always: path params → query params → request body → `signal`.
- Every generated API function ends with optional `signal?: AbortSignal`.
- Preserve Axios response semantics. Generated API functions return the request promise and do not unwrap `.data`.
- Global headers configured in `ignoredHeaders` are not emitted as API parameters. Operation-specific business headers still are.
- Missing successful response bodies map to `void`.
- Multiple distinct 2xx response bodies map to a deduplicated union.

## Type-system invariants

- Emit object schemas using `export type`, not `interface`.
- Respect OpenAPI `required`.
- Preserve nullable as `T | null` by default.
- Dates and date-times remain `string`.
- `int64` defaults to `number` but remains configurable.
- `additionalProperties` maps to `Record<string, T>`.
- `allOf` maps to intersections.
- `oneOf` / `anyOf` map to unions.
- The project JsonNode convention is `{ [key: string]: any }`.
- Preserve OpenAPI schema names such as `DTO` and `VO` unless an explicit override exists.
- Generate JSDoc from available schema/property/operation descriptions. Do not synthesize validation prose from min/max constraints in v1.

## Schema dependency and ownership invariants

- Build one global schema dependency graph before emitting files.
- A schema must have exactly one generated definition.
- If a schema is used only by one module, that module owns it unless an explicit owner override applies.
- Schemas used by multiple modules go to `_shared/type.ts` by default.
- Explicit schema owner configuration has higher priority than inferred ownership.
- Detect strongly connected components. If a cycle crosses module boundaries, hoist that SCC to `_shared/type.ts`.
- Cross-module type-only dependencies use `import type`.
- Never solve cross-module dependencies by duplicating schema definitions.

## Enum invariants

Two enum modes must remain distinct.

### Standard OpenAPI enum

If a schema has `enum` and no `x-enum-name`, emit a literal union, for example:

```ts
status?: "IDLE" | "READY" | "FAILED";
```

### Project-specific `x-enum-name`

- The DTO/VO field itself remains its OpenAPI primitive (`string`, `number`, etc.).
- Runtime enums are generated separately in `_shared/enum.ts` when enabled.
- Do not call `/common/enum-list/{enumName}` in v1.
- Parse strings shaped like `VALUE:中文(English)`.
- If `VALUE` is a valid TypeScript identifier, use it as the enum member name.
- If `VALUE` is not a valid identifier (for example `1`), derive the member name from the English display text using deterministic `UPPER_SNAKE_CASE`.
- Preserve the OpenAPI enum value exactly. Example: numeric-looking string `1` remains `"1"`.
- If member names cannot be derived reliably and uniquely, do not generate that enum. Keep the field primitive and emit a deduplicated warning.
- Never translate Chinese or invent an English member name.

## Unsupported and fallback behavior

- `multipart/form-data` automatic generation is out of scope for v1. Skip the unsupported operation with a clear recoverable diagnostic rather than failing the entire spec.
- Binary/blob handling is based only on explicit OpenAPI metadata or an operation override. Do not infer Blob from words such as `download` or `export`.
- Unknown recoverable schema cases should produce valid TypeScript via documented fallback + diagnostic.
- Fatal errors include invalid OpenAPI, unsupported major version, duplicate operationId, module name collision, schema owner conflict, invalid output path, invalid config, and unrecoverable graph inconsistency.

## File-system rules

- Default output is `src/api`, configurable by the user.
- Generated module shape is `<module>/index.ts` + `<module>/type.ts`.
- Shared types use `_shared/type.ts`; generated project enums use `_shared/enum.ts`.
- Root barrel generation is optional and off by default.
- Existing target generated files may be overwritten as specified by the PRD.
- Compute the complete desired output first, compare contents, and write only changed files.
- Do not delete unrelated handwritten files from module directories.
- Support dry-run with create/modify/delete/unchanged reporting.
- During generator development, do not overwrite a consumer application's real `src/api` unless the user explicitly requests it. Prefer fixtures or a temporary output directory.

## Verification requirements

After changing generator behavior:

1. Add or update the smallest focused fixture first.
2. Add or update automated tests for the behavior.
3. Run the relevant test suite.
4. Run TypeScript type checking.
5. Run formatting/lint commands if the repository defines them.
6. Run the generator against fixtures.
7. For broad semantic changes, run against the real integration OpenAPI fixture when available.
8. Run generation twice and verify the second run produces no content changes.
9. Summarize warnings/errors introduced or resolved.

Use the repo skill `$generator-regression` for broad generator changes.

## Change discipline

- Prefer small, reviewable changes over large rewrites.
- Do not change unrelated generation output while implementing a focused feature.
- If a change intentionally alters generated output, show representative before/after examples.
- Add a regression fixture for every bug fix.
- When a repeated project-specific rule is discovered, update this `AGENTS.md` only if it is a universal repository invariant; otherwise put the workflow/detail into a repo Skill or test fixture.

## Generated code style (0.5.1)

- Ordinary application/json requests rely on Axios defaults; do not inject Content-Type. Preserve explicit operation headers and special-media deferrals.
- Generated value placeholders use `void 0`, never the `undefined` keyword. Optional-before-required parameter types use equivalent optional-property indexed access to retain the exact accepted values without spelling that keyword. Do not rewrite source names, descriptions or literal enum values.
- APIS property access uses dot notation for valid IdentifierName (including reserved words and Unicode); otherwise use brackets.
- Emit only used, deduplicated, deterministically sorted named `import type` bindings, with safe aliases when names collide. Never emit a Types namespace. Relative generated imports are extensionless by default; runtime values such as enums remain runtime imports/exports.
- One-line descriptions use compact `/** ... */`; genuine multiline descriptions/tags keep multiline JSDoc. Do not add blank lines between documented properties.
- `types.propertyOrder` is `alphabetical` (default, locale-independent code-unit comparison) or `source` (normalized source declaration order). This controls schema/type properties only, never import, APIS, function or enum ordering.
