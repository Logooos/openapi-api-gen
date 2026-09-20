#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { parseSpec, normalizeSpec, diagnose, generate } from "../core/index.js";
import type { GeneratorConfig } from "../core/config.js";
import { loadSource } from "./load.js";
import { resolveConfig, mergeHeaders } from "./config.js";
import { projectFormatter } from "./format.js";
import { selectFiles, writeOutput } from "./output.js";

const help =
  "Usage: openapi-api-gen [generate] [input] [options]\n" +
  "       openapi-api-gen diagnose <input>\n" +
  "Input: local JSON/YAML or HTTP(S); may come from config/environment.\n" +
  "  -c, --config <file>      TypeScript config (default openapi-gen.config.ts)\n" +
  "  -o, --output <dir>       Output directory (default src/api)\n" +
  "  --header <key=value>     Source HTTP header; repeatable\n" +
  "  --module <name>          Update one final module and its type dependencies\n" +
  "  --dry-run               Report create/modify/delete/unchanged; no disk changes\n" +
  "  --plan                  Print Core {plan,files,enums}; no disk changes\n" +
  "  --ignored-header <name>  Override ignoredHeaders; repeatable\n" +
  "  --include-operation <id> Include raw operationId; repeatable\n" +
  "  --exclude-operation <id> Exclude raw operationId; repeatable\n" +
  "  --int64 <number|string|bigint>  --nullable <union-null|ignore>\n" +
  "  --barrel / --no-barrel   Enable/disable root barrel\n" +
  "  --no-enum               Disable runtime enums\n" +
  "  -h, --help              Show help\n" +
  "  --version               Show milestone version\n" +
  "Precedence: explicit CLI > config > OPENAPI_GEN_INPUT/OUTPUT/HEADERS > defaults.\n" +
  "Warnings and recoverable skipped operations exit 0; fatal errors exit 1.\n" +
  "Existing target files are overwritten; only manifest-managed stale files are removed.";
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      config: { type: "string", short: "c" },
      output: { type: "string", short: "o" },
      header: { type: "string", multiple: true },
      module: { type: "string" },
      "dry-run": { type: "boolean" },
      plan: { type: "boolean" },
      "ignored-header": { type: "string", multiple: true },
      "include-operation": { type: "string", multiple: true },
      "exclude-operation": { type: "string", multiple: true },
      int64: { type: "string" },
      nullable: { type: "string" },
      barrel: { type: "boolean" },
      "no-barrel": { type: "boolean" },
      "no-enum": { type: "boolean" },
    },
  });
  if (values.help) console.log(help);
  else if (values.version)
    console.log(
      JSON.parse(
        await readFile(new URL("../../package.json", import.meta.url), "utf8"),
      ).version,
    );
  else {
    const command = ["generate", "diagnose"].includes(positionals[0] ?? "")
      ? positionals.shift()!
      : "generate";
    if (positionals.length > 1) throw new Error(help);
    if (values.barrel && values["no-barrel"])
      throw new Error("INVALID_CONFIG: conflicting barrel options");
    const headerEntries = (values.header ?? []).map((entry) => {
      const index = entry.indexOf("=");
      if (index < 1)
        throw new Error("INVALID_CONFIG: header must be key=value");
      return { [entry.slice(0, index)]: entry.slice(index + 1) };
    });
    const cli: GeneratorConfig = {
      ...(positionals[0] ? { input: positionals[0] } : {}),
      ...(values.output ? { output: resolve(values.output) } : {}),
      ...(values.header
        ? { source: { headers: mergeHeaders(...headerEntries) } }
        : {}),
      ...(values["ignored-header"]
        ? { ignoredHeaders: values["ignored-header"] }
        : {}),
      ...(values["include-operation"]
        ? { includeOperations: values["include-operation"] }
        : {}),
      ...(values["exclude-operation"]
        ? { excludeOperations: values["exclude-operation"] }
        : {}),
      ...(values.int64 || values.nullable
        ? {
            types: {
              ...(values.int64 ? { int64: values.int64 as "number" } : {}),
              ...(values.nullable
                ? { nullable: values.nullable as "ignore" }
                : {}),
            },
          }
        : {}),
      ...(values.barrel || values["no-barrel"]
        ? { barrel: { enabled: !!values.barrel } }
        : {}),
      ...(values["no-enum"] ? { enum: { enabled: false } } : {}),
    };
    const { config } = await resolveConfig(process.cwd(), cli, values.config);
    if (!config.input) throw new Error(help);
    const doc = normalizeSpec(
      parseSpec(await loadSource(config.input, config.source?.headers)),
    );
    if (command === "diagnose") {
      const report = diagnose(doc);
      console.log(JSON.stringify(report, null, 2));
      if (report.diagnostics.some((d) => d.severity === "error"))
        process.exitCode = 1;
    } else {
      const output = resolve(config.output!);
      const result = await generate(doc, config, projectFormatter(output));
      if (values.plan)
        console.log(
          JSON.stringify(
            { ...result, files: selectFiles(result, values.module) },
            null,
            2,
          ),
        );
      else {
        const written = await writeOutput(
          output,
          selectFiles(result, values.module),
          {
            dryRun: values["dry-run"],
            module: values.module,
            fullFiles: result.files,
          },
        );
        console.log(
          JSON.stringify(
            {
              version: doc.version,
              stats: result.plan.stats,
              enums: {
                generated: result.enums.generated,
                skipped: result.enums.skipped,
              },
              diagnostics: result.plan.diagnostics,
              dryRun: !!values["dry-run"],
              ...written,
            },
            null,
            2,
          ),
        );
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
