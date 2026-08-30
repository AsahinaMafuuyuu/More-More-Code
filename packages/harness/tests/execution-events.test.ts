import { describe, expect, test } from "bun:test";
import {
  AgentLoop,
  ExecutionEventStoreError,
  InMemoryExecutionEventStore,
  projectAgentRun,
  projectAgentRuns,
  type ExecutionEvent,
  type ExecutionEventPayload,
} from "../src";

function createEvent(
  sequence: number,
  payload: ExecutionEventPayload,
  overrides: Partial<Pick<ExecutionEvent, "runId" | "sessionId" | "timestamp">> = {},
) {
  return {
    ...payload,
    id: `event-${overrides.runId ?? "run-1"}-${sequence}`,
    sequence,
    timestamp: overrides.timestamp ?? 1000 + sequence,
    sessionId: overrides.sessionId ?? "session-1",
    runId: overrides.runId ?? "run-1",
  } as ExecutionEvent;
}

describe("InMemoryExecutionEventStore", () => {
  test("can be injected as the AgentLoop execution history boundary", async () => {
    const store = new InMemoryExecutionEventStore();
    let id = 0;
    let now = 2000;
    const loop = new AgentLoop({
      eventStore: store,
      createId: () => `injected-${++id}`,
      now: () => ++now,
    });

    const run = await loop.run({
      sessionId: "session-injected",
      adapter: {
        async runModelStep() {
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(store.getRunEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "turn.started",
      "step.started",
      "step.completed",
      "turn.completed",
      "run.completed",
    ]);
    expect(loop.getExecutionEvents(run.id)).toEqual(store.getRunEvents(run.id));
  });

  test("stores append-only per-run execution history and returns copies", () => {
    const store = new InMemoryExecutionEventStore();
    const started = createEvent(0, { type: "run.started" });
    const completed = createEvent(1, { type: "run.completed" });

    store.append(started);
    store.append(completed);

    const events = store.getRunEvents("run-1");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.completed",
    ]);
    expect(events[0]).not.toBe(started);
    expect(store.getEvents()).toHaveLength(2);
  });

  test("rejects duplicate ids, sequence gaps, and writes after a terminal run", () => {
    const store = new InMemoryExecutionEventStore();
    const started = createEvent(0, { type: "run.started" });
    store.append(started);

    expect(() => store.append({ ...started })).toThrow(ExecutionEventStoreError);
    expect(() => store.append(createEvent(2, { type: "run.completed" }))).toThrow(
      "expected 1, received 2",
    );

    store.append(createEvent(1, { type: "run.completed" }));
    expect(() => store.append(createEvent(2, { type: "run.failed", error: "late" }))).toThrow(
      "terminal run event",
    );
  });
});

describe("execution projection", () => {
  test("reconstructs Run, Turn, and Step state from canonical events", () => {
    const events: ExecutionEvent[] = [
      createEvent(0, { type: "run.started" }),
      createEvent(1, {
        type: "turn.started",
        turnId: "turn-1",
        turnIndex: 0,
        cause: "initial",
        inputMessageId: "message-1",
      }),
      createEvent(2, {
        type: "step.started",
        turnId: "turn-1",
        stepId: "step-model",
        stepIndex: 0,
        stepKind: "model",
      }),
      createEvent(3, {
        type: "step.completed",
        turnId: "turn-1",
        stepId: "step-model",
      }),
      createEvent(4, {
        type: "step.started",
        turnId: "turn-1",
        stepId: "step-tool",
        stepIndex: 1,
        stepKind: "tool",
        toolCallId: "call-1",
        toolName: "readFile",
      }),
      createEvent(5, {
        type: "step.failed",
        turnId: "turn-1",
        stepId: "step-tool",
        error: "tool failed",
      }),
      createEvent(6, {
        type: "turn.failed",
        turnId: "turn-1",
        error: "tool failed",
      }),
      createEvent(7, { type: "run.failed", error: "tool failed" }),
    ];

    const run = projectAgentRun(events);

    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("tool failed");
    expect(run?.startedAt).toBe(1000);
    expect(run?.endedAt).toBe(1007);
    expect(run?.turns[0]?.cause).toBe("initial");
    expect(run?.turns[0]?.inputMessageId).toBe("message-1");
    expect(run?.turns[0]?.status).toBe("failed");
    expect(run?.turns[0]?.steps.map((step) => step.kind)).toEqual([
      "model",
      "tool",
    ]);

    const toolStep = run?.turns[0]?.steps[1];
    expect(toolStep?.kind).toBe("tool");
    if (toolStep?.kind === "tool") {
      expect(toolStep.toolCallId).toBe("call-1");
      expect(toolStep.toolName).toBe("readFile");
      expect(toolStep.status).toBe("failed");
      expect(toolStep.error).toBe("tool failed");
    }
  });

  test("projects multiple runs independently from a shared store history", () => {
    const events: ExecutionEvent[] = [
      createEvent(0, { type: "run.started" }),
      createEvent(0, { type: "run.started" }, { runId: "run-2", sessionId: "session-2" }),
      createEvent(1, { type: "run.completed" }),
      createEvent(1, { type: "run.interrupted" }, { runId: "run-2", sessionId: "session-2" }),
    ];

    const runs = projectAgentRuns(events);
    expect(runs.map((run) => [run.id, run.status])).toEqual([
      ["run-1", "completed"],
      ["run-2", "interrupted"],
    ]);
  });
});
