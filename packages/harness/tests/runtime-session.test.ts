import { describe, expect, test } from "bun:test";
import {
  AgentLoop,
  ProjectionCache,
  RuntimeSession,
  type ExecutionEvent,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventType,
  type RuntimeJsonValue,
  type RuntimeSessionProjection,
  type RuntimeSnapshot,
  type RuntimeSnapshotInput,
  type RuntimeStore,
} from "../src";

class InMemoryRuntimeStore
  implements RuntimeStore<RuntimeSessionProjection & RuntimeJsonValue>
{
  readonly events: RuntimeEvent[] = [];
  readonly snapshots: RuntimeSnapshot<RuntimeSessionProjection & RuntimeJsonValue>[] = [];
  failWhen?: (input: RuntimeEventInput) => boolean;
  failSnapshot = false;
  snapshotAttempts = 0;
  delayWhen?: (input: RuntimeEventInput) => number;

  async append<TType extends RuntimeEventType>(
    input: RuntimeEventInput<TType>,
  ): Promise<RuntimeEvent<TType>> {
    if (this.failWhen?.(input as RuntimeEventInput)) {
      throw new Error("runtime store unavailable");
    }
    const delayMs = this.delayWhen?.(input as RuntimeEventInput) ?? 0;
    if (delayMs > 0) await Bun.sleep(delayMs);

    const event = {
      ...structuredClone(input),
      id: `runtime-${this.events.length + 1}`,
      offset: this.events.length + 1,
      timestamp: (this.events.length + 1) * 1000,
    } as RuntimeEvent<TType>;
    this.events.push(event as RuntimeEvent);
    return event;
  }

  async listAfter(sessionId: string, eventOffset: number): Promise<RuntimeEvent[]> {
    return this.events.filter(
      (event) => event.sessionId === sessionId && event.offset > eventOffset,
    ).map((event) => structuredClone(event));
  }

  async saveSnapshot(
    input: RuntimeSnapshotInput<RuntimeSessionProjection & RuntimeJsonValue>,
  ): Promise<RuntimeSnapshot<RuntimeSessionProjection & RuntimeJsonValue>> {
    this.snapshotAttempts += 1;
    if (this.failSnapshot) throw new Error("snapshot store unavailable");
    const snapshot = {
      ...structuredClone(input),
      id: `snapshot-${this.snapshots.length + 1}`,
      timestamp: Date.now(),
    };
    this.snapshots.push(snapshot);
    return structuredClone(snapshot);
  }

  async latestSnapshot(
    sessionId: string,
  ): Promise<RuntimeSnapshot<RuntimeSessionProjection & RuntimeJsonValue> | null> {
    return structuredClone(
      this.snapshots.filter((snapshot) => snapshot.sessionId === sessionId).at(-1) ?? null,
    );
  }
}

