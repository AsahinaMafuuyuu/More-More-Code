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
    expect(run.turns).toHaveLength(2);
    expect(run.turns.map((turn) => turn.cause)).toEqual([
      "initial",
      "tool-continuation",
    ]);
    expect(run.turns[0]?.steps.map((step) => step.kind)).toEqual([
      "model",
      "tool",
      "tool",
    ]);
    expect(run.turns[1]?.steps.map((step) => step.kind)).toEqual(["model"]);

    const toolSteps = run.turns[0]?.steps.filter((step) => step.kind === "tool") ?? [];
    expect(toolSteps.map((step) => step.toolCallId)).toEqual(["call-1", "call-2"]);
    expect(toolSteps.every((step) => step.status === "completed")).toBe(true);
    expect(loop.getExecutionEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "turn.started",
      "step.started",
      "step.completed",
      "step.started",
      "step.completed",
      "step.started",
      "step.completed",
      "turn.completed",
      "turn.started",
      "step.started",
      "step.completed",
      "turn.completed",
      "run.completed",
    ]);
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
    expect(loop.getExecutionEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "turn.started",
      "step.started",
      "step.interrupted",
      "turn.interrupted",
      "run.interrupted",
    ]);
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
    expect(loop.getExecutionEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "turn.started",
      "step.started",
      "step.completed",
      "step.started",
      "step.failed",
      "turn.failed",
      "run.failed",
    ]);
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
    expect(run.error).toContain("safety ceiling of 2 execution steps");
    expect(run.turns[0]?.steps).toHaveLength(2);
  });

  test("default production budgets allow a legitimate interaction to exceed 64 total steps", async () => {
    let id = 0;
    let modelInvocation = 0;
    const loop = new AgentLoop({ createId: () => `long-${++id}` });

    const run = await loop.run({
      sessionId: "session-long",
      adapter: {
        async runModelStep() {
          modelInvocation += 1;
          return modelInvocation <= 70
            ? {
                toolCalls: [{
                  toolCallId: `call-${modelInvocation}`,
                  toolName: "readFile",
                  input: { path: `file-${modelInvocation}.ts` },
                }],
              }
            : { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("completed");
    expect(run.turns).toHaveLength(71);
    expect(run.turns.flatMap((turn) => turn.steps)).toHaveLength(141);
  });

  test("Tool calls have an independent runaway budget", async () => {
    let id = 0;
    const loop = new AgentLoop({
      maxSteps: 100,
      maxModelSteps: 10,
      maxToolSteps: 2,
      maxTurns: 10,
      createId: () => `tool-budget-${++id}`,
    });

    const run = await loop.run({
      sessionId: "session-tool-budget",
      adapter: {
        async runModelStep() {
          return {
            toolCalls: ["a", "b", "c"].map((name) => ({
              toolCallId: `call-${name}`,
              toolName: "readFile",
              input: { path: `${name}.ts` },
            })),
          };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("maximum of 2 tool calls");
    expect(run.turns[0]?.steps.filter((step) => step.kind === "tool")).toHaveLength(0);
  });

  test("ToolUse does not consume the primary Model Loop budget", async () => {
    let id = 0;
    let modelCalls = 0;
    let toolCalls = 0;
    const loop = new AgentLoop({
      maxExecutionSteps: 32,
      maxModelLoops: 1,
      maxToolCalls: 16,
      maxTurns: 8,
      createId: () => `model-loop-budget-${++id}`,
    });

    const run = await loop.run({
      sessionId: "session-model-loop-budget",
      adapter: {
        async runModelStep() {
          modelCalls += 1;
          return {
            toolCalls: ["a", "b", "c", "d"].map((name) => ({
              toolCallId: `call-${name}`,
              toolName: "readFile",
              input: { path: `${name}.ts` },
            })),
          };
        },
        async runToolStep() {
          toolCalls += 1;
        },
      },
    });

    expect(modelCalls).toBe(1);
    expect(toolCalls).toBe(4);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("maximum of 1 model loops");
  });

  test("parallel Tool batches are bounded and preserve model-order terminal events", async () => {
    let id = 0;
    let modelInvocation = 0;
    let active = 0;
    let maxActive = 0;
    const executionOrder: string[] = [];
    const completionOrder: string[] = [];
    const loop = new AgentLoop({ createId: () => `parallel-${++id}` });

    const delays = new Map([
      ["call-a", 20],
      ["call-b", 5],
      ["call-c", 1],
    ]);
    const run = await loop.run({
      sessionId: "session-parallel-batch",
      toolExecution: { mode: "parallel", maxConcurrency: 2 },
      adapter: {
        async runModelStep() {
          modelInvocation += 1;
          if (modelInvocation > 1) return { toolCalls: [] };
          return {
            toolCalls: ["a", "b", "c"].map((name) => ({
              toolCallId: `call-${name}`,
              toolName: "readFile",
              input: {},
            })),
          };
        },
        getToolExecutionSafety() {
          return { parallelSafe: true, effect: "read" };
        },
        async runToolStep(toolCall) {
          executionOrder.push(toolCall.toolCallId);
          active += 1;
          maxActive = Math.max(maxActive, active);
          await Bun.sleep(delays.get(toolCall.toolCallId) ?? 0);
          completionOrder.push(toolCall.toolCallId);
          active -= 1;
        },
      },
    });

    expect(run.status).toBe("completed");
    expect(maxActive).toBe(2);
    expect(executionOrder).toEqual(["call-a", "call-b", "call-c"]);
    expect(completionOrder).toEqual(["call-b", "call-a", "call-c"]);
    const firstTurnToolSteps = run.turns[0]?.steps.filter((step) => step.kind === "tool") ?? [];
    expect(firstTurnToolSteps.map((step) => step.toolCallId)).toEqual([
      "call-a",
      "call-b",
      "call-c",
    ]);
    expect(firstTurnToolSteps.every((step) => step.status === "completed")).toBe(true);
  });

  test("unsafe Tools stay serialized between parallel-safe waves", async () => {
    let id = 0;
    let modelInvocation = 0;
    let active = 0;
    const observations: string[] = [];
    const loop = new AgentLoop({ createId: () => `wave-${++id}` });

    const run = await loop.run({
      sessionId: "session-wave-barrier",
      toolExecution: { mode: "parallel", maxConcurrency: 4 },
      adapter: {
        async runModelStep() {
          modelInvocation += 1;
          if (modelInvocation > 1) return { toolCalls: [] };
          return {
            toolCalls: [
              { toolCallId: "read-a", toolName: "readFile", input: {} },
              { toolCallId: "read-b", toolName: "grep", input: {} },
              { toolCallId: "shell", toolName: "bash", input: {} },
              { toolCallId: "read-c", toolName: "readFile", input: {} },
            ],
          };
        },
        getToolExecutionSafety(toolCall) {
          return toolCall.toolName === "bash"
            ? { parallelSafe: false, effect: "process" }
            : { parallelSafe: true, effect: "read" };
        },
        async runToolStep(toolCall) {
          active += 1;
          observations.push(`start:${toolCall.toolCallId}:active=${active}`);
          await Bun.sleep(toolCall.toolName === "bash" ? 2 : 5);
          observations.push(`end:${toolCall.toolCallId}:active=${active}`);
          active -= 1;
        },
      },
    });

    expect(run.status).toBe("completed");
    const shellStart = observations.find((value) => value.startsWith("start:shell"));
    expect(shellStart).toBe("start:shell:active=1");
    const readCStartIndex = observations.findIndex((value) => value.startsWith("start:read-c"));
    const shellEndIndex = observations.findIndex((value) => value.startsWith("end:shell"));
    expect(readCStartIndex).toBeGreaterThan(shellEndIndex);
  });

  test("Tool adapter failure settles its wave and prevents later waves from starting", async () => {
    let id = 0;
    const executed: string[] = [];
    const loop = new AgentLoop({ createId: () => `fail-closed-${++id}` });

    const run = await loop.run({
      sessionId: "session-fail-closed-wave",
      toolExecution: { mode: "parallel", maxConcurrency: 2 },
      adapter: {
        async runModelStep() {
          return {
            toolCalls: [
              { toolCallId: "read-a", toolName: "readFile", input: {} },
              { toolCallId: "read-b", toolName: "grep", input: {} },
              { toolCallId: "shell", toolName: "bash", input: {} },
              { toolCallId: "read-c", toolName: "readFile", input: {} },
            ],
          };
        },
        getToolExecutionSafety(toolCall) {
          return toolCall.toolName === "bash"
            ? { parallelSafe: false, effect: "process" }
            : { parallelSafe: true, effect: "read" };
        },
        async runToolStep(toolCall) {
          executed.push(toolCall.toolCallId);
          if (toolCall.toolCallId === "read-b") throw new Error("durability failed");
        },
      },
    });

    expect(run.status).toBe("failed");
    expect(executed).toEqual(["read-a", "read-b"]);
    expect(run.turns[0]?.steps.filter((step) => step.kind === "tool").map((step) => ({
      id: step.toolCallId,
      status: step.status,
    }))).toEqual([
      { id: "read-a", status: "completed" },
      { id: "read-b", status: "failed" },
    ]);
  });
});
