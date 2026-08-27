import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionTreeState } from "@more-more-code/harness";
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

afterEach(async () => {
  // libsql releases Windows file handles shortly after Client.close().
  await Bun.sleep(500);
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  })));
});

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
