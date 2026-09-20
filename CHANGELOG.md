# Changelog

Versions 0.5.1 and later are public npm releases. Earlier versions record repository milestones; milestone completion alone does not imply publication.

## Unreleased

- Remove setup-node token authentication configuration for npm Trusted Publishing and normalize the CLI bin path.
- Add explicit patch/minor/major release-it commands and a tag-triggered GitHub Actions workflow for validation, npm Trusted Publishing and GitHub Releases.
- Gate releases on local pack validation, strict tag/version matching, npm >=11.5.1, explicit provenance and bounded post-publish registry verification.

## 0.5.2

- Update README for the public npm release and generated-layer integration guidance.
- Emit arrays as T[] instead of Array<T>, preserving parentheses for union, intersection and nullable element types.

## 0.5.1 — Generated code style / DX patch

- Omit redundant application/json Content-Type while retaining operation headers and transport deferrals.
- Emit void 0 placeholders, dot APIS access, precise sorted named type imports and extensionless relative imports for Vite/Bundler.
- Compact one-line JSDoc and add types.propertyOrder: alphabetical (default) or source, without changing function/import/enum ordering.
- Add focused style/identifier/import collision/runtime enum regressions. No business migration, publish or tag.

## 0.5.0 — Phase 5 completed

- Add typed openapi-gen.config.ts/defineConfig, explicit CLI > config > environment precedence, JSON/YAML/HTTP(S) sources and source headers.
- Productize Core options: custom/zero-config Axios, module rename/glob split, operation selection/overrides, schema owners, int64/nullable, enum path and optional root barrel.
- Add content-based diff writing, managed stale cleanup, dry-run, single-module dependency closure and protection for unrelated handwritten files.
- Discover project Prettier configuration with defaults; provide CLI help, stable diagnostics/exit codes and complete README usage.
- Support defineConfig in ESM and CommonJS consumer projects; require Node >=22.12 for synchronous ESM loading, move existing tsx to runtime dependencies without a version upgrade.
- Deferred: multipart FormData, default-only/JSON binary guessing, enum-list requests, hooks; consumer integration review and full v1 acceptance remain before 1.0.0. No publish or tag.

## 0.4.0 — Phase 4 completed

- Parse x-enum-name metadata and emit independent runtime enums in _shared/enum.ts, preserving primitive fields and standard literal unions.
- Derive members deterministically from English when needed; preserve numeric-looking string values and source order.
- Deduplicate compatible definitions globally; suppress malformed/conflicting/missing definitions with warnings per name/cause. Support Core enum.enabled (default true).
- Add focused fixtures, runtime checks, strict output compilation and deterministic integration verification.
- Deferred: enum-list, FormData, new default-only/JSON binary strategies, hooks and Phase 5 filesystem/full CLI workflows.

## 0.3.0 — Phase 3 completed

- Build the global schema dependency graph, transitive usage modules and deterministic SCCs before file emission.
- Infer unique owners, support Core schemaOwners overrides, hoist shared dependencies/SCCs, and reject ownership conflicts.
- Emit _shared/type.ts and sorted, deduplicated cross-module import type declarations without duplicate schemas.
- Add minimal ownership/cycle/graph fixtures with strict generated-output compilation and determinism regression tests.
- Deferred: runtime enums, full config/CLI and file writer/stale cleanup/dry-run; existing unsupported response/transport cases remain explicit diagnostics. No Phase 4 work.

## 0.2.0 — Phase 2 completed

- Add Phase 2 in-memory generation plans and generated files, basic Axios APIs and TypeScript types, deterministic formatting, and a JSON-output `generate` command.
- Preserve suffixes, encoded paths, query/body/business headers/signal, Axios promises, successful response unions, schema metadata and standard enums. Keep x-enum-name fields primitive.
- Defer shared schema dependencies and unsupported operations with diagnostics instead of copying definitions or guessing ownership.
- Compile synthetic fixture outputs against Axios and verify deterministic generation without modifying the integration source.
- Deferred: cross-module ownership, `_shared/type.ts`, SCC handling, runtime enum generation, full configuration/overrides, file writing, stale cleanup and dry-run. Multipart FormData and React Query hooks remain outside v1 scope.
- Operations requiring shared schemas, default-only success interpretation, JSON binary requests or unsupported transport/serialization remain explicitly deferred with diagnostics.

## 0.1.0 — Phase 1 / 1.5 completed

- Establish a single-package Node.js + TypeScript repository with logically separate Core and CLI.
- Load local JSON/YAML and HTTP(S), detect OpenAPI 3.0.x/3.1.x, normalize operations and schemas, and provide the diagnose command with operation/schema/tag, duplicate ID, multipart and x-enum-name statistics.
- Add focused fixtures, integration preservation checks, type checking, formatting, build and deterministic diagnostic verification.
- Deferred at this milestone: all API/type generation, ownership/shared/SCC handling, runtime enum generation, configuration and file-output workflows. External object references and complete OpenAPI/JSON Schema validation remain unsupported.
