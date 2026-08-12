import { describe, expect, test } from "bun:test";
import {
  AgentLoop,
  type AgentToolCall,
} from "../src";

function createDeterministicLoop(maxSteps = 64) {
  let id = 0;
  let now = 1000;

  return new AgentLoop({
    maxSteps,
    createId: () => `id-${++id}`,
    now: () => ++now,
  });
}

describe("AgentLoop", () => {
  test("creates a completed run, turn, and model step", async () => {
    const loop = createDeterministicLoop();
    const continuations: boolean[] = [];

    const run = await loop.run({
      sessionId: "session-1",
      inputMessageId: "message-1",
      adapter: {
        async runModelStep(context) {
          continuations.push(context.continuation);
          return { toolCalls: [] };
        },
        async runToolStep() {
          throw new Error("tool step should not run");
        },
      },
    });

    expect(run.status).toBe("completed");
    expect(run.sessionId).toBe("session-1");
    expect(run.turns).toHaveLength(1);
    expect(run.turns[0]?.status).toBe("completed");
    expect(run.turns[0]?.inputMessageId).toBe("message-1");
    expect(run.turns[0]?.steps.map((step) => step.kind)).toEqual(["model"]);
    expect(run.turns[0]?.steps[0]?.status).toBe("completed");
    expect(continuations).toEqual([false]);
  });

  test("loops from model steps through tool steps and back to the model", async () => {
    const loop = createDeterministicLoop();
    const modelContinuations: boolean[] = [];
    const executedTools: string[] = [];
    let modelInvocation = 0;

    const run = await loop.run({
      sessionId: "session-2",
      adapter: {
        async runModelStep(context) {
          modelContinuations.push(context.continuation);
          modelInvocation += 1;

          if (modelInvocation === 1) {
            return {
              toolCalls: [
                {
                  toolCallId: "call-1",
                  toolName: "readFile",
                  input: { path: "README.md" },
                },
                {
                  toolCallId: "call-2",
                  toolName: "grep",
                  input: { pattern: "AgentLoop", path: "." },
                },
              ],
            };
          }

          return { toolCalls: [] };
        },
        async runToolStep(toolCall) {
          executedTools.push(toolCall.toolName);
        },
      },
    });

    expect(run.status).toBe("completed");
    expect(modelContinuations).toEqual([false, true]);
    expect(executedTools).toEqual(["readFile", "grep"]);
    expect(run.turns[0]?.steps.map((step) => step.kind)).toEqual([
      "model",
      "tool",
      "tool",
      "model",
    ]);

    const toolSteps = run.turns[0]?.steps.filter((step) => step.kind === "tool") ?? [];
    expect(toolSteps.map((step) => step.toolCallId)).toEqual(["call-1", "call-2"]);
    expect(toolSteps.every((step) => step.status === "completed")).toBe(true);
  });

  test("marks the active model step, turn, and run as interrupted", async () => {
    const loop = createDeterministicLoop();
    let abortCalled = false;

    const run = await loop.run({
      sessionId: "session-3",
      adapter: {
        async runModelStep() {
          loop.interrupt();
          throw new Error("request aborted");
        },
        async runToolStep() {},
        abortModelStep() {
          abortCalled = true;
        },
      },
    });

    expect(abortCalled).toBe(true);
    expect(run.status).toBe("interrupted");
    expect(run.turns[0]?.status).toBe("interrupted");
    expect(run.turns[0]?.steps[0]?.status).toBe("interrupted");
  });

  test("marks a run as failed when a tool-step integration fails", async () => {
    const loop = createDeterministicLoop();
    const toolCall: AgentToolCall = {
      toolCallId: "call-fail",
      toolName: "readFile",
      input: { path: "missing.txt" },
    };

    const run = await loop.run({
      sessionId: "session-4",
      adapter: {
        async runModelStep() {
          return { toolCalls: [toolCall] };
        },
        async runToolStep() {
          throw new Error("tool adapter failed");
        },
      },
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe("tool adapter failed");
    expect(run.turns[0]?.status).toBe("failed");
    expect(run.turns[0]?.steps.at(-1)?.status).toBe("failed");
  });

  test("fails a runaway loop when the step budget is exhausted", async () => {
    const loop = createDeterministicLoop(2);

    const run = await loop.run({
      sessionId: "session-5",
      adapter: {
        async runModelStep() {
          return {
            toolCalls: [
              {
                toolCallId: "call-loop",
                toolName: "readFile",
                input: {},
              },
            ],
          };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("maximum of 2 steps");
    expect(run.turns[0]?.steps).toHaveLength(2);
  });
});
