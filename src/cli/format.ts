import { resolve } from "node:path";
import { resolveConfig, format } from "prettier";
export const projectFormatter =
  (output: string) =>
  async (path: string, source: string): Promise<string> => {
    const filepath = resolve(output, path);
    const options = await resolveConfig(filepath, {
      editorconfig: true,
      useCache: false,
    });
    return format(source, {
      endOfLine: "lf",
      ...options,
      filepath,
      parser: "typescript",
    });
  };