describe("RuntimeSession", () => {
  test("durably appends execution starts before AgentLoop invokes model work", async () => {
    const store = new InMemoryRuntimeStore();
    const runtimeSession = new RuntimeSession({ sessionId: "session-one", store });
    await runtimeSession.ready();
    let modelCalls = 0;

    const loop = new AgentLoop({ eventStore: runtimeSession });
    const run = await loop.run({
      sessionId: "session-one",
      adapter: {
        async runModelStep() {
          modelCalls += 1;
          const executionTypes = store.events
            .filter((event) => event.type === "execution")
            .map((event) => event.payload.event.type);
          expect(executionTypes.at(-1)).toBe("step.started");
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(modelCalls).toBe(1);
    expect(run.status).toBe("completed");
    expect(store.events.filter((event) => event.type === "execution")).toHaveLength(6);
  });

  test("fails closed when a write-ahead execution event cannot be stored", async () => {
    const store = new InMemoryRuntimeStore();
    store.failWhen = (input) =>
      input.type === "execution" && input.payload.event.type === "step.started";
    const runtimeSession = new RuntimeSession({ sessionId: "session-one", store });
    await runtimeSession.ready();
    let modelCalls = 0;

    const loop = new AgentLoop({ eventStore: runtimeSession });
    const run = await loop.run({
      sessionId: "session-one",
      adapter: {
        async runModelStep() {
          modelCalls += 1;
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(modelCalls).toBe(0);
    expect(run.status).toBe("failed");
    expect(store.events.some((event) =>
      event.type === "execution" && event.payload.event.type === "step.started"),
    ).toBe(false);
  });

  test("restores incomplete work, warms the cache, and never invokes side effects", async () => {
    const store = new InMemoryRuntimeStore();
    const first = new RuntimeSession({
      sessionId: "session-one",
      store,
      snapshotPolicy: { maxEvents: 3, maxAgeMs: 60_000 },
    });
    await first.ready();
    await first.append({
      id: "run-started",
      type: "run.started",
      sequence: 0,
      timestamp: 10,
      sessionId: "session-one",
      runId: "run-one",
    });
    await first.append({
      id: "turn-started",
      type: "turn.started",
      sequence: 1,
      timestamp: 20,
      sessionId: "session-one",
      runId: "run-one",
      turnId: "turn-one",
      turnIndex: 0,
      cause: "initial",
    });
    await first.append({
      id: "step-started",
      type: "step.started",
      sequence: 2,
      timestamp: 30,
      sessionId: "session-one",
      runId: "run-one",
      turnId: "turn-one",
      stepId: "step-one",
      stepIndex: 0,
      stepKind: "model",
    });

    const cache = new ProjectionCache<RuntimeSessionProjection>();
    const restarted = new RuntimeSession({
      sessionId: "session-one",
      store,
      projectionCache: cache,
    });
    const report = await restarted.ready();

    expect(report.incompleteRunIds).toEqual(["run-one"]);
    expect(report.pendingExternalOperations).toEqual([{
      id: "step-one",
      eventOffset: expect.any(Number),
      kind: "model",
    }]);
    expect(cache.get("session-one")?.eventOffset).toBeGreaterThanOrEqual(
      report.recoveredEventOffset,
    );
    expect(restarted.getRunEvents("run-one")).toHaveLength(3);
  });

  test("persists a fixed error code instead of arbitrary failure text", async () => {
    const store = new InMemoryRuntimeStore();
    const runtimeSession = new RuntimeSession({ sessionId: "session-one", store });
    await runtimeSession.ready();
    const secret = "TOP-SECRET-TOOL-OUTPUT";

    const loop = new AgentLoop({ eventStore: runtimeSession });
    await loop.run({
      sessionId: "session-one",
      adapter: {
        async runModelStep() {
          throw new Error(secret);
        },
        async runToolStep() {},
      },
    });

    const serialized = JSON.stringify(store.events);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("execution_failed");
  });

  test("rejects extra execution fields before they reach a Runtime Store adapter", async () => {
    const store = new InMemoryRuntimeStore();
    const runtimeSession = new RuntimeSession({ sessionId: "session-one", store });
    await runtimeSession.ready();
    const unsafeEvent = {
      id: "run-started",
      type: "run.started",
      sequence: 0,
      timestamp: 10,
      sessionId: "session-one",
      runId: "run-one",
      prompt: "TOP-SECRET-PROMPT",
    } as unknown as ExecutionEvent;

    await expect(runtimeSession.append(unsafeEvent)).rejects.toThrow(
      "non-allowlisted durable fields",
    );
    expect(JSON.stringify(store.events)).not.toContain("TOP-SECRET-PROMPT");
  });

  test("does not reject a committed event when derived snapshot storage fails", async () => {
    const store = new InMemoryRuntimeStore();
    store.failSnapshot = true;
    let now = 10_000;
    const runtimeSession = new RuntimeSession({
      sessionId: "session-one",
      store,
      snapshotPolicy: { maxEvents: 2, maxAgeMs: 60_000 },
      now: () => now,
    });
    await runtimeSession.ready();
    let modelCalls = 0;

    const run = await new AgentLoop({ eventStore: runtimeSession }).run({
      sessionId: "session-one",
      adapter: {
        async runModelStep() {
          modelCalls += 1;
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(modelCalls).toBe(1);
    expect(run.status).toBe("completed");
    expect(store.snapshots).toHaveLength(0);
    expect(store.snapshotAttempts).toBe(1);
    expect(runtimeSession.getSnapshotDiagnostics()).toEqual({
      consecutiveFailures: 1,
      lastFailureAt: 10_000,
      nextRetryAt: 11_000,
    });
    expect(store.events.some((event) =>
      event.type === "execution" && event.payload.event.type === "run.completed"),
    ).toBe(true);

    store.failSnapshot = false;
    now = 11_000;
    await runtimeSession.record({
      type: "tool",
      payload: {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "requested",
        toolName: "readFile",
        source: "native",
        toolCallId: "tool-retry",
      },
    });
    expect(store.snapshotAttempts).toBe(2);
    expect(store.snapshots).toHaveLength(1);
    expect(runtimeSession.getSnapshotDiagnostics()).toEqual({ consecutiveFailures: 0 });
  });

  test("serializes concurrent records before applying their projections", async () => {
    const store = new InMemoryRuntimeStore();
    const operationId = "context-operation";
    store.delayWhen = (input) => input.type === "context"
      && input.payload.phase === "started"
      ? 20
      : 0;
    const cache = new ProjectionCache<RuntimeSessionProjection>();
    const runtimeSession = new RuntimeSession({
      sessionId: "session-one",
      store,
      projectionCache: cache,
    });
    await runtimeSession.ready();

    await Promise.all([
      runtimeSession.record({
        type: "context",
        payload: {
          schemaVersion: 1,
          kind: "context.projection",
          phase: "started",
          operationId,
          operation: "model-step",
          mode: "BUILD",
          model: "test-model",
        },
      }),
      runtimeSession.record({
        type: "context",
        payload: {
          schemaVersion: 1,
          kind: "context.projection",
          phase: "completed",
          operationId,
          operation: "model-step",
          mode: "BUILD",
          model: "test-model",
        },
      }),
    ]);

    expect(cache.get("session-one")?.state.pendingContexts).toEqual({});
    expect(store.events.map((event) => event.offset)).toEqual(
      store.events.map((_, index) => index + 1),
    );
  });
});
