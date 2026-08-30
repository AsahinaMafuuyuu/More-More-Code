import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendSessionEntry,
  createCompactionCheckpointV2,
  createEmptyCompactionCheckpointState,
  projectLatestSessionCompaction,
  validateCompactionCheckpointV2,
  type CompactionPlan,
  type SessionTreeState,
} from "@more-more-code/harness";
import { bootstrapLocalSessionStore } from "../../session-store/src";
import {
  createLocalSessionAuthority,
} from "../src/lib/local-session-authority";
import {
  bootstrapLocalSessionEnvironment,
  getLocalSessionAuthority,
  shutdownLocalSessionEnvironment,
} from "../src/lib/session-environment";

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  parts: [{ type: "text"; text: string }];
};

type SessionTree = SessionTreeState<TestMessage>;

type LocalSessionAuthorityContract = {
  create(input: {
    id?: string;
    title: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ session: { id: string; title: string }; state: SessionTree }>;
  list(options?: { includeArchived?: boolean }): Promise<unknown[]>;
  open(sessionId: string): Promise<{
    session: { id: string; title: string };
    state: SessionTree;
  } | null>;
  commit(input: {
    sessionId: string;
    state: SessionTree;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
};

const temporaryRoots: string[] = [];

async function removeTemporaryRoot(root: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transientWindowsLock = process.platform === "win32"
        && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(code ?? "");
      if (!transientWindowsLock) {
        throw error;
      }
      if (attempt === 29) {
        // The store has already been explicitly closed and all persistence /
        // restart assertions completed. On Windows, libsql or external file
        // scanners can retain a temp-file handle past the test lifetime. Temp
        // deletion is infrastructure cleanup, not the authority contract.
        return;
      }
      // Bun/libsql can release the final Windows SQLite handle a little after
      // Client.close(). Keep the retry window bounded below Bun's hook timeout.
      await Bun.sleep(200);
    }
  }
}

afterEach(async () => {
  // libsql releases Windows file handles shortly after Client.close().
  await Bun.sleep(250);
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryRoot));
}, { timeout: 10_000 });

function sessionTree(): SessionTree {
  return {
    version: 3,
    rootEntryId: "offline-root",
    activeEntryId: "offline-root",
    entries: [{
      id: "offline-root",
      parentId: null,
      createdAt: 1,
      type: "session_start",
    }],
  };
}

function appendMessage(
  state: SessionTree,
  entryId: string,
  message: TestMessage,
  createdAt: number,
): SessionTree {
  const entryType = message.role === "user" ? "user_message" : "assistant_message";
  return {
    ...structuredClone(state),
    activeEntryId: entryId,
    entries: [
      ...state.entries,
      {
        id: entryId,
        parentId: state.activeEntryId,
        createdAt,
        type: entryType,
        messageId: message.id,
        message,
      },
    ],
  } as SessionTree;
}

async function createAuthority(
  databaseUrl: string,
  options: { createId?: () => string; now?: () => number } = {},
) {
  const bootstrapped = await bootstrapLocalSessionStore({ databaseUrl, now: () => 100 });
  const factory = createLocalSessionAuthority as unknown as (options: {
    store: typeof bootstrapped.store;
    createId?: () => string;
    now?: () => number;
  }) => LocalSessionAuthorityContract;
  return {
    authority: factory({
      store: bootstrapped.store,
      ...(options.createId ? { createId: options.createId } : {}),
      now: options.now ?? (() => 100),
    }),
    store: bootstrapped.store,
  };
}

