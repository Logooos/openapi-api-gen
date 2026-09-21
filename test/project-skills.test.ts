import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

test("project skills contain only public generic guidance", () => {
  const root = ".agents/skills";
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  assert.equal(files.length, 3);
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    assert.ok(frontmatter, file);
    const metadata = parse(frontmatter[1]!);
    assert.ok(file.endsWith(join(metadata.name, "SKILL.md")), file);
    assert.ok(metadata.description, file);
    assert.doesNotMatch(
      content,
      /star-os(?:-web)?|starvision|\b310\s*[/,]\s*24\b|[a-z]:[/\\]|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[\da-f]{0,4}:){2,}|https?:\/\//i,
      file,
    );
    // These skills need repository filenames, but no network hostnames.
    for (const [dotted] of content.matchAll(
      /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi,
    ))
      assert.match(
        dotted,
        /\.(?:md|ts|mjs|json|ya?ml)$|^3\.[01]$/i,
        `${file}: ${dotted}`,
      );
  }
});
