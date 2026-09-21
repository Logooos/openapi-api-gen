---
name: enum-parser-check
description: Implement, debug or review x-enum-name parsing and its boundary with standard OpenAPI enums, including deterministic English member derivation, raw-value preservation and warning/fallback regressions.
---

# Enum parser check

Read the enum rules in AGENTS.md and PRD.md, then inspect src/core/enum-generator.ts and its callers. Use public synthetic fixtures only. Do not infer translations or contact an enum-list service to fill missing metadata.

## Two distinct contracts

- Without x-enum-name, standard enum entries remain a literal union such as `"IDLE" | "READY"`; do not emit a runtime enum for them.
- With x-enum-name, the DTO/VO property retains its declared primitive. When enabled and reliably parseable, emit the independent runtime enum in the configured enum output (default `_shared/enum.ts`). Do not replace the field type with the enum name.

Use neutral synthetic metadata such as `READY:就绪(Ready)` and `1:深蓝(Dark Blue)`. These produce `READY = "READY"` and `DARK_BLUE = "1"`. A numeric-looking raw string remains a string; never convert it to numeric 1.

## Parser review

1. Split at the first colon. Preserve the raw value bytes, including whitespace; reject an empty/whitespace-only value.
2. Require a display portion with Chinese text. Check balanced parentheses and the optional final parenthesized English portion. Current code rejects an English portion that is empty, non-ASCII or lacks an English letter, even when the raw value is already an identifier.
3. Reuse the current identifier validator. A valid raw identifier supplies the member name unchanged. Otherwise require English text; split camel/acronym boundaries, replace punctuation/spacing with underscores, trim boundary underscores and uppercase deterministically. Do not translate Chinese or invent missing English.
4. Reject invalid derived names and the reserved enum member __proto__. Check both duplicate member names and duplicate raw values.
5. Compare repeated definitions by their complete parsed metadata and primitive types. Equivalent ordering variants keep the first source member order; conflicts suppress the logical enum rather than emitting a partial definition.
6. On parse failure, preserve the field primitive, skip the affected runtime enum and emit a deduplicated warning per logical enum name/cause. Reuse existing ENUM_* codes rather than introducing overlapping warnings.
7. Scan actual schema declarations, including inline, unused and deferred-operation metadata; do not treat example/default payloads as schemas or expand every ref occurrence into another definition.

## Regression

Reuse test/fixtures/phase4.yaml and test/fixtures/phase4-invalid.yaml, with focused cases in test/generation.test.ts. Cover identifier values, numeric-looking strings, punctuation/camel case, raw whitespace, missing English, malformed parentheses/colon, duplicate names/values, identical/conflicting definitions and standard enum isolation. Confirm disabled enum output and primitive fields are unchanged.

Run `pnpm check`. The generation and style suites already provide strict generated TypeScript compilation, deterministic repeated generation, enum runtime imports/values and warning deduplication checks. Extend those harnesses instead of inventing a new runner. Report generated/skipped enums and diagnostic changes using actual synthetic results; do not freeze unrelated project counts into this skill.
