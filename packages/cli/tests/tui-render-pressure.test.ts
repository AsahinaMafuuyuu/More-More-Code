import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TUI render pressure policy", () => {
  test("normal runtime has no autonomous spinner dependency or live render loop", () => {
    const manifest = JSON.parse(read("../package.json")) as {
      dependencies?: Record<string, string>;
    };
    const busySource = read("../src/components/busy-indicator.tsx");

    expect(manifest.dependencies?.["opentui-spinner"]).toBeUndefined();
    expect(busySource).not.toMatch(/setInterval|setTimeout|requestRender|requestLive|dropLive/);
    expect(busySource).not.toContain("opentui-spinner");
  });

  test("production renderer uses the normal 30 FPS target and hard cap without start()", () => {
    const source = read("../src/app-entry.tsx");
    expect(source).toContain('resolveTuiRenderProfile("normal")');
    expect(source).toContain("targetFps: renderProfile.targetFps");
    expect(source).toContain("maxFps: renderProfile.maxFps");
    expect(source).not.toMatch(/renderer\.start\s*\(/);
  });

  test("SessionRuntimeBridge routes presentation through the commit scheduler", () => {
    const source = read("../src/ui/session/runtime/session-runtime-bridge.tsx");
    expect(source).toContain("createSessionUiCommitScheduler");
    expect(source).toContain("commitScheduler.enqueuePresentation");
    expect(source).toContain("commitScheduler.commitImmediate");
    expect(source).not.toMatch(/\bstore\.update\s*\(/);
  });
});
