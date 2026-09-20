import type { Diagnostic, NormalizedDocument, ObjectValue } from "./model.js";
import { identifier, jsdoc } from "./generation-utils.js";

export type EnumMember = {
  value: string;
  memberName: string;
  zhText: string;
  enText?: string;
};
export type ProjectEnum = {
  name: string;
  locations: string[];
  primitives: string[];
  missingMetadata: number;
  malformedMetadata: number;
  reasons: string[];
  members: EnumMember[];
};
export type EnumPlan = {
  enabled: boolean;
  enums: ProjectEnum[];
  generated: number;
  skipped: number;
};

const parseMembers = (
  entries: unknown[],
): { members: EnumMember[]; error?: string } => {
  const members: EnumMember[] = [];
  const names = new Set<string>();
  const values = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.indexOf(":") < 1)
      return { members: [], error: "ENUM_MALFORMED_ENTRY" };
    const colon = entry.indexOf(":");
    const value = entry.slice(0, colon);
    const display = entry.slice(colon + 1).trim();
    if (!value.trim() || !display)
      return { members: [], error: "ENUM_MALFORMED_ENTRY" };
    let balance = 0;
    for (const char of display) {
      if (char === "(") balance++;
      if (char === ")") balance--;
      if (balance < 0) return { members: [], error: "ENUM_MALFORMED_ENTRY" };
    }
    if (balance) return { members: [], error: "ENUM_MALFORMED_ENTRY" };
    let zhText = display;
    let enText: string | undefined;
    if (display.endsWith(")")) {
      let depth = 0;
      let start = -1;
      for (let index = display.length - 1; index >= 0; index--) {
        if (display[index] === ")") depth++;
        if (display[index] === "(" && --depth === 0) {
          start = index;
          break;
        }
      }
      if (start < 0) return { members: [], error: "ENUM_MALFORMED_ENTRY" };
      zhText = display.slice(0, start).trim();
      enText = display.slice(start + 1, -1).trim();
      if (!enText || !/^[\x20-\x7e]+$/.test(enText) || !/[A-Za-z]/.test(enText))
        return { members: [], error: "ENUM_INVALID_ENGLISH" };
    } else if (/[()]/.test(display))
      return { members: [], error: "ENUM_MALFORMED_ENTRY" };
    if (!/\p{Script=Han}/u.test(zhText))
      return { members: [], error: "ENUM_MALFORMED_ENTRY" };
    let memberName = value;
    if (!identifier(value)) {
      if (!enText) return { members: [], error: "ENUM_MISSING_ENGLISH" };
      memberName = enText
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    }
    // TypeScript reserves this enum member even though it is an identifier.
    if (!identifier(memberName) || memberName === "__proto__")
      return { members: [], error: "ENUM_INVALID_MEMBER" };
    if (names.has(memberName) || values.has(value))
      return { members: [], error: "ENUM_DUPLICATE_MEMBER" };
    names.add(memberName);
    values.add(value);
    members.push({
      value,
      memberName,
      zhText,
      ...(enText === undefined ? {} : { enText }),
    });
  }
  return { members };
};

