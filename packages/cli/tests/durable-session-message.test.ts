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
  appendFinalizedDurableAssistantStep,
  appendFinalizedDurableAssistantMessage,
  appendDurableSessionMessages,
  normalizeDurableMessage,
  normalizeDurableMessages,
  projectDurableSessionMessages,
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

  test("persists one finalized assistant message without creating message_update", () => {
    let nextId = 0;
    const options: SessionTreeOptions<Message> = {
      createId: () => `final-entry-${nextId += 1}`,
      now: () => nextId,
    };
    const initial = createSessionTree<Message>([], options);
    const final = assistantMessage({ providerMetadata: undefined });

    const first = appendFinalizedDurableAssistantMessage(initial, final, {}, options);
    const second = appendFinalizedDurableAssistantMessage(first, final);

    expect(first.entries.map((entry) => entry.type)).toEqual([
      "session_start",
      "assistant_message",
    ]);
    expect(first.entries.some((entry) => entry.type === "message_update")).toBe(false);
    expect(second).toBe(first);
  });

  test("fails closed instead of revising an already-finalized assistant entry", () => {
    const initial = createSessionTree<Message>([]);
    const first = appendFinalizedDurableAssistantMessage(initial, assistantMessage());
    const changed = {
      ...assistantMessage(),
      parts: [{ type: "text", text: "changed", state: "done" }],
    } as Message;

    expect(() => appendFinalizedDurableAssistantMessage(first, changed)).toThrow(
      "already exists with different content",
    );
  });

  test("persists two Tool-continuation model steps even when AI SDK reuses one UIMessage id", () => {
    let nextId = 0;
    const options: SessionTreeOptions<Message> = {
      createId: () => `step-entry-${nextId += 1}`,
      now: () => nextId,
    };
    let state = createSessionTree<Message>([], options);
    const aggregateStepOne = {
      id: "shared-ai-sdk-message",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-bash",
          toolCallId: "call-1",
          state: "input-available",
          input: { command: "echo first" },
        } as never,
      ],
    } as Message;

    state = appendFinalizedDurableAssistantStep(
      state,
      aggregateStepOne,
      { runId: "run-1", turnId: "turn-1", stepId: "step-1" },
      options,
    );
    state = appendSessionEntry(state, {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "echo first" },
    }, options);
    state = appendSessionEntry(state, {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "bash",
      status: "completed",
      output: { stdout: "first\n" },
    }, options);

    const aggregateStepTwo = {
      id: "shared-ai-sdk-message",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-bash",
          toolCallId: "call-1",
          state: "output-available",
          input: { command: "echo first" },
          output: { stdout: "first\n" },
        } as never,
        { type: "step-start" },
        { type: "text", text: "second model step", state: "done" },
      ],
    } as Message;

    state = appendFinalizedDurableAssistantStep(
      state,
      aggregateStepTwo,
      { runId: "run-1", turnId: "turn-2", stepId: "step-2" },
      options,
    );

    const assistantMessageIds = state.entries.flatMap((entry) => (
      entry.type === "assistant_message" ? [entry.messageId] : []
    ));
    expect(assistantMessageIds).toHaveLength(2);
    expect(assistantMessageIds).toEqual([
      "assistant-step:step-1",
      "assistant-step:step-2",
    ]);
    expect(state.entries.some((entry) => entry.type === "message_update")).toBe(false);
    expect(projectSessionTreeMessages(state).map((message) => ({
      id: message.id,
      parts: message.parts,
    }))).toEqual([
      {
        id: "assistant-step:step-1",
        parts: [expect.objectContaining({
          type: "tool-bash",
          toolCallId: "call-1",
          state: "input-available",
        })],
      },
      {
        id: "assistant-step:step-2",
        parts: [{ type: "text", text: "second model step", state: "done" }],
      },
    ]);
  });

  test("same durable Model Step id remains immutable", () => {
    const initial = createSessionTree<Message>([]);
    const first = appendFinalizedDurableAssistantStep(
      initial,
      assistantMessage(),
      { stepId: "same-step" },
    );
    const changed = {
      ...assistantMessage(),
      parts: [{ type: "text", text: "changed", state: "done" }],
    } as Message;

    expect(() => appendFinalizedDurableAssistantStep(
      first,
      changed,
      { stepId: "same-step" },
    )).toThrow("already exists with different content");
  });

  test("derives Tool terminal state without mutating canonical message or result facts", () => {
    const assistant = {
      id: "assistant-tool-projection",
      role: "assistant",
      parts: [{
        type: "tool-bash",
        toolCallId: "projection-tool",
        state: "input-available",
        input: { command: "echo projected" },
      } as never],
    } as Message;
    let state = createSessionTree<Message>([assistant]);
    state = appendSessionEntry(state, {
      type: "tool_call",
      toolCallId: "projection-tool",
      toolName: "bash",
      input: { command: "echo projected" },
    });
    state = appendSessionEntry(state, {
      type: "tool_result",
      toolCallId: "projection-tool",
      toolName: "bash",
      status: "completed",
      output: { stdout: "projected\n" },
    });
    const canonicalBefore = structuredClone(state);

    const first = projectDurableSessionMessages(state);
    const second = projectDurableSessionMessages(state);

    expect(first).toEqual(second);
    expect(first[0]?.parts[0]).toMatchObject({
      toolCallId: "projection-tool",
      state: "output-available",
      output: { stdout: "projected\n" },
    });
    expect(state).toEqual(canonicalBefore);
    expect((state.entries[1] as any).message.parts[0]).not.toHaveProperty("output");
  });

  test("fails closed when canonical Tool facts cannot form one valid continuation", () => {
    let orphan = createSessionTree<Message>([assistantMessage()]);
    orphan = appendSessionEntry(orphan, {
      type: "tool_result",
      toolCallId: "orphan-tool",
      toolName: "bash",
      status: "completed",
      output: "unexpected",
    });
    expect(() => projectDurableSessionMessages(orphan)).toThrow("Orphan tool_result orphan-tool");

    const toolMessage = {
      id: "assistant-duplicate-tool",
      role: "assistant",
      parts: [{
        type: "tool-bash",
        toolCallId: "duplicate-tool",
        state: "input-available",
        input: { command: "echo duplicate" },
      } as never],
    } as Message;
    let duplicate = createSessionTree<Message>([toolMessage]);
    duplicate = appendSessionEntry(duplicate, {
      type: "tool_call",
      toolCallId: "duplicate-tool",
      toolName: "bash",
      input: { command: "echo duplicate" },
    });
    duplicate = appendSessionEntry(duplicate, {
      type: "tool_result",
      toolCallId: "duplicate-tool",
      toolName: "bash",
      status: "completed",
      output: "first",
    });
    duplicate = appendSessionEntry(duplicate, {
      type: "tool_result",
      toolCallId: "duplicate-tool",
      toolName: "bash",
      status: "completed",
      output: "second",
    });
    expect(() => projectDurableSessionMessages(duplicate)).toThrow(
      "Duplicate terminal tool_result duplicate-tool",
    );
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
