import { readFile } from "node:fs/promises";

export const loadSource = async (
  input: string,
  headers?: Record<string, string>,
): Promise<string> => {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP_ERROR: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    throw new Error(
      "UNSUPPORTED_SOURCE: only local files and HTTP(S) are supported",
    );
  }
  return readFile(input, "utf8");
};
