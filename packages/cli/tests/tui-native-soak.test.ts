import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_NATIVE_STRESS_MATRIX,
  parseTuiSoakOptions,
  resolveTuiSoakPressure,
} from "../src/dev/tui-soak-options";

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("native TUI soak harness", () => {
  test("parses deterministic workload, duration and renderer profile", () => {
    expect(parseTuiSoakOptions([
      "--workload", "stream",
      "--duration", "900",
      "--render-profile", "safe",
    ])).toEqual({
      workload: "stream",
      durationSeconds: 900,
      renderProfile: "safe",
    });
    expect(parseTuiSoakOptions(["--workload", "idle", "--duration", "600"]).renderProfile).toBe("normal");
    expect(() => parseTuiSoakOptions(["--workload", "unknown", "--duration", "10"])).toThrow(/workload/i);
    expect(() => parseTuiSoakOptions(["--workload", "churn", "--duration", "0"])).toThrow(/duration/i);
  });

  test("root script invokes a real native-renderer soak entrypoint", () => {
    const rootManifest = JSON.parse(read("../../../package.json")) as {
      scripts?: Record<string, string>;
    };
    const bootstrapSource = read("../src/dev/tui-stability-soak.tsx");
    const appSource = read("../src/dev/tui-stability-soak-app.tsx");
    const stressSuiteSource = read("../src/dev/tui-stability-stress-suite.ts");

    expect(rootManifest.scripts?.["tui:soak"]).toContain("tui-stability-soak.tsx");
    expect(rootManifest.scripts?.["tui:stress"]).toContain("tui-stability-stress-suite.ts");
    expect(bootstrapSource).toContain("assertSupportedBunRuntime");
    expect(bootstrapSource).toContain('await import("./tui-stability-soak-app")');
    expect(bootstrapSource).not.toMatch(/@opentui\/(?:core|react)/);
    expect(appSource).toContain("createCliRenderer");
    expect(appSource).toContain("MORE_MORE_CODE_TUI_SOAK_BUFFERED_OUTPUT");
    expect(appSource).toMatch(/bufferedOutput[\s\S]*?"memory"[\s\S]*?"stdout"/);
    expect(appSource).toMatch(/createCliRenderer\([\s\S]*?bufferedOutput/);
    expect(appSource).toContain("SessionWorkspace");
    expect(appSource).toContain("createSessionUiCommitScheduler");
    expect(appSource).not.toContain("testRender");
    expect(appSource).not.toMatch(/LocalModelTransport|createProvider|executeLocalTool|ToolRuntime/);
    expect(stressSuiteSource).toContain("DEFAULT_NATIVE_STRESS_MATRIX");
  });

  test("release matrix prioritizes short high-volume pressure over long wall-clock soak", () => {
    expect(DEFAULT_NATIVE_STRESS_MATRIX).toEqual([
      { workload: "idle", durationSeconds: 20 },
      { workload: "stream", durationSeconds: 45 },
      { workload: "churn", durationSeconds: 45 },
    ]);

    expect(resolveTuiSoakPressure("idle")).toMatchObject({
      sourceIntervalMs: null,
      minSourceUpdatesPerSecond: 0,
    });
    expect(resolveTuiSoakPressure("stream")).toMatchObject({
      sourceIntervalMs: 1,
      minSourceUpdatesPerSecond: 100,
      minCoalescingRatio: 0.8,
    });
    expect(resolveTuiSoakPressure("churn")).toMatchObject({
      sourceIntervalMs: 2,
      immediateIntervalMs: 25,
      scrollIntervalMs: 10,
      dialogIntervalMs: 40,
      minSourceUpdatesPerSecond: 100,
      minCoalescingRatio: 0.75,
    });
  });

  test("churn exercises production conversation scrolling and dialog lifecycle", () => {
    const source = read("../src/dev/tui-stability-soak-app.tsx");

    expect(source).toContain("KeyboardLayerProvider");
    expect(source).toContain("DialogProvider");
    expect(source).toContain("conversationScrollRef");
    expect(source).toContain("scrollTo(");
    expect(source).toContain("useDialog");
    expect(source).toContain("dialog.open");
    expect(source).toContain("dialog.close");
    expect(source).toContain("stressVolumeCorrect");
    expect(source).toContain("interactionPressureCorrect");
  });
});
