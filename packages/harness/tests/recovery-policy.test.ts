import { describe, expect, test } from "bun:test";
import {
  ProjectionCache,
  recoverRuntime,
  SnapshotPolicy,
  type RecoveryStore,
  type RuntimeEvent,
  type RuntimeSnapshot,
} from "../src/index";

type CounterState = {
  count: number;
  runningOperationIds: string[];
};

class InMemoryRecoveryStore implements RecoveryStore<CounterState> {
  constructor(
    private readonly events: RuntimeEvent[],
    private readonly snapshots: RuntimeSnapshot<CounterState>[] = [],
  ) {}

  async latestSnapshot(sessionId: string): Promise<RuntimeSnapshot<CounterState> | null> {
    return this.snapshots
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .at(-1) ?? null;
  }

  async listAfter(sessionId: string, eventOffset: number): Promise<RuntimeEvent[]> {
    return this.events.filter(
      (event) => event.sessionId === sessionId && event.offset > eventOffset,
    );
  }
}

function contextEvent(
  sessionId: string,
  offset: number,
  phase: "started" | "completed",
  operationId: string,
): RuntimeEvent<"context"> {
  return {
    id: `${sessionId}-${offset}`,
    sessionId,
    type: "context",
    payload: {
      schemaVersion: 1,
      kind: "context.projection",
      phase,
      operationId,
      operation: "manual-compaction",
      mode: "PLAN",
      model: "test-model",
    },
    offset,
    timestamp: offset * 1000,
  };
}

function reduceCounter(state: CounterState, event: RuntimeEvent): CounterState {
  if (event.type !== "context") return state;
  const payload = event.payload;
  const operationId = payload.operationId;
  if (payload.phase === "started") {
    return {
      ...state,
      runningOperationIds: [...state.runningOperationIds, operationId],
    };
  }

  if (payload.phase === "completed") {
    return {
      ...state,
      count: state.count + 1,
      runningOperationIds: state.runningOperationIds.filter((id) => id !== operationId),
    };
  }

  return state;
}

describe("runtime recovery foundation", () => {
  test("projection cache keeps hot state without replacing durable events", () => {
    const cache = new ProjectionCache();
    cache.set("session", { activeEntryId: "a" }, 10);
    cache.set("session", { activeEntryId: "stale" }, 9);

    expect(cache.get("session")?.eventOffset).toBe(10);
    expect(cache.get("session")?.state).toEqual({ activeEntryId: "a" });
    expect(() => cache.set("session", {}, -1)).toThrow(RangeError);
  });

  test("snapshot policy triggers by event count or age only after an event", () => {
    const policy = new SnapshotPolicy({ maxEvents: 10, maxAgeMs: 1000 });

    expect(policy.shouldSnapshot({ currentEventOffset: 9, unsnapshottedEventCount: 9 })).toBe(false);
    expect(policy.shouldSnapshot({ currentEventOffset: 10, unsnapshottedEventCount: 10 })).toBe(true);
    expect(policy.shouldSnapshot({ currentEventOffset: 1, unsnapshottedEventCount: 1, previousSnapshotAt: 0, now: 2000 })).toBe(true);
    expect(policy.shouldSnapshot({ currentEventOffset: 1, unsnapshottedEventCount: 1, firstUnsnappedEventAt: 0, now: 2000 })).toBe(true);
    expect(policy.shouldSnapshot({ currentEventOffset: 10, previousSnapshotOffset: 10, unsnapshottedEventCount: 0, previousSnapshotAt: 0, now: 2000 })).toBe(false);
    expect(policy.shouldSnapshot({ currentEventOffset: 1010, previousSnapshotOffset: 1, unsnapshottedEventCount: 1 })).toBe(false);
    expect(() => new SnapshotPolicy({ maxEvents: 0, maxAgeMs: 1000 })).toThrow(RangeError);
  });

  test("replays all session events when no snapshot exists", async () => {
    const store = new InMemoryRecoveryStore([
      contextEvent("one", 1, "started", "run-1"),
      contextEvent("one", 2, "completed", "run-1"),
      contextEvent("two", 3, "completed", "other"),
    ]);

    const recovered = await recoverRuntime(store, {
      sessionId: "one",
      initialState: { count: 0, runningOperationIds: [] },
      reducer: reduceCounter,
    });

    expect(recovered.state).toEqual({ count: 1, runningOperationIds: [] });
    expect(recovered.diagnostics).toMatchObject({
      snapshotEventOffset: null,
      replayedEventCount: 2,
      lastEventOffset: 2,
    });
  });

  test("restores a snapshot, replays only later events, and reports unfinished work", async () => {
    const store = new InMemoryRecoveryStore(
      [
        contextEvent("one", 1, "started", "completed-before-snapshot"),
        contextEvent("one", 2, "completed", "completed-before-snapshot"),
        contextEvent("one", 3, "started", "still-running"),
      ],
      [{
        id: "snapshot-1",
        sessionId: "one",
        eventOffset: 2,
        state: { count: 1, runningOperationIds: [] },
        timestamp: 2000,
      }],
    );

    const recovered = await recoverRuntime(store, {
      sessionId: "one",
      initialState: { count: 0, runningOperationIds: [] },
      reducer: reduceCounter,
      findPendingExternalOperations: ({ state, replayedEvents }) =>
        state.runningOperationIds.map((id) => ({
          id,
          eventOffset: replayedEvents.at(-1)?.offset ?? 0,
          kind: "tool",
        })),
    });

    expect(recovered.state).toEqual({ count: 1, runningOperationIds: ["still-running"] });
    expect(recovered.replayedEvents.map((event) => event.offset)).toEqual([3]);
    expect(recovered.diagnostics.pendingExternalOperations).toEqual([{
      id: "still-running",
      eventOffset: 3,
      kind: "tool",
    }]);
  });
});
