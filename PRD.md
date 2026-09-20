# Product requirements — 0.5.1

## Scope

openapi-api-gen is an OpenAPI-driven transport API/type generator for OpenAPI 3.0.x and 3.1.x. It is a single Node.js + TypeScript package with logically separate Core and CLI. JSON, YAML and HTTP(S) sources are supported. Swagger 2.0 is out of scope.

Generated APIs are directly callable. Optional handwritten adapters may wrap them or handle special requests independently. v1 does not automatically infer undocumented payload transformations, business workflows, cancellation orchestration, timeout policies or multi-client routing. Full replacement of an existing handwritten API layer is not a v1 acceptance requirement. Consumer migration decisions are not Core statuses.

## Transport and types

- Generate an APIS constant and req-prefixed PascalCase operation functions, preserving operationId suffixes. Duplicate operationId is fatal.
- Encode path replacements; group query parameters into Params types. Parameter order is path, query, body, optional AbortSignal. Preserve AxiosResponse promises without unwrapping data.
- Preserve operation headers except explicitly ignored headers. Ordinary JSON requests use Axios Content-Type defaults.
- Emit object type aliases, required/optional fields, nullable unions, literal enums, intersections for allOf, unions for oneOf/anyOf and typed additionalProperties. Dates remain strings; int64 defaults to number and is configurable. The JsonNode convention remains an arbitrary-key object.
- Build a global dependency graph. Each schema has one definition. Infer module usage transitively; shared schemas and cross-module SCCs belong in _shared/type.ts. Explicit owner overrides take precedence but inconsistent ownership is fatal.
- x-enum-name fields remain primitive. Independently generate runtime enums from reliable VALUE:中文(English) metadata. Valid identifier values supply member names; otherwise English text supplies deterministic UPPER_SNAKE_CASE. Preserve literal values, including numeric-looking strings. Deduplicate consistent definitions; warn and suppress ambiguous/conflicting definitions. Never translate or guess.
- Explicit 2xx bodies determine responses; absent bodies mean void, distinct bodies form a deduplicated union.

## Configuration and organization

README documents the public defineConfig interface. Preserve custom requestClient per generation and standalone Axios mode, configurable output, ignoredHeaders, moduleNames, path-glob splits, schemaOwners, operation selection, operation/schema overrides, type options, runtime enum options and optional root barrel.

Default ownership uses the first tag. Operation override, path split and module rename can organize generated transport files; they do not promise to reproduce a legacy frontend architecture. Nested module paths and arbitrary multi-tag merging are post-v1 enhancements. Current module collision validation remains in force.

A dedicated output such as src/apis/generated is recommended for existing projects, not mandatory. Default output remains src/api. Multiple services can use independent configurations/outputs or adapters; one generation need not orchestrate multiple clients.

CLI precedence is explicit CLI > config > environment > defaults. Config files are executable trusted TypeScript. Source credentials are not emitted into generated API files.

## Output lifecycle and style

Compute and format complete desired output before writing. Compare contents and write only changes. Manifest-managed stale files may be removed; unrelated handwritten files must remain intact. Validate paths and reject traversal/collision/unsafe links. Dry-run reports create/modify/delete/unchanged without writing. Single-module generation includes dependencies and requires a full run when necessary to preserve consistency. Multi-file writes are not transactional.

Discover consumer Prettier configuration with a deterministic fallback. Identical input/config/formatting context produces identical files. Never emit timestamps.

Generated placeholders use void 0. APIS uses dot notation for valid IdentifierName and brackets otherwise. Use only needed, sorted, deduplicated named type imports with safe aliases; relative generated imports are extensionless. Runtime enums remain runtime exports/imports. Single-line descriptions use compact JSDoc; genuine multiline descriptions remain multiline. types.propertyOrder is alphabetical by default with locale-independent ordering, or source; it controls schema/type properties only.

## Diagnostics and acceptance

Multipart FormData generation, default-only response inference, undocumented binary inference, React Query hooks and enum-list network requests are not v1 features. Unsupported operations have explicit recoverable diagnostics. Never guess malformed or incomplete contracts to increase coverage. Fatal input/config/ownership/output errors exit nonzero. Recoverable diagnostics can coexist with successful generation; callers must inspect diagnostics and counts.

Acceptance requires automated synthetic regressions for parsers, graph/SCC/ownership, API/type/enum generation, configuration, CLI and file lifecycle; strict compilation of generated consumers; Core/CLI parity; deterministic repeat generation; dry-run parity; and unmanaged-file protection. Consumer-specific integrations can provide additional evidence without adding proprietary fixtures to this repository.

## Milestones

Phase 1/1.5 = 0.1.0; Phase 2 = 0.2.0; Phase 3 = 0.3.0; Phase 4 = 0.4.0; Phase 5 = 0.5.0; accepted style patch = 0.5.1. Full v1 acceptance is required before 1.0.0. Milestones do not imply npm publication, Git tags or GitHub Releases. Phase completion updates package version, changelog and phase evidence; user-visible patches follow semantic versioning.
