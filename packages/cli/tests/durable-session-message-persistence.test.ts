import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectSessionTreeMessages } from "@more-more-code/harness";
import { bootstrapLocalSessionStore } from "../../session-store/src";
import type { Message } from "../src/lib/chat-types";
import { appendDurableSessionMessages } from "../src/lib/durable-session-message";
import { createLocalSessionAuthority } from "../src/lib/local-session-authority";

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
      const next = appendDurableSessionMessages(created.state, [
        undefinedRuntime,
        metadataRuntime,
      ]);
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
      await Bun.sleep(500);
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});
