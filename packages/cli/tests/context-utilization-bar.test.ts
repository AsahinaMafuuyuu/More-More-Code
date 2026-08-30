import { describe, expect, test } from "bun:test";
import { formatContextUtilizationBar } from "../src/ui/session/surfaces/context-utilization-bar";

describe("context utilization bar", () => {
  test("formats a compact eight-cell terminal gauge", () => {
    expect(formatContextUtilizationBar(0.21)).toEqual({
      filled: "██",
      empty: "░░░░░░",
      percent: "21%",
    });
  });

  test("clamps overflow and renders unknown utilization explicitly", () => {
    expect(formatContextUtilizationBar(2).filled).toBe("████████");
    expect(formatContextUtilizationBar(null)).toEqual({
      filled: "",
      empty: "░░░░░░░░",
      percent: "—%",
    });
  });
});
