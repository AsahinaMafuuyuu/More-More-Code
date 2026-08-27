import { describe, expect, test } from "bun:test";
import type { AgentLifecycleEvent, AgentRun } from "@more-more-code/harness";
import {
  projectAgentActivity,
  reduceAgentActivityProgress,
} from "../src/lib/agent-activity-projection";

function runningInitialModelRun(): AgentRun {
  return {
    id: "run-1",
    sessionId: "session-1",
    status: "running",
    startedAt: 100,
    turns: [{
      id: "turn-1",
      runId: "run-1",
      index: 0,
      cause: "initial",
      status: "running",
      startedAt: 110,
      steps: [{
        id: "step-model-1",
        runId: "run-1",
        turnId: "turn-1",
        index: 0,
        kind: "model",
        status: "running",
        startedAt: 120,
      }],
    }],
  };
}

describe("Agent Activity projection", () => {
  test("projects an initial running model step without exposing raw Harness objects", () => {
    expect(projectAgentActivity(runningInitialModelRun(), { now: 200 })).toEqual({
      runId: "run-1",
      status: "running",
      startedAt: 100,
      elapsedMs: 100,
      activeStepId: "step-model-1",
      turns: [{
        id: "turn-1",
        index: 0,
        cause: "initial",
        status: "running",
        startedAt: 110,
        elapsedMs: 90,
        active: true,
        steps: [{
          id: "step-model-1",
          index: 0,
          kind: "model",
          label: "Model",
          status: "running",
          startedAt: 120,
          elapsedMs: 80,
          active: true,
        }],
      }],
    });
  });

  test("retains exact Turn causes, terminal lifecycle, and Tool identity", () => {
    const run: AgentRun = {
      id: "run-terminal",
      sessionId: "session-1",
      status: "failed",
      startedAt: 100,
      endedAt: 500,
      turns: [{
        id: "turn-continuation",
        runId: "run-terminal",
        index: 0,
        cause: "tool-continuation",
        status: "completed",
        startedAt: 150,
        endedAt: 250,
        steps: [{
          id: "step-model-completed",
          runId: "run-terminal",
          turnId: "turn-continuation",
          index: 0,
          kind: "model",
          status: "completed",
          startedAt: 155,
          endedAt: 200,
        }, {
          id: "step-tool-failed",
          runId: "run-terminal",
          turnId: "turn-continuation",
          index: 1,
          kind: "tool",
          toolCallId: "call-read",
          toolName: "readFile",
          status: "failed",
          startedAt: 205,
          endedAt: 240,
          error: "not found",
        }],
      }, {
        id: "turn-steering",
        runId: "run-terminal",
        index: 1,
        cause: "steering",
        status: "interrupted",
        startedAt: 260,
        endedAt: 300,
        steps: [{
          id: "step-model-interrupted",
          runId: "run-terminal",
          turnId: "turn-steering",
          index: 0,
          kind: "model",
          status: "interrupted",
          startedAt: 265,
          endedAt: 290,
        }],
      }, {
        id: "turn-follow-up",
        runId: "run-terminal",
        index: 2,
        cause: "follow-up",
        status: "failed",
        startedAt: 310,
        endedAt: 400,
        steps: [{
          id: "step-model-failed",
          runId: "run-terminal",
          turnId: "turn-follow-up",
          index: 0,
          kind: "model",
          status: "failed",
          startedAt: 320,
          endedAt: 390,
        }],
      }],
    };

    const activity = projectAgentActivity(run, { now: 9_999 });

    expect(activity).toMatchObject({
      status: "failed",
      elapsedMs: 400,
      turns: [{
        cause: "tool-continuation",
        status: "completed",
        elapsedMs: 100,
        steps: [{ kind: "model", status: "completed", elapsedMs: 45 }, {
          kind: "tool",
          label: "Read File",
          toolCallId: "call-read",
          toolName: "readFile",
          status: "failed",
          elapsedMs: 35,
        }],
      }, {
        cause: "steering",
        status: "interrupted",
        steps: [{ status: "interrupted", elapsedMs: 25 }],
      }, {
        cause: "follow-up",
        status: "failed",
        steps: [{ status: "failed", elapsedMs: 70 }],
      }],
    });
  });

  test("normalizes and bounds only renderable step progress", () => {
    const run = runningInitialModelRun();
    const longMessage = `  compiling\n${"x".repeat(160)}  `;

    const activity = projectAgentActivity(run, {
      now: 200,
      progressByStep: {
        "step-model-1": {
          message: longMessage,
          completed: 2,
          total: 5,
          details: { rawProviderPayload: "must not reach React" },
        },
      },
    });

    expect(activity?.turns[0]?.steps[0]?.progress).toEqual({
      message: `compiling ${"x".repeat(109)}…`,
      completed: 2,
      total: 5,
    });
  });

  test("keeps step_update progress ephemeral and clears it on the next Run", () => {
    const run = runningInitialModelRun();
    const step = run.turns[0]!.steps[0]!;
    const turn = run.turns[0]!;
    const updateEvent: AgentLifecycleEvent = {
      type: "step_update",
      run,
      turn,
      step,
      update: {
        message: "indexing",
        completed: 1,
        total: 3,
        details: { internal: true },
      },
    };

    const progressed = reduceAgentActivityProgress({}, updateEvent);
    expect(progressed).toEqual({
      "step-model-1": {
        message: "indexing",
        completed: 1,
        total: 3,
      },
    });

    expect(reduceAgentActivityProgress(progressed, {
      type: "run_start",
      run: { ...run, id: "run-2" },
    })).toEqual({});
  });

});
