import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCAL_SESSION_STORE_MIGRATIONS,
  LocalSessionConflictError,
  bootstrapLocalSessionStore,
  migrateLocalSessionStore,
} from "../src";
import type { SessionTreeState } from "@more-more-code/harness";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

async function temporaryDatabase() {
  const testRoot = process.env.SESSION_STORE_TEST_ROOT;
  if (!testRoot) {
    throw new Error("Session Store integration tests must be run through the package test script");
  }
  const directory = await mkdtemp(path.join(testRoot, "session-store-"));
  return {
    databaseUrl: pathToFileURL(path.join(directory, "nested", "sessions.db")).href,
    directory,
  };
}

function tree(prefix: string): SessionTreeState<Message> {
  const rootId = `${prefix}-root`;
  return {
    version: 3,
    rootEntryId: rootId,
    activeEntryId: rootId,
    entries: [{
      id: rootId,
      parentId: null,
      createdAt: 1,
      type: "session_start",
    }],
  };
}

function appendUser(
  state: SessionTreeState<Message>,
  id: string,
  content: string,
  createdAt = 2,
): SessionTreeState<Message> {
  const message: Message = { id: `${id}-message`, role: "user", content };
  return {
    ...structuredClone(state),
    activeEntryId: id,
    entries: [
      ...state.entries,
      {
        id,
        parentId: state.activeEntryId,
        createdAt,
        type: "user_message",
        messageId: message.id,
        message,
      },
    ],
  };
}

function appendAssistant(
  state: SessionTreeState<Message>,
  id: string,
  content: string,
  createdAt = 3,
): SessionTreeState<Message> {
  const message: Message = { id: `${id}-message`, role: "assistant", content };
  return {
    ...structuredClone(state),
    activeEntryId: id,
    entries: [
      ...state.entries,
      {
        id,
        parentId: state.activeEntryId,
        createdAt,
        type: "assistant_message",
        messageId: message.id,
        message,
      },
    ],
  };
}

