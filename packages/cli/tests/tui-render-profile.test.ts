import { describe, expect, test } from "bun:test";
import { resolveTuiRenderProfile } from "../src/tui/render-profile";

describe("TUI render profiles", () => {
  test("normal profile enforces the release render budget", () => {
    expect(resolveTuiRenderProfile("normal")).toEqual({
      name: "normal",
      targetFps: 30,
      maxFps: 30,
      projectionCommitHz: 20,
      activityElapsedMs: 1000,
      animateBusyIndicator: false,
    });
  });

  test("safe profile materially reduces presentation pressure", () => {
    expect(resolveTuiRenderProfile("safe")).toEqual({
      name: "safe",
      targetFps: 15,
      maxFps: 15,
      projectionCommitHz: 10,
      activityElapsedMs: null,
      animateBusyIndicator: false,
    });
  });

  test("unknown profile fails closed", () => {
    expect(() => resolveTuiRenderProfile("turbo")).toThrow(/TUI render profile/i);
  });
});
