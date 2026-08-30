import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectSessionTreeMessages } from "@more-more-code/harness";
import { bootstrapLocalSessionStore } from "../../session-store/src";
import type { Message } from "../src/lib/chat-types";
import {
  appendDurableSessionMessages,
  appendFinalizedDurableAssistantMessage,
  projectDurableSessionMessages,
} from "../src/lib/durable-session-message";
import { createLocalSessionAuthority } from "../src/lib/local-session-authority";
import { removeTemporaryRoot } from "./test-temp-cleanup";

describe("durable Session message persistence", () => {
  test("persists runtime undefined, preserves Provider metadata, and round-trips locally", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-durable-message-persistence-"));
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("Server access is forbidden in durable message persistence tests");
    }) as unknown as typeof fetch;

    let bootstrapped = await bootstrapLocalSessionStore({ databaseUrl, now: () => 100 });
    let store = bootstrapped.store;
    let authority = createLocalSessionAuthority({
      store,
      createId: () => crypto.randomUUID(),
      now: () => 100,
    });

    const undefinedRuntime = {
      id: "assistant-runtime-undefined",
      role: "assistant",
      parts: [{
        type: "text",
        text: "first",
        state: "done",
        providerMetadata: undefined,
      }],
    } as Message;
    const metadataRuntime = {
      id: "assistant-runtime-metadata",
      role: "assistant",
      parts: [{
        type: "text",
        text: "second",
        state: "done",
        providerMetadata: {
          openai: {
            itemId: "item-1",
            nested: { kept: true },
          },
        },
        optionalRuntimeField: undefined,
      }],
    } as unknown as Message;

    try {
      const created = await authority.create({
        id: "durable-message-session",
        title: "Durable Message Session",
      });
      let next = appendFinalizedDurableAssistantMessage(created.state, undefinedRuntime);
      next = appendFinalizedDurableAssistantMessage(next, metadataRuntime);
      await authority.commit({
        sessionId: "durable-message-session",
        state: next,
      });

      await store.close();
      bootstrapped = await bootstrapLocalSessionStore({ databaseUrl, now: () => 101 });
      store = bootstrapped.store;
      authority = createLocalSessionAuthority({
        store,
        createId: () => crypto.randomUUID(),
        now: () => 101,
      });

      const reopened = await authority.open("durable-message-session");
      const messages = projectSessionTreeMessages(reopened!.state);
      const undefinedPart = messages[0]!.parts[0] as Record<string, unknown>;
      const metadataPart = messages[1]!.parts[0] as Record<string, unknown>;

      expect(Object.prototype.hasOwnProperty.call(undefinedPart, "providerMetadata")).toBe(false);
      expect(metadataPart.providerMetadata).toEqual({
        openai: {
          itemId: "item-1",
          nested: { kept: true },
        },
      });
      expect(Object.prototype.hasOwnProperty.call(metadataPart, "optionalRuntimeField")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(
        undefinedRuntime.parts[0] as Record<string, unknown>,
        "providerMetadata",
      )).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(
        metadataRuntime.parts[0] as Record<string, unknown>,
        "optionalRuntimeField",
      )).toBe(true);
      expect(fetchCalls).toBe(0);
    } finally {
      await store.close();
      globalThis.fetch = originalFetch;
      await removeTemporaryRoot(root);
    }
  });

  test("loads legacy message_update history and continues using finalized-message writes only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-legacy-message-update-"));
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    let bootstrapped = await bootstrapLocalSessionStore({ databaseUrl, now: () => 200 });
    let store = bootstrapped.store;
    let authority = createLocalSessionAuthority({
      store,
      createId: () => crypto.randomUUID(),
      now: () => 200,
    });

    const draft = {
      id: "legacy-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "draft", state: "done" }],
    } as Message;
    const final = {
      ...draft,
      parts: [{ type: "text", text: "legacy final", state: "done" }],
    } as Message;
    const continued = {
      id: "new-finalized-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "new style", state: "done" }],
    } as Message;

    try {
      const created = await authority.create({
        id: "legacy-update-session",
        title: "Legacy Update Session",
      });
      let legacy = appendDurableSessionMessages(created.state, [draft]);
      legacy = appendDurableSessionMessages(legacy, [final]);
      expect(legacy.entries.filter((entry) => entry.type === "message_update")).toHaveLength(1);
      await authority.commit({ sessionId: "legacy-update-session", state: legacy });

      await store.close();
      bootstrapped = await bootstrapLocalSessionStore({ databaseUrl, now: () => 201 });
      store = bootstrapped.store;
      authority = createLocalSessionAuthority({
        store,
        createId: () => crypto.randomUUID(),
        now: () => 201,
      });

      const reopened = await authority.open("legacy-update-session");
      expect(projectSessionTreeMessages(reopened!.state)[0]?.parts[0]).toMatchObject({
        type: "text",
        text: "legacy final",
      });

      const next = appendFinalizedDurableAssistantMessage(reopened!.state, continued);
      expect(next.entries.filter((entry) => entry.type === "message_update")).toHaveLength(1);
      expect(next.entries.at(-1)).toMatchObject({
        type: "assistant_message",
        messageId: "new-finalized-assistant",
      });
      await authority.commit({ sessionId: "legacy-update-session", state: next });

      const projected = projectDurableSessionMessages(next);
      expect(projected.map((message) => message.id)).toEqual([
        "legacy-assistant",
        "new-finalized-assistant",
      ]);
      expect((projected[0]?.parts[0] as any).text).toBe("legacy final");
    } finally {
      await store.close();
      await removeTemporaryRoot(root);
    }
  });
});