describe("SqliteLocalSessionStore", () => {
  test("creates, loads, lists, and archives a full Harness Session Tree", async () => {
    const { databaseUrl } = await temporaryDatabase();
    let clock = 100;
    const { store } = await bootstrapLocalSessionStore({ databaseUrl, now: () => clock++ });

    try {
      const alphaTree = appendUser(tree("alpha"), "alpha-user", "hello");
      const betaTree = tree("beta");
      const alpha = await store.create({
        id: "alpha",
        title: "Alpha",
        metadata: { model: "deepseek-v4", settings: { temperature: 0.2 } },
        state: alphaTree,
      });
      await store.create({ id: "beta", title: "Beta", state: betaTree });

      expect(alpha).toMatchObject({
        id: "alpha",
        rootEntryId: "alpha-root",
        activeEntryId: "alpha-user",
        revision: 0,
        archivedAt: null,
      });
      expect((await store.list()).map((session) => session.id)).toEqual(["beta", "alpha"]);

      const loaded = await store.load<Message>("alpha");
      expect(loaded).not.toBeNull();
      expect(loaded?.state).toEqual(alphaTree);
      expect(loaded?.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
      expect(loaded?.session.metadata).toEqual({
        model: "deepseek-v4",
        settings: { temperature: 0.2 },
      });

      // Returned snapshots are copies, not mutable aliases for the local authority.
      (loaded?.state.entries[1] as { message?: Message }).message!.content = "mutated in memory";
      expect((await store.load<Message>("alpha"))?.state.entries[1]).toMatchObject({
        message: { content: "hello" },
      });

      const archived = await store.archive("alpha");
      expect(archived.archivedAt).not.toBeNull();
      expect((await store.list()).map((session) => session.id)).toEqual(["beta"]);
      expect((await store.list({ includeArchived: true })).map((session) => session.id)).toEqual([
        "alpha",
        "beta",
      ]);
      await expect(store.commit({ sessionId: "alpha", state: alphaTree })).rejects.toThrow(
        "is archived",
      );
    } finally {
      await store.close();
    }
  });

  test("persists active branch, metadata, and monotonic sequences across a restart", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const first = await bootstrapLocalSessionStore({ databaseUrl, now: () => 50 });
    let firstClosed = false;

    try {
      const initial = appendUser(tree("restart"), "restart-user", "first");
      await first.store.create({
        id: "restart",
        title: "Restartable",
        metadata: { mode: "BUILD" },
        state: initial,
      });
      const continued = appendAssistant(initial, "restart-assistant", "second");
      const committed = await first.store.commit({
        sessionId: "restart",
        state: continued,
        metadata: { mode: "PLAN", cache: { checkpoint: "one" } },
      });
      expect(committed).toMatchObject({ activeEntryId: "restart-assistant", revision: 1 });
      await first.store.close();
      firstClosed = true;

      const restarted = await bootstrapLocalSessionStore({ databaseUrl, now: () => 51 });
      try {
        const loaded = await restarted.store.load<Message>("restart");
        expect(loaded?.state).toEqual(continued);
        expect(loaded?.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
        expect(loaded?.session.metadata).toEqual({ mode: "PLAN", cache: { checkpoint: "one" } });
      } finally {
        await restarted.store.close();
      }
    } finally {
      if (!firstClosed) await first.store.close();
    }
  });

  test("rejects invalid topology and cross-session entry ownership before either can pollute a tree", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const { store } = await bootstrapLocalSessionStore({ databaseUrl });

    try {
      const firstTree = tree("first");
      const secondTree = tree("second");
      await store.create({ id: "first", title: "First", state: firstTree });
      await store.create({ id: "second", title: "Second", state: secondTree });

      const orphan = {
        ...secondTree,
        activeEntryId: "orphan",
        entries: [
          ...secondTree.entries,
          {
            id: "orphan",
            parentId: "missing-parent",
            createdAt: 2,
            type: "custom" as const,
            customType: "test",
            data: {},
          },
        ],
      } satisfies SessionTreeState<Message>;
      await expect(store.commit({ sessionId: "second", state: orphan })).rejects.toThrow(
        "Invalid Session Tree topology",
      );

      const foreignEntry = {
        id: "first-root",
        parentId: "second-root",
        createdAt: 2,
        type: "custom" as const,
        customType: "forged",
        data: {},
      };
      const forged = {
        ...secondTree,
        activeEntryId: foreignEntry.id,
        entries: [...secondTree.entries, foreignEntry],
      } satisfies SessionTreeState<Message>;
      await expect(store.commit({ sessionId: "second", state: forged })).rejects.toThrow(
        "belongs to Local Session first",
      );
      expect((await store.load("second"))?.entries).toHaveLength(1);
    } finally {
      await store.close();
    }
  });

  test("commits atomically when SQLite rejects an entry in the middle of a batch", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const { store } = await bootstrapLocalSessionStore({ databaseUrl });

    try {
      const initial = tree("atomic");
      await store.create({ id: "atomic", title: "Atomic", state: initial });

      const client = createClient({ url: databaseUrl });
      try {
        await client.executeMultiple(`
          CREATE TRIGGER "reject_exploding_entry"
          BEFORE INSERT ON "LocalSessionEntry"
          WHEN NEW."id" = 'explode'
          BEGIN
            SELECT RAISE(ABORT, 'forced rollback');
          END;
        `);
      } finally {
        client.close();
      }

      const withFirst = appendUser(initial, "first-write", "must roll back");
      const exploding = appendAssistant(withFirst, "explode", "must roll back too");
      await expect(store.commit({ sessionId: "atomic", state: exploding })).rejects.toThrow(
        "forced rollback",
      );

      const reloaded = await store.load("atomic");
      expect(reloaded?.entries.map((entry) => entry.entry.id)).toEqual(["atomic-root"]);
      expect(reloaded?.session.activeEntryId).toBe("atomic-root");
      expect(reloaded?.session.revision).toBe(0);
    } finally {
      await store.close();
    }
  });

  test("treats identical retries as no-ops and rejects content changes for a persisted entry id", async () => {
    const { databaseUrl } = await temporaryDatabase();
    let clock = 1000;
    const { store } = await bootstrapLocalSessionStore({ databaseUrl, now: () => clock++ });

    try {
      const initial = appendUser(tree("retry"), "retry-user", "original");
      const created = await store.create({ id: "retry", title: "Retry", state: initial });
      const recreated = await store.create({ id: "retry", title: "Retry", state: initial });
      expect(recreated).toEqual(created);

      const firstCommit = await store.commit({ sessionId: "retry", state: initial });
      expect(firstCommit).toEqual(created);
      const changed = appendAssistant(initial, "retry-assistant", "new content");
      const persisted = await store.commit({ sessionId: "retry", state: changed });
      expect(persisted.revision).toBe(1);

      const repeated = await store.commit({ sessionId: "retry", state: changed });
      expect(repeated).toEqual(persisted);

      const conflicting = structuredClone(changed);
      const user = conflicting.entries.find((entry) => entry.id === "retry-user") as {
        message: Message;
      };
      user.message.content = "different payload";
      await expect(store.commit({ sessionId: "retry", state: conflicting })).rejects.toBeInstanceOf(
        LocalSessionConflictError,
      );
      expect((await store.load("retry"))?.state).toEqual(changed);
    } finally {
      await store.close();
    }
  });

  test("uses a stable list ordering and append-only sequence even when timestamps tie", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const { store } = await bootstrapLocalSessionStore({ databaseUrl, now: () => 100 });

    try {
      await store.create({ id: "zeta", title: "Zeta", state: tree("zeta") });
      await store.create({ id: "alpha", title: "Alpha", state: tree("alpha") });
      await store.create({ id: "middle", title: "Middle", state: tree("middle") });
      expect((await store.list()).map((session) => session.id)).toEqual([
        "alpha",
        "middle",
        "zeta",
      ]);

      const branches = {
        version: 3,
        rootEntryId: "zeta-root",
        activeEntryId: "zeta-right",
        entries: [
          ...tree("zeta").entries,
          {
            id: "zeta-left",
            parentId: "zeta-root",
            createdAt: 2,
            type: "custom" as const,
            customType: "branch",
            data: { side: "left" },
          },
          {
            id: "zeta-right",
            parentId: "zeta-root",
            createdAt: 3,
            type: "custom" as const,
            customType: "branch",
            data: { side: "right" },
          },
        ],
      } satisfies SessionTreeState<Message>;
      await store.commit({ sessionId: "zeta", state: branches });
      expect((await store.load("zeta"))?.entries.map((entry) => [entry.sequence, entry.entry.id]))
        .toEqual([[1, "zeta-root"], [2, "zeta-left"], [3, "zeta-right"]]);
    } finally {
      await store.close();
    }
  });

  test("round-trips untrusted JSON metadata without prototype mutation", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const { store } = await bootstrapLocalSessionStore({ databaseUrl });

    try {
      const metadata = JSON.parse('{"__proto__":{"polluted":true},"provider":"custom"}');
      await store.create({ id: "metadata", title: "Metadata", state: tree("metadata"), metadata });
      const loaded = await store.load("metadata");
      expect(Object.prototype.hasOwnProperty.call(loaded?.session.metadata, "__proto__")).toBe(true);
      expect((loaded?.session.metadata as Record<string, unknown>)["__proto__"]).toEqual({
        polluted: true,
      });
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  test("applies embedded migrations once and safely repeats bootstrap", async () => {
    const { databaseUrl, directory } = await temporaryDatabase();
    await migrateLocalSessionStore(databaseUrl);
    await migrateLocalSessionStore(databaseUrl);

    const client = createClient({ url: databaseUrl });
    try {
      const migrations = await client.execute(
        'SELECT "id" FROM "_MoreMoreCodeSessionMigration" ORDER BY "id" ASC',
      );
      expect(migrations.rows.map((row) => row.id)).toEqual(
        LOCAL_SESSION_STORE_MIGRATIONS.map((migration) => migration.id),
      );
    } finally {
      client.close();
    }

    const first = await bootstrapLocalSessionStore({ databaseUrl });
    await first.store.create({ id: "migrated", title: "Migrated", state: tree("migrated") });
    await first.store.close();
    const second = await bootstrapLocalSessionStore({ databaseUrl });
    try {
      expect((await second.store.get("migrated"))?.title).toBe("Migrated");
    } finally {
      await second.store.close();
    }

    // The test database lives in a nested directory, proving bootstrap created it.
    expect(directory).toContain("more-more-code-session-store-");
  });

  test("closes its SQLite handle and rejects later operations", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const { store } = await bootstrapLocalSessionStore({ databaseUrl });
    await store.close();
    await expect(store.list()).rejects.toThrow("is closed");
  });
});
