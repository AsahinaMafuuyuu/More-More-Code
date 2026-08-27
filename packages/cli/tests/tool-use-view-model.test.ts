import { describe, expect, test } from "bun:test";
import type { ToolUseView } from "../src/lib/tool-use-projection";
import {
  createToolUseDisplay,
  formatToolUseStatus,
} from "../src/lib/tool-use-view-model";

describe("ToolUse view model", () => {
  test("collapsed presentation keeps Tool identity, concise input, status and duration", () => {
    const view: ToolUseView = {
      toolCallId: "call-1",
      toolName: "bash",
      status: "completed",
      input: { command: "bun test packages/cli" },
      output: "191 pass",
      source: "native",
      durationMs: 2_400,
    };

    expect(createToolUseDisplay(view, 80).collapsed).toBe(
      "Bash · bun test packages/cli · completed · 2.4s",
    );
  });

  test.each([
    ["requested", "requested"],
    ["running", "running"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["timed_out", "timed out"],
    ["denied", "denied"],
    ["approval_waiting", "approval waiting"],
    ["incomplete", "incomplete"],
  ] as const)("formats %s with explicit status text", (status, expected) => {
    expect(formatToolUseStatus(status).label).toBe(expected);
    expect(formatToolUseStatus(status).glyph.length).toBeGreaterThan(0);
  });

  test("expanded details are bounded and unserializable values fail soft", () => {
    const cyclic: Record<string, unknown> = { command: "run" };
    cyclic.self = cyclic;
    const display = createToolUseDisplay({
      toolCallId: "call-cycle",
      toolName: "customTool",
      status: "failed",
      input: cyclic,
      error: `failure ${"x".repeat(900)}`,
      diagnostic: "integrity_error",
    }, 120);

    expect(display.collapsed).toContain("Custom Tool");
    expect(display.collapsed).toContain("failed");
    expect(display.detailLines[0]).toBe("input  [detail unavailable]");
    expect(display.detailLines.some((line) => line.includes("integrity check failed"))).toBe(true);
    expect(display.detailLines.every((line) => line.length <= 500)).toBe(true);
  });

  test("narrow rows preserve status while shortening input detail", () => {
    const display = createToolUseDisplay({
      toolCallId: "call-long",
      toolName: "readFile",
      status: "denied",
      input: { path: `src/${"nested/".repeat(20)}file.ts` },
    }, 55);

    expect(display.collapsed).toContain("Read File");
    expect(display.collapsed).toContain("denied");
    expect(display.collapsed.length).toBeLessThanOrEqual(55);
  });
});
