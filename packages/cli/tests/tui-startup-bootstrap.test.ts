import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("TUI startup bootstrap", () => {
  test("checks Bun compatibility before dynamically loading the OpenTUI application", () => {
    const indexPath = fileURLToPath(new URL("../src/index.tsx", import.meta.url));
    const source = readFileSync(indexPath, "utf8");

    expect(source).not.toContain('from "@opentui/');
    expect(source).not.toContain("from '@opentui/");

    const guardIndex = source.indexOf("assertSupportedBunRuntime(");
    const appImportIndex = source.indexOf('import("./app-entry")');
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(appImportIndex).toBeGreaterThan(guardIndex);
  });
});
