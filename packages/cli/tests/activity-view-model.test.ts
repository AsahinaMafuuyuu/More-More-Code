import { describe, expect, test } from "bun:test";
import type { AgentActivityView } from "../src/lib/agent-activity-projection";
import {
  createActivityRows,
  formatActivityHeader,
} from "../src/lib/activity-view-model";

function activityFixture(): AgentActivityView {
  return {
    runId: "run-1",
    status: "running",
    startedAt: 100,
    elapsedMs: 2_000,
    activeStepId: "step-bash",
    turns: [{
      id: "turn-1",
      index: 0,
      cause: "initial",
      status: "completed",
      startedAt: 100,
      endedAt: 1_100,
      elapsedMs: 1_000,
      active: false,
      steps: [{
        id: "step-model",
        index: 0,
        kind: "model",
        label: "Model",
        status: "completed",
        startedAt: 100,
        endedAt: 600,
        elapsedMs: 500,
        active: false,
      }, {
        id: "step-read",
        index: 1,
        kind: "tool",
        label: "Read File",
        status: "completed",
        startedAt: 600,
        endedAt: 1_100,
        elapsedMs: 500,
        active: false,
        toolCallId: "call-read",
        toolName: "readFile",
      }],
    }, {
      id: "turn-2",
      index: 1,
      cause: "tool-continuation",
      status: "running",
      startedAt: 1_100,
      elapsedMs: 900,
      active: true,
      steps: [{
        id: "step-bash",
        index: 0,
        kind: "tool",
        label: "Bash",
        status: "running",
        startedAt: 1_200,
        elapsedMs: 800,
        active: true,
        toolCallId: "call-bash",
        toolName: "bash",
        progress: {
          message: "compiling workspace",
          completed: 2,
          total: 5,
        },
      }],
    }],
  };
}

describe("Activity view model", () => {
  test("keeps earlier completed Turns compact and expands the active/latest Turn", () => {
    const activity = activityFixture();

    expect(formatActivityHeader(activity, 80)).toBe("Agent Activity · running · 2.0s");
    expect(createActivityRows(activity, { width: 80 })).toEqual([{
      key: "turn:turn-1",
      kind: "turn",
      turnId: "turn-1",
      status: "completed",
      expandable: true,
      expanded: false,
      text: "Turn 1 · initial · completed · 2 steps · 1.0s",
    }, {
      key: "turn:turn-2",
      kind: "turn",
      turnId: "turn-2",
      status: "running",
      expandable: true,
      expanded: true,
      text: "Turn 2 · tool continuation · running · 1 step · 0.9s",
    }, {
      key: "step:step-bash",
      kind: "step",
      turnId: "turn-2",
      status: "running",
      active: true,
      text: "● Bash · running · 0.8s · compiling workspace 2/5",
    }]);
  });

  test("drops secondary metadata before primary label and status on narrow terminals", () => {
    const activity = activityFixture();

    expect(formatActivityHeader(activity, 60)).toBe("Activity · running");
    expect(createActivityRows(activity, { width: 60 }).map((row) => row.text)).toEqual([
      "Turn 1 · completed",
      "Turn 2 · running",
      "● Bash · running",
    ]);
  });

  test("manual disclosure expands an older Turn without changing projection semantics", () => {
    const rows = createActivityRows(activityFixture(), {
      width: 120,
      turnExpansion: { "turn-1": true },
    });

    expect(rows.filter((row) => row.turnId === "turn-1").map((row) => row.text)).toEqual([
      "Turn 1 · initial · completed · 2 steps · 1.0s",
      "✓ Model · completed · 0.5s",
      "✓ Read File · completed · 0.5s",
    ]);
  });
});