describe("local Session Authority", () => {
  test("rehydrates Checkpoint V2 after a real SQLite restart and can continue the checkpoint chain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-cli-compaction-restart-"));
    temporaryRoots.push(root);
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    let { authority, store } = await createAuthority(databaseUrl, {
      createId: () => "compaction-root",
    });

    const constraintText = "Keep canonical Session history append-only across restart.";
    const checkpointState = createEmptyCompactionCheckpointState();
    checkpointState.constraints.push({
      id: "constraint-append-only",
      text: constraintText,
      sourceRecordIds: ["source-entry"],
    });
    const planOne: CompactionPlan = {
      version: 1,
      planId: "plan-before-restart",
      policyVersion: "context-compaction-v2",
      trigger: "soft-limit",
      baseCheckpointId: null,
      sourceRecordIds: ["source-entry"],
      sourceDigest: "source-digest-before-restart",
      provenanceRecordIds: ["source-entry"],
      retainedRecordIds: ["tail-entry"],
      compactedThroughRecordId: "source-entry",
      retainedFromRecordId: "tail-entry",
      splitGroup: false,
      inputTokensBefore: 100,
      targetInputTokens: 70,
      maxCheckpointTokens: 40,
      requiredAnchors: [{
        id: "anchor-append-only",
        priority: "P0",
        kind: "constraint",
        text: constraintText,
        sourceRecordIds: ["source-entry"],
      }],
    };
    const checkpointOne = createCompactionCheckpointV2({
      plan: planOne,
      state: checkpointState,
      quality: "verified",
      coveredAnchorIds: ["anchor-append-only"],
    });

    try {
      const created = await authority.create({ id: "compaction-session", title: "Compaction Restart" });
      let state = appendMessage(
        created.state,
        "source-entry",
        { id: "source-message", role: "user", parts: [{ type: "text", text: "old history" }] },
        2,
      );
      state = appendMessage(
        state,
        "tail-entry",
        { id: "tail-message", role: "assistant", parts: [{ type: "text", text: "recent raw tail" }] },
        3,
      );
      state = appendSessionEntry(state, {
        type: "compaction",
        summary: {
          id: "checkpoint-message-1",
          role: "assistant",
          parts: [{ type: "text", text: checkpointOne.renderedSummary }],
        },
        checkpointV2: checkpointOne,
        compactionPlanId: planOne.planId,
        trigger: planOne.trigger,
        compactedRecordIds: ["source-entry"],
        retainedTailRecordIds: ["tail-entry"],
        compactedMessageIds: ["source-message"],
        retainedTailMessageIds: ["tail-message"],
      }, {
        createId: () => "checkpoint-entry-1",
        now: () => 4,
      });
      await authority.commit({ sessionId: "compaction-session", state });

      // Closing the first SQLite store is the process crash/restart boundary.
      await store.close();
      ({ authority, store } = await createAuthority(databaseUrl, {
        createId: () => "compaction-root",
      }));
      const restarted = await authority.open("compaction-session");
      expect(restarted).not.toBeNull();
      const persistedOne = projectLatestSessionCompaction(restarted!.state);
      expect(persistedOne?.checkpointV2?.checkpointId).toBe(checkpointOne.checkpointId);
      expect(persistedOne?.checkpointV2?.source.sourceDigest).toBe(planOne.sourceDigest);
      expect(persistedOne?.compactedRecordIds).toEqual(["source-entry"]);
      expect(persistedOne?.retainedTailRecordIds).toEqual(["tail-entry"]);
      expect(validateCompactionCheckpointV2({ checkpoint: persistedOne!.checkpointV2!, plan: planOne }))
        .toEqual({ valid: true });

      const continued = appendMessage(
        restarted!.state,
        "post-restart-entry",
        { id: "post-restart-message", role: "user", parts: [{ type: "text", text: "continue" }] },
        5,
      );
      const planTwo: CompactionPlan = {
        ...planOne,
        planId: "plan-after-restart",
        trigger: "hard-limit",
        baseCheckpointId: checkpointOne.checkpointId,
        sourceRecordIds: ["checkpoint-entry-1", "post-restart-entry"],
        sourceDigest: "source-digest-after-restart",
        provenanceRecordIds: ["checkpoint-entry-1", "post-restart-entry", "source-entry"],
        compactedThroughRecordId: "post-restart-entry",
        inputTokensBefore: 130,
        requiredAnchors: [{
          id: `checkpoint:${checkpointOne.checkpointId}:constraint-append-only`,
          priority: "P0",
          kind: "constraint",
          text: constraintText,
          sourceRecordIds: ["source-entry"],
        }],
      };
      const checkpointTwo = createCompactionCheckpointV2({
        plan: planTwo,
        state: checkpointState,
        quality: "verified",
        coveredAnchorIds: planTwo.requiredAnchors.map((anchor) => anchor.id),
      });
      const chained = appendSessionEntry(continued, {
        type: "compaction",
        summary: {
          id: "checkpoint-message-2",
          role: "assistant",
          parts: [{ type: "text", text: checkpointTwo.renderedSummary }],
        },
        checkpointV2: checkpointTwo,
        compactionPlanId: planTwo.planId,
        trigger: planTwo.trigger,
        compactedRecordIds: ["source-entry", "post-restart-entry"],
        retainedTailRecordIds: ["tail-entry"],
        compactedMessageIds: ["source-message", "post-restart-message"],
        retainedTailMessageIds: ["tail-message"],
      }, {
        createId: () => "checkpoint-entry-2",
        now: () => 6,
      });
      await authority.commit({ sessionId: "compaction-session", state: chained });

      await store.close();
      ({ authority, store } = await createAuthority(databaseUrl, {
        createId: () => "compaction-root",
      }));
      const resumed = await authority.open("compaction-session");
      const persistedTwo = projectLatestSessionCompaction(resumed!.state);
      expect(persistedTwo?.checkpointV2?.checkpointId).toBe(checkpointTwo.checkpointId);
      expect(persistedTwo?.checkpointV2?.baseCheckpointId).toBe(checkpointOne.checkpointId);
      expect(persistedTwo?.checkpointV2?.state.constraints[0]?.text).toBe(constraintText);
      expect(resumed!.state.entries.filter((entry) => entry.type === "compaction"))
        .toHaveLength(2);
    } finally {
      await store.close();
    }
  });

  test("creates a session through the production default id generator", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-cli-local-session-default-id-"));
    temporaryRoots.push(root);
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    const { authority, store } = await createAuthority(databaseUrl);

    try {
      const created = await authority.create({ title: "Default ID Session" });
      expect(created.session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(created.state.rootEntryId).not.toBe("");
    } finally {
      await store.close();
    }
  });

  test("creates, lists, opens, restarts, and continues without touching the Server", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-cli-local-session-"));
    temporaryRoots.push(root);
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("Server access is forbidden in a local Session test");
    }) as unknown as typeof fetch;

    let { authority, store } = await createAuthority(databaseUrl, {
      createId: () => "offline-root",
    });
    try {
      const created = await authority.create({
        id: "offline-session",
        title: "Offline Session",
        metadata: {
          mode: "BUILD",
          model: { providerId: "custom-test", modelId: "offline-model" },
        },
      });
      expect(created).toMatchObject({ session: { id: "offline-session" } });
      const initial = appendMessage(
        created.state,
        "offline-user-entry",
        { id: "offline-user", role: "user", parts: [{ type: "text", text: "first" }] },
        2,
      );
      await authority.commit({
        sessionId: "offline-session",
        state: initial,
      });
      expect((await authority.list()).map((session) => (session as { id: string }).id)).toEqual([
        "offline-session",
      ]);

      const opened = await authority.open("offline-session");
      expect(opened).toMatchObject({
        session: { id: "offline-session", title: "Offline Session" },
        state: initial,
      });

      // Closing and constructing a fresh authority is the process restart boundary.
      await store.close();
      ({ authority, store } = await createAuthority(databaseUrl, {
        createId: () => "offline-root",
      }));
      const restarted = await authority.open("offline-session");
      expect(restarted?.state).toEqual(initial);

      const continued = appendMessage(
        initial,
        "offline-assistant-entry",
        { id: "offline-assistant", role: "assistant", parts: [{ type: "text", text: "continued" }] },
        3,
      );
      await authority.commit({
        sessionId: "offline-session",
        state: continued,
        metadata: { cache: { checkpoint: "local" } },
      });
      await store.close();
      ({ authority, store } = await createAuthority(databaseUrl, {
        createId: () => "offline-root",
      }));

      const resumed = await authority.open("offline-session");
      expect(resumed?.state).toEqual(continued);
      expect(resumed?.state.activeEntryId).toBe("offline-assistant-entry");
      expect(resumed?.state.entries.map((entry) => entry.id)).toEqual([
        "offline-root",
        "offline-user-entry",
        "offline-assistant-entry",
      ]);
    } finally {
      await store.close();
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toBe(0);
  });

  test("boots one local authority and shuts it down without an API URL", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-cli-session-environment-"));
    temporaryRoots.push(root);
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("Server access is forbidden in a local Session test");
    }) as unknown as typeof fetch;

    try {
      const environment = await bootstrapLocalSessionEnvironment({ databaseUrl });
      expect(environment.authority).toBe(getLocalSessionAuthority());
      expect(await environment.authority.list()).toEqual([]);

      // The environment is process-scoped and must not silently replace its
      // authority while a session is active.
      expect(await bootstrapLocalSessionEnvironment({
        databaseUrl: pathToFileURL(path.join(root, "ignored.db")).href,
      })).toBe(environment);

      await shutdownLocalSessionEnvironment();
      await expect(Promise.resolve().then(() => getLocalSessionAuthority()))
        .rejects.toThrow("has not been bootstrapped");
    } finally {
      await shutdownLocalSessionEnvironment();
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toBe(0);
  });
});
