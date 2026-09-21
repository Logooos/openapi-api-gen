---
name: openapi-spec-audit
description: Read-only audit of supplied OpenAPI inputs for operation naming, tags, parameters, response contracts, schema dependencies, unsupported transport cases, enum metadata and diagnostics. Use when investigating a spec update or planning generator support; implementation is a separate task.
---

# OpenAPI spec audit

Identify the exact authorized input and read PRD.md before classifying support. Use public synthetic examples in committed findings; do not copy private input, business names, endpoints, domains, paths or acceptance statistics into this repository. Do not modify the input or generator during an audit.

From the repository root, existing read-only tools include:

```sh
pnpm diagnose test/fixtures/integration/synthetic.json
node scripts/audit-spec.mjs test/fixtures/integration/synthetic.json
pnpm generate test/fixtures/integration/synthetic.json --plan
```

The audit script accepts a local JSON file, not YAML or a URL. For YAML, reuse parseSpec/normalizeSpec or the CLI; do not pass YAML to the JSON-only script. Diagnose provides structural counts, while generate --plan exposes generation decisions without writing generated files. Do not mistake exit code zero for complete operation coverage. Do not fetch a live source or enum service unless the task authorizes that access.

Inspect these dimensions programmatically rather than deriving counts from text searches:

- Version: OpenAPI 3.0/3.1, invalid structure and unsupported major versions.
- Operations: missing/duplicate raw operationId, preserved numeric suffixes, HTTP methods, first-tag ownership and configured module rename/path splits/operation overrides.
- Parameters: path/query/header/cookie, required fields, path placeholders, serialization, ignored global headers versus business headers, and request-body media types.
- Responses: explicit status/media/body contracts, multiple 2xx alternatives, default and error responses, missing bodies and response references. Distinguish graph usage from the responses actually selected by current code. Consult generation-utils.ts, generation-plan.ts and current PRD.md; do not infer undocumented success bodies or silently introduce new response precedence.
- Schemas: local and external refs, unresolved refs, transitive dependencies, allOf/oneOf/anyOf, nullable, required, additionalProperties, recursive structure and alias cycles. Do not interpret examples, enum values or schema default payloads as references; a response named default is a response object, not a schema default payload.
- Ownership: reuse the global graph and generation plan for usage, unused schemas, explicit owners, shared dependencies and cross-module SCCs. scripts/audit-spec.mjs is an inventory tool, not the authoritative configured ownership resolver.
- Transport: multipart, explicit binary metadata and overrides, incompatible media types and unsupported serialization. Names suggesting a download do not establish Blob semantics.
- Enums: standard literal unions versus x-enum-name primitive fields/runtime enums, VALUE:中文(English) metadata, exact raw values, missing English when needed, duplicate members and conflicting definitions.
- Diagnostics: distinguish supported, supported with explicit configuration, recoverable fallback/deferral and fatal errors. Record warning codes and locations without inventing business migration statuses.

Return measured counts, concise findings with safe representative examples, support boundaries and the smallest public synthetic fixtures needed to reproduce issues. Keep implementation recommendations separate from observed behavior.
