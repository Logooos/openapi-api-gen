import { lstat, readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, parse, dirname, sep, posix } from "node:path";
import type {
  GeneratedFile,
  GenerationResult,
} from "../core/generation-model.js";
import { assertOutputFile } from "../core/config.js";

const manifestName = ".openapi-api-gen.json";
export type FileChange = {
  path: string;
  action: "create" | "modify" | "delete" | "unchanged";
};
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
const read = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (absent(e)) return undefined;
    throw e;
  }
};
const safe = async (path: string): Promise<void> => {
  let current = resolve(path);
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
        throw new Error("UNSAFE_OUTPUT: links are not writable targets");
    } catch (e) {
      if (!absent(e)) throw e;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
};
export const selectFiles = (
  result: GenerationResult,
  module?: string,
): GeneratedFile[] => {
  if (!module) return result.files;
  if (!result.plan.modules.some((m) => m.name === module))
    throw new Error("INVALID_MODULE: " + module);
  const byPath = new Map(result.files.map((f) => [f.path, f]));
  const selected = new Set(
    result.files
      .filter(
        (f) => f.path.startsWith(module + "/") || f.path === "_shared/enum.ts",
      )
      .map((f) => f.path),
  );
  const pending = [...selected];
  while (pending.length) {
    const path = pending.pop()!;
    for (const match of byPath
      .get(path)!
      .content.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (!match[1]!.startsWith(".")) continue;
      const dependency = posix.normalize(
        posix.join(posix.dirname(path), match[1]!.replace(/\.js$/, "") + ".ts"),
      );
      if (byPath.has(dependency) && !selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }
  // enum output may be configured elsewhere; it has no incoming type imports.
  result.files
    .filter((f) => /\bexport enum\b/.test(f.content))
    .forEach((f) => selected.add(f.path));
  return result.files.filter((f) => selected.has(f.path));
};
export const writeOutput = async (
  output: string,
  files: GeneratedFile[],
  options: {
    dryRun?: boolean;
    module?: string;
    fullFiles?: GeneratedFile[];
  } = {},
) => {
  const root = resolve(output);
  if (
    root === parse(root).root ||
    root.split(/[\\/]/).some((p) => [".git", ".agents", ".codex"].includes(p))
  )
    throw new Error("INVALID_OUTPUT_PATH: unsafe output root");
  const target = (path: string) => {
    if (path !== manifestName) assertOutputFile(path);
    const resolved = resolve(root, path);
    if (!resolved.startsWith(root + sep))
      throw new Error("INVALID_OUTPUT_PATH: outside output root");
    return resolved;
  };
  await safe(root);
  const manifestPath = target(manifestName);
  await safe(manifestPath);
  const oldManifest = await read(manifestPath);
  let previous: string[] = [];
  if (oldManifest !== undefined) {
    let data: unknown;
    try {
      data = JSON.parse(oldManifest);
    } catch {
      throw new Error("INVALID_MANIFEST: invalid JSON");
    }
    const value = data as { version?: unknown; files?: unknown };
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.files) ||
      value.files.some((p) => typeof p !== "string")
    )
      throw new Error("INVALID_MANIFEST: unsupported structure");
    previous = value.files;
    if (
      new Set(previous.map((p) => p.normalize("NFC").toLowerCase())).size !==
      previous.length
    )
      throw new Error("INVALID_MANIFEST: duplicate files");
    previous.forEach((p) => {
      assertOutputFile(p);
      target(p);
    });
  }
  const desired = new Map<string, string>();
  const canonical = new Set<string>();
  for (const file of files) {
    target(file.path);
    const key = file.path.normalize("NFC").toLowerCase();
    if (canonical.has(key))
      throw new Error("INVALID_OUTPUT_PATH: duplicate targets");
    if (
      previous.some(
        (p) => p !== file.path && p.normalize("NFC").toLowerCase() === key,
      )
    )
      throw new Error(
        "INVALID_OUTPUT_PATH: case/Unicode-only rename of managed file",
      );
    canonical.add(key);
    desired.set(file.path, file.content);
  }
  // A partial run must not invalidate already managed, unselected consumers.
  if (options.module) {
    const full = new Map(options.fullFiles?.map((f) => [f.path, f.content]));
    for (const path of previous)
      if (!desired.has(path) && !path.startsWith(options.module + "/")) {
        await safe(target(path));
        if ((await read(target(path))) !== full.get(path))
          throw new Error(
            "PARTIAL_REQUIRES_FULL_RUN: " + path + " also needs regeneration",
          );
      }
  }
  const stale = previous.filter(
    (p) =>
      !desired.has(p) &&
      (!options.module || p.startsWith(options.module + "/")),
  );
  const retained = previous.filter((p) => !stale.includes(p));
  const next =
    JSON.stringify(
      {
        version: 1,
        files: [...new Set([...retained, ...desired.keys()])].sort(),
      },
      null,
      2,
    ) + "\n";
  desired.set(manifestName, next);
  const changes: FileChange[] = [];
  for (const [path, content] of desired) {
    await safe(target(path));
    const existing = await read(target(path));
    changes.push({
      path,
      action:
        existing === undefined
          ? "create"
          : existing === content
            ? "unchanged"
            : "modify",
    });
  }
  for (const path of stale) {
    await safe(target(path));
    if ((await read(target(path))) !== undefined)
      changes.push({ path, action: "delete" });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // All content and paths have been checked before the first mutation.
  if (!options.dryRun)
    for (const change of [
      ...changes.filter((c) => c.path !== manifestName),
      ...changes.filter((c) => c.path === manifestName),
    ]) {
      const path = target(change.path);
      if (change.action === "delete") await unlink(path);
      else if (change.action !== "unchanged") {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, desired.get(change.path)!);
      }
    }
  return {
    output: root,
    changes,
    summary: Object.fromEntries(
      ["create", "modify", "delete", "unchanged"].map((action) => [
        action,
        changes.filter((c) => c.action === action).length,
      ]),
    ),
    staleModules: [...new Set(stale.map((p) => p.split("/")[0]!))].sort(),
  };
};
