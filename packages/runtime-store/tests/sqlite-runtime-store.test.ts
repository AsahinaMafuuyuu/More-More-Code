import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { readFile, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  recoverRuntime,
  type RecoveryStore,
  type RuntimeEvent,
  type RuntimeEventInput,
} from "@more-more-code/harness";
import { SqliteRuntimeStore } from "../src/index";

type CounterState = {
  completed: number;
  running: string[];
};

async function createTemporaryRuntimeDatabase(): Promise<{
  databaseUrl: string;
}> {
  const testRoot = process.env.RUNTIME_STORE_TEST_ROOT;
  if (!testRoot) {
    throw new Error("Runtime Store integration tests must be run through the package test script");
  }

  const directory = await mkdtemp(path.join(testRoot, "runtime-store-"));
  const databasePath = path.join(directory, "runtime-store.db");
  const databaseUrl = pathToFileURL(databasePath).href;
  const migrationSql = await readFile(
    new URL("../prisma/migrations/20260822000000_init/migration.sql", import.meta.url),
    "utf8",
  );
  const client = createClient({ url: databaseUrl });

  try {
    await client.executeMultiple(migrationSql);
  } finally {
    await client.close();
  }

  return { databaseUrl };
}

function reduceCounter(state: CounterState, event: RuntimeEvent): CounterState {
  if (event.type !== "context") return state;
  const payload = event.payload;
  const operationId = payload.operationId;
  if (payload.phase === "started") {
    return { ...state, running: [...state.running, operationId] };
  }

  if (payload.phase === "completed") {
    return {
      completed: state.completed + 1,
      running: state.running.filter((id) => id !== operationId),
    };
  }

  return state;
}

function contextPayload(
  phase: "started" | "completed",
  operationId: string,
) {
  return {
    schemaVersion: 1 as const,
    kind: "context.projection" as const,
    phase,
    operationId,
    operation: "manual-compaction" as const,
    mode: "PLAN",
    model: "test-model",
  };
}

function systemPayload() {
  return {
    schemaVersion: 1 as const,
    kind: "runtime.session_opened" as const,
    recoveredEventOffset: 0,
    incompleteRunCount: 0,
    pendingExternalOperationCount: 0,
  };
}