// Scan source schema declarations once, including unused/deferred operations.
// Ref occurrences are not expanded; examples/defaults/extensions are data.
export const collectEnums = (
  document: NormalizedDocument,
  diagnostics: Diagnostic[],
  enabled = true,
): EnumPlan => {
  const groups = new Map<
    string,
    { result: ProjectEnum; signatures: Set<string> }
  >();
  const pointer = (key: string) =>
    key.replaceAll("~", "~0").replaceAll("/", "~1");
  const walk = (value: unknown, location: string, schema = false): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        walk(child, location + "/" + index, schema),
      );
      return;
    }
    const node = value as ObjectValue;
    if (schema && typeof node["x-enum-name"] === "string") {
      const name = node["x-enum-name"];
      const group = groups.get(name) ?? {
        result: {
          name,
          locations: [],
          primitives: [],
          missingMetadata: 0,
          malformedMetadata: 0,
          reasons: [],
          members: [],
        },
        signatures: new Set<string>(),
      };
      groups.set(name, group);
      const result = group.result;
      result.locations.push(location);
      const types = (Array.isArray(node.type) ? node.type : [node.type]).filter(
        (type) => type !== "null",
      );
      const primitive =
        types.length === 1 && typeof types[0] === "string"
          ? types[0]
          : "unknown";
      if (!result.primitives.includes(primitive))
        result.primitives.push(primitive);
      if (!identifier(name)) result.reasons.push("ENUM_INVALID_NAME");
      if (!["string", "number", "integer"].includes(primitive))
        result.reasons.push("ENUM_UNSUPPORTED_PRIMITIVE");
      if (node.enum === undefined) result.missingMetadata++;
      else if (!Array.isArray(node.enum) || node.enum.length === 0) {
        result.malformedMetadata++;
        result.reasons.push("ENUM_MALFORMED_ENTRY");
      } else {
        const parsed = parseMembers(node.enum);
        if (parsed.error) {
          result.malformedMetadata++;
          result.reasons.push(parsed.error);
        } else {
          // Compare complete definitions, preserving the first source member order.
          group.signatures.add(
            JSON.stringify(
              [...parsed.members].sort((a, b) =>
                a.memberName < b.memberName
                  ? -1
                  : a.memberName > b.memberName
                    ? 1
                    : 0,
              ),
            ),
          );
          if (!result.members.length) result.members = parsed.members;
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      const path = location + "/" + pointer(key);
      if (schema) {
        if (
          [
            "properties",
            "patternProperties",
            "$defs",
            "definitions",
            "dependentSchemas",
          ].includes(key)
        ) {
          if (child && typeof child === "object")
            Object.entries(child).forEach(([name, item]) =>
              walk(item, path + "/" + pointer(name), true),
            );
        } else if (
          [
            "items",
            "prefixItems",
            "additionalProperties",
            "unevaluatedProperties",
            "unevaluatedItems",
            "contains",
            "allOf",
            "anyOf",
            "oneOf",
            "not",
            "if",
            "then",
            "else",
            "propertyNames",
          ].includes(key)
        )
          walk(child, path, true);
      } else if (key === "schemas" && child && typeof child === "object") {
        Object.entries(child).forEach(([name, item]) =>
          walk(item, path + "/" + pointer(name), true),
        );
      } else if (
        !["example", "examples"].includes(key) &&
        !key.startsWith("x-")
      ) {
        walk(child, path, key === "schema");
      }
    }
  };
  walk(document.raw, "#");
  const enums = [...groups.values()].map(({ result, signatures }) => {
    if (result.primitives.length > 1)
      result.reasons.push("ENUM_PRIMITIVE_CONFLICT");
    if (signatures.size > 1) result.reasons.push("ENUM_DEFINITION_CONFLICT");
    if (!result.members.length && !result.malformedMetadata)
      result.reasons.push("ENUM_MISSING_METADATA");
    result.reasons = [...new Set(result.reasons)].sort();
    if (enabled) {
      const warnings = new Set(result.reasons);
      if (result.missingMetadata) warnings.add("ENUM_MISSING_METADATA");
      for (const code of [...warnings].sort())
        diagnostics.push({
          severity: "warning",
          code,
          location: result.name,
          message: code + ": " + result.name + "; DTO/VO primitive preserved.",
        });
    }
    if (result.reasons.length) result.members = [];
    return result;
  });
  const generated = enabled
    ? enums.filter((item) => !item.reasons.length).length
    : 0;
  return { enabled, enums, generated, skipped: enums.length - generated };
};

export const renderEnums = (plan: EnumPlan): string =>
  plan.enums
    .filter((item) => !item.reasons.length)
    .map(
      (item) =>
        "export enum " +
        item.name +
        " {\n" +
        item.members
          .map(
            (member) =>
              jsdoc(member.zhText) +
              member.memberName +
              " = " +
              JSON.stringify(member.value) +
              ",",
          )
          .join("\n") +
        "\n}",
    )
    .join("\n\n");
