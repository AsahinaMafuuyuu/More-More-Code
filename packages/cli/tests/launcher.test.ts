import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

describe("CLI launcher", () => {
  test("ends at the application import without trailing executable garbage", async () => {
    const source = await readFile(
      new URL("../bin/more-more-code", import.meta.url),
      "utf8",
    );
    const executableLines = source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(executableLines.at(-1)).toBe('await import("../src/index.tsx");');
  });
});
