import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveTuiRenderProfileFromEnvironment } from "../src/tui/render-profile";
import { createTuiStabilityProbe } from "../src/tui/stability-probe";

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"));
}

describe("TUI stability profile selection", () => {
  test("defaults to normal, accepts safe and fails closed for unknown values", () => {
    expect(resolveTuiRenderProfileFromEnvironment({}).name).toBe("normal");
    expect(resolveTuiRenderProfileFromEnvironment({ MORE_MORE_CODE_TUI_PROFILE: "safe" })).toMatchObject({
      name: "safe",
      targetFps: 15,
      maxFps: 15,
      projectionCommitHz: 10,
      activityElapsedMs: null,
    });
    expect(() => resolveTuiRenderProfileFromEnvironment({
      MORE_MORE_CODE_TUI_PROFILE: "turbo",
    })).toThrow(/TUI render profile/i);
  });

  test("root and CLI package scripts keep watch mode opt-in", () => {
    const root = readJson("../../../package.json");
    const cli = readJson("../package.json");

    expect(root.scripts["dev:cli"]).not.toContain("--watch");
    expect(root.scripts["dev:cli:watch"]).toContain("--watch");
    expect(cli.scripts.dev).not.toContain("--watch");
    expect(cli.scripts["dev:watch"]).toContain("--watch");
  });

  test("selected stability profile is explicit in diagnostics", () => {
    const profile = resolveTuiRenderProfileFromEnvironment({
      MORE_MORE_CODE_TUI_PROFILE: "safe",
    });
    const probe = createTuiStabilityProbe({
      enabled: true,
      bunVersion: "1.4.0",
      opentuiVersion: "0.5.9",
      profile: profile.name,
      startedAtMs: 0,
      now: () => 1,
      readMemory: () => ({ rssBytes: 0, heapUsedBytes: 0 }),
    });

    expect(probe.snapshot({ terminalWidth: 80, terminalHeight: 24 })?.profile).toBe("safe");
  });
});
