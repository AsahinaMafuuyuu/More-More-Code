import { describe, expect, test } from "bun:test";
import {
  appendSessionEntry,
  appendSessionTreeMessages,
  createSessionTree,
  projectSessionTreeMessages,
  type SessionTreeOptions,
} from "@more-more-code/harness";
import type { Message } from "../src/lib/chat-types";
import {
  appendDurableSessionMessages,
  normalizeDurableMessage,
  normalizeDurableMessages,
} from "../src/lib/durable-session-message";

function assistantMessage(partOverrides: Record<string, unknown> = {}): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "text",
      text: "hello",
      state: "done",
      ...partOverrides,
    }],
  } as Message;
}

function firstPart(message: Message): Record<string, unknown> {
  return message.parts[0] as unknown as Record<string, unknown>;
}

describe("durable Session message normalization", () => {
  test("omits object undefined without mutating the runtime message", () => {
    const runtime = assistantMessage({ providerMetadata: undefined });
    const originalPart = firstPart(runtime);
    expect(Object.prototype.hasOwnProperty.call(originalPart, "providerMetadata")).toBe(true);

    const durable = normalizeDurableMessage(runtime);

    expect(Object.prototype.hasOwnProperty.call(firstPart(durable), "providerMetadata")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(originalPart, "providerMetadata")).toBe(true);
    expect(originalPart.providerMetadata).toBeUndefined();
    expect(durable).not.toBe(runtime);
    expect(durable.parts).not.toBe(runtime.parts);
  });

  test("recursively omits object undefined and preserves array positions as null", () => {
    const sparse = new Array(3);
    sparse[0] = "a";
    sparse[2] = "b";
    const runtime = assistantMessage({
      providerMetadata: {
        provider: {
          keep: 1,
          omit: undefined,
          nested: { omitToo: undefined, keepToo: true },
          values: ["a", undefined, "b"],
          sparse,
        },
      },
    });

    const durable = normalizeDurableMessage(runtime);
    expect(firstPart(durable).providerMetadata).toEqual({
      provider: {
        keep: 1,
        nested: { keepToo: true },
        values: ["a", null, "b"],
        sparse: ["a", null, "b"],
      },
    });
    expect((firstPart(runtime).providerMetadata as any).provider.omit).toBeUndefined();
    expect(1 in sparse).toBe(false);
  });

  test("preserves JSON-safe Provider metadata", () => {
    const runtime = assistantMessage({
      providerMetadata: {
        openai: {
          itemId: "item-1",
          nested: { enabled: true, score: 1.25, empty: null },
        },
      },
    });

    expect(firstPart(normalizeDurableMessage(runtime)).providerMetadata).toEqual(
      firstPart(runtime).providerMetadata,
    );
  });

  test("keeps an own __proto__ key as data without prototype mutation", () => {
    const metadata: Record<string, unknown> = { safe: true };
    Object.defineProperty(metadata, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const runtime = assistantMessage({ providerMetadata: { provider: metadata } });

    const durable = normalizeDurableMessage(runtime);
    const provider = (firstPart(durable).providerMetadata as any).provider;

    expect(Object.prototype.hasOwnProperty.call(provider, "__proto__")).toBe(true);
    expect(provider.__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(provider)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
  });

  test("rejects unsupported JavaScript values instead of coercing them", () => {
    class CustomValue {}
    const symbolKeyed = { ok: true } as Record<PropertyKey, unknown>;
    symbolKeyed[Symbol("hidden")] = "no";
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const invalidValues: unknown[] = [
      NaN,
      Infinity,
      -Infinity,
      1n,
      () => "no",
      Symbol("no"),
      symbolKeyed,
      cyclic,
      new Date(),
      new Map(),
      new Set(),
      new CustomValue(),
    ];

    for (const invalid of invalidValues) {
      const runtime = assistantMessage({ providerMetadata: { provider: invalid } });
      expect(() => normalizeDurableMessage(runtime)).toThrow();
    }
  });

  test("normalizes a message collection independently", () => {
    const first = assistantMessage({ providerMetadata: undefined });
    const second = {
      ...assistantMessage({ providerMetadata: { provider: { ok: true } } }),
      id: "assistant-2",
    } as Message;

    const durable = normalizeDurableMessages([first, second]);

    expect(durable).toHaveLength(2);
    expect(Object.prototype.hasOwnProperty.call(firstPart(durable[0]!), "providerMetadata")).toBe(false);
    expect(firstPart(durable[1]!).providerMetadata).toEqual({ provider: { ok: true } });
  });

  test("re-sync is idempotent when runtime differs only by explicit undefined", () => {
    let nextId = 0;
    const options: SessionTreeOptions<Message> = {
      createId: () => `entry-${nextId += 1}`,
      now: () => nextId,
    };
    const initial = createSessionTree<Message>([], options);
    const runtime = assistantMessage({ providerMetadata: undefined });
    const first = appendDurableSessionMessages(initial, [runtime], {}, options);
    const restored = projectSessionTreeMessages(first);
    const equivalentRuntime = assistantMessage({ providerMetadata: undefined });
    const second = appendDurableSessionMessages(first, [equivalentRuntime], {}, options);

    expect(restored).toHaveLength(1);
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(first.entries.length);
    expect(second.activeEntryId).toBe(first.activeEntryId);

    // The raw Harness path remains strict/unsafe for runtime objects; the CLI
    // adapter is the intended semantic boundary.
    const raw = appendSessionTreeMessages(initial, [runtime], {}, options);
    expect(firstPart(projectSessionTreeMessages(raw)[0]!).providerMetadata).toBeUndefined();
  });

  test("supports compaction pre-sync as one normalized Session transition", () => {
    let nextId = 0;
    const options: SessionTreeOptions<Message> = {
      createId: () => `compaction-entry-${nextId += 1}`,
      now: () => nextId,
    };
    const initial = createSessionTree<Message>([], options);
    const runtime = assistantMessage({ providerMetadata: undefined });

    const compacted = appendSessionEntry(
      appendDurableSessionMessages(initial, [runtime], {}, options),
      {
        type: "compaction",
        summary: "checkpoint",
        trigger: "soft-limit",
        inputTokensBefore: 900,
        inputTokensAfter: 500,
        compactedMessageIds: ["assistant-1"],
        retainedTailMessageIds: [],
      },
      options,
    );

    expect(compacted.entries.map((entry) => entry.type)).toEqual([
      "session_start",
      "assistant_message",
      "compaction",
    ]);
    expect(Object.prototype.hasOwnProperty.call(
      firstPart(projectSessionTreeMessages(compacted)[0]!),
      "providerMetadata",
    )).toBe(false);
    expect(compacted.entries.at(-1)).toMatchObject({
      type: "compaction",
      summary: "checkpoint",
      trigger: "soft-limit",
      inputTokensBefore: 900,
      inputTokensAfter: 500,
    });
  });
});
