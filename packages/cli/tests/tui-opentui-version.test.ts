import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("OpenTUI renderer baseline", () => {
  test("core and react are exact-pinned to the validated 0.5.9 pair", () => {
    const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.["@opentui/core"]).toBe("0.5.9");
    expect(manifest.dependencies?.["@opentui/react"]).toBe("0.5.9");
  });
});