describe("SqliteRuntimeStore", () => {
  test("rejects an invalid event type before it can pollute the durable stream", async () => {
    const temporaryDatabase = await createTemporaryRuntimeDatabase();
    const store = new SqliteRuntimeStore({ databaseUrl: temporaryDatabase.databaseUrl });

    try {
      const invalidInput = {
        sessionId: "session-one",
        type: "not-a-runtime-event",
        payload: { attempted: true },
      } as unknown as RuntimeEventInput;

      await expect(store.append(invalidInput)).rejects.toThrow("Unknown Runtime Event type");
      expect(await store.listAfter("session-one", 0)).toEqual([]);

      await store.append({
        sessionId: "session-one",
        type: "system",
        payload: systemPayload(),
      });
      expect((await store.listAfter("session-one", 0)).map((event) => event.type)).toEqual(["system"]);
    } finally {
      await store.close();
    }
  });

  test("rejects non-allowlisted payload fields before sensitive content is stored", async () => {
    const temporaryDatabase = await createTemporaryRuntimeDatabase();
    const store = new SqliteRuntimeStore({ databaseUrl: temporaryDatabase.databaseUrl });

    try {
      const unsafeInput = {
        sessionId: "session-one",
        type: "tool",
        payload: {
          schemaVersion: 1,
          kind: "tool.lifecycle",
          phase: "completed",
          toolName: "bash",
          source: "native",
          toolCallId: "tool-call-one",
          status: "completed",
          output: "TOP-SECRET-TOOL-OUTPUT",
        },
      } as unknown as RuntimeEventInput;

      await expect(store.append(unsafeInput)).rejects.toThrow(
        "Invalid tool Runtime Event payload",
      );
      const unsafeStatus = {
        sessionId: "session-one",
        type: "tool",
        payload: {
          schemaVersion: 1,
          kind: "tool.lifecycle",
          phase: "completed",
          toolName: "bash",
          source: "native",
          toolCallId: "tool-call-one",
          status: "TOP-SECRET-ERROR-TEXT",
          durationMs: 1,
        },
      } as unknown as RuntimeEventInput;
      await expect(store.append(unsafeStatus)).rejects.toThrow(
        "Invalid tool Runtime Event payload",
      );
      expect(await store.listAfter("session-one", 0)).toEqual([]);
    } finally {
      await store.close();
    }
  });

  test("assigns append-only offsets for concurrent appends and scopes reads by session", async () => {
    const temporaryDatabase = await createTemporaryRuntimeDatabase();
    const store = new SqliteRuntimeStore({ databaseUrl: temporaryDatabase.databaseUrl });

    try {
      await Promise.all(
        Array.from({ length: 16 }, () =>
          store.append({
            sessionId: "session-one",
            type: "system",
            payload: systemPayload(),
          }),
        ),
      );
      await store.append({
        sessionId: "session-two",
        type: "system",
        payload: systemPayload(),
      });

      const sessionOneEvents = await store.listAfter("session-one", 0);
      const sessionTwoEvents = await store.listAfter("session-two", 0);

      expect(sessionOneEvents).toHaveLength(16);
      expect(sessionOneEvents.map((event) => event.offset)).toEqual(
        [...sessionOneEvents.map((event) => event.offset)].sort((left, right) => left - right),
      );
      expect(new Set(sessionOneEvents.map((event) => event.offset)).size).toBe(16);
      expect(sessionTwoEvents).toHaveLength(1);
      expect(sessionTwoEvents[0]?.sessionId).toBe("session-two");
    } finally {
      await store.close();
    }
  });

  test("keeps snapshots session-scoped and rejects a foreign event offset", async () => {
    const temporaryDatabase = await createTemporaryRuntimeDatabase();
    const store = new SqliteRuntimeStore<CounterState>({
      databaseUrl: temporaryDatabase.databaseUrl,
    });

    try {
      const first = await store.append({
        sessionId: "session-one",
        type: "context",
        payload: contextPayload("completed", "one"),
      });
      const second = await store.append({
        sessionId: "session-two",
        type: "context",
        payload: contextPayload("completed", "two"),
      });

      await store.saveSnapshot({
        sessionId: "session-one",
        eventOffset: first.offset,
        state: { completed: 1, running: [] },
      });
      await store.saveSnapshot({
        sessionId: "session-two",
        eventOffset: second.offset,
        state: { completed: 1, running: [] },
      });

      expect((await store.latestSnapshot("session-one"))?.eventOffset).toBe(first.offset);
      expect((await store.latestSnapshot("session-two"))?.eventOffset).toBe(second.offset);
      await expect(store.saveSnapshot({
        sessionId: "session-one",
        eventOffset: second.offset,
        state: { completed: 1, running: [] },
      })).rejects.toThrow("no event belongs to session session-one");
    } finally {
      await store.close();
    }
  });

  test("replays post-snapshot events with the same projection after a store restart", async () => {
    const temporaryDatabase = await createTemporaryRuntimeDatabase();
    const firstStore = new SqliteRuntimeStore<CounterState>({
      databaseUrl: temporaryDatabase.databaseUrl,
    });
    let firstStoreClosed = false;

    try {
      const started = await firstStore.append({
        sessionId: "session-one",
        type: "context",
        payload: contextPayload("started", "run-one"),
      });
      const completed = await firstStore.append({
        sessionId: "session-one",
        type: "context",
        payload: contextPayload("completed", "run-one"),
      });
      const fullReplay = await recoverRuntime(firstStore, {
        sessionId: "session-one",
        initialState: { completed: 0, running: [] },
        reducer: reduceCounter,
      });
      await firstStore.saveSnapshot({
        sessionId: "session-one",
        eventOffset: completed.offset,
        state: fullReplay.state,
      });
      await firstStore.append({
        sessionId: "session-one",
        type: "context",
        payload: contextPayload("started", "run-two"),
      });
      const fullReplayStore: RecoveryStore<CounterState> = {
        listAfter: (sessionId, eventOffset) => firstStore.listAfter(sessionId, eventOffset),
        latestSnapshot: async () => null,
      };
      const expectedFullReplay = await recoverRuntime(fullReplayStore, {
        sessionId: "session-one",
        initialState: { completed: 0, running: [] },
        reducer: reduceCounter,
      });

      await firstStore.close();
      firstStoreClosed = true;
      const restartedStore = new SqliteRuntimeStore<CounterState>({
        databaseUrl: temporaryDatabase.databaseUrl,
      });

      try {
        const recovered = await recoverRuntime(restartedStore, {
          sessionId: "session-one",
          initialState: { completed: 0, running: [] },
          reducer: reduceCounter,
        });

        expect(started.offset).toBeLessThan(completed.offset);
        expect(recovered.state).toEqual(expectedFullReplay.state);
        expect(recovered.replayedEvents).toHaveLength(1);
        expect(recovered.diagnostics).toMatchObject({
          snapshotEventOffset: completed.offset,
          replayedEventCount: 1,
        });
      } finally {
        await restartedStore.close();
      }
    } finally {
      if (!firstStoreClosed) {
        await firstStore.close();
      }
    }
  });
});
