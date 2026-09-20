import { access } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { validateConfig } from "../core/config.js";
import type { GeneratorConfig } from "../core/config.js";

export const mergeHeaders = (
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> => {
  const map = new Map<string, string>();
  for (const source of sources)
    for (const [name, value] of Object.entries(source ?? {})) {
      if (!/^[!#$%&'*+.^_~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value))
        throw new Error("INVALID_CONFIG: invalid HTTP header");
      map.set(name.toLowerCase(), value);
    }
  return Object.fromEntries(
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
};
export const loadConfig = async (
  cwd: string,
  path?: string,
): Promise<{ config: GeneratorConfig; path?: string }> => {
  const target = resolve(cwd, path ?? "openapi-gen.config.ts");
  try {
    await access(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && !path)
      return { config: {} };
    throw new Error("INVALID_CONFIG: cannot read " + target);
  }
  let imported: Record<string, unknown>;
  try {
    imported = await tsImport(pathToFileURL(target).href, import.meta.url);
  } catch {
    throw new Error("INVALID_CONFIG: could not execute " + target);
  }
  // tsx may wrap a TS config in a CommonJS namespace outside a type:module package.
  let config = imported.default;
  if (
    config &&
    typeof config === "object" &&
    Object.keys(config).length === 1 &&
    Object.hasOwn(config, "default")
  )
    config = (config as { default: unknown }).default;
  validateConfig(config);
  const base = dirname(target);
  return {
    path: target,
    config: {
      ...config,
      ...(config.input &&
      !/^[a-z][a-z\d+.-]*:\/\//i.test(config.input) &&
      !isAbsolute(config.input)
        ? { input: resolve(base, config.input) }
        : {}),
      ...(config.output ? { output: resolve(base, config.output) } : {}),
    },
  };
};
export const resolveConfig = async (
  cwd: string,
  cli: GeneratorConfig,
  path?: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const loaded = await loadConfig(cwd, path);
  let headers: unknown = {};
  try {
    headers = JSON.parse(env.OPENAPI_GEN_HEADERS ?? "{}");
  } catch {
    throw new Error("INVALID_CONFIG: OPENAPI_GEN_HEADERS must be JSON object");
  }
  validateConfig({ source: { headers } });
  const environment: GeneratorConfig = {
    ...(env.OPENAPI_GEN_INPUT ? { input: env.OPENAPI_GEN_INPUT } : {}),
    ...(env.OPENAPI_GEN_OUTPUT ? { output: env.OPENAPI_GEN_OUTPUT } : {}),
  };
  const config: GeneratorConfig = {
    output: "src/api",
    ...environment,
    ...loaded.config,
    ...cli,
    types: { ...loaded.config.types, ...cli.types },
    enum: { ...loaded.config.enum, ...cli.enum },
    barrel: { ...loaded.config.barrel, ...cli.barrel },
    source: {
      headers: mergeHeaders(
        headers as Record<string, string>,
        loaded.config.source?.headers,
        cli.source?.headers,
      ),
    },
  };
  validateConfig(config);
  return { config, configPath: loaded.path };
};
