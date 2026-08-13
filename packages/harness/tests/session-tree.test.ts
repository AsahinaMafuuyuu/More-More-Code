import { describe, expect, test } from "bun:test";
import {
  appendSessionEntry,
  appendSessionTreeMessages,
  createSessionTree,
  getActiveSessionEntry,
  getParentSessionEntry,
  jumpToSessionEntry,
  projectSessionEntryPath,
  projectSessionRuntimeState,
  projectSessionTreeMessages,
  restoreSessionTree,
} from "../src";

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

function message(
  id: string,
  role: TestMessage["role"] = id.startsWith("a") ? "assistant" : "user",
  text = id,
): TestMessage {
  return { id, role, text };
}

function deterministicOptions() {
  let id = 0;
  let now = 100;
  return {
    createId: () => `id-${++id}`,
    now: () => ++now,
  };
}

describe("session entry tree v3", () => {
  test("stores each durable semantic event as one branchable entry", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([
      message("u0"),
      message("a0"),
    ], options);

    state = appendSessionEntry(state, {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "read_file",
      input: { path: "README.md" },
    }, options);
    state = appendSessionEntry(state, {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "read_file",
      output: "contents",
    }, options);
    state = appendSessionEntry(state, {
      type: "compaction",
      summary: "Earlier context summary",
      retainedTailMessageIds: ["u0", "a0"],
    }, options);

    expect(state.version).toBe(3);
    expect(state.entries.map((entry) => entry.type)).toEqual([
      "session_start",
      "user_message",
      "assistant_message",
      "tool_call",
      "tool_result",
      "compaction",
    ]);
    expect(projectSessionTreeMessages(state)).toEqual([
      message("u0"),
      message("a0"),
    ]);
    expect(projectSessionEntryPath(state).at(-1)?.type).toBe("compaction");
  });

  test("jumping to an ancestor and appending creates an independent sibling branch", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    state = appendSessionTreeMessages(state, [message("u1"), message("a1")], {}, options);
    const branchPoint = state.activeEntryId;

    state = appendSessionTreeMessages(
      state,
      [message("u1"), message("a1"), message("u2"), message("a2")],
      {},
      options,
    );
    const leftLeaf = state.activeEntryId;

    state = jumpToSessionEntry(state, branchPoint);
    state = appendSessionTreeMessages(
      state,
      [message("u1"), message("a1"), message("u2b"), message("a2b")],
      {},
      options,
    );
    const rightLeaf = state.activeEntryId;

    expect(state.entries.filter((entry) => entry.parentId === branchPoint)).toHaveLength(2);
    expect(getParentSessionEntry(state)?.id).not.toBe(branchPoint);
    expect(projectSessionTreeMessages(state, rightLeaf).map((entry) => entry.id)).toEqual([
      "u1", "a1", "u2b", "a2b",
    ]);
    expect(projectSessionTreeMessages(state, leftLeaf).map((entry) => entry.id)).toEqual([
      "u1", "a1", "u2", "a2",
    ]);
  });

  test("records immutable message_update entries instead of mutating a prior message", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([
      message("u1"),
      message("a1", "assistant", "draft"),
    ], options);
    const assistantEntry = getActiveSessionEntry(state);

    state = appendSessionTreeMessages(
      state,
      [
        message("u1"),
        message("a1", "assistant", "final"),
        message("u2"),
      ],
      {},
      options,
    );

    expect(assistantEntry.type).toBe("assistant_message");
    expect(state.entries.map((entry) => entry.type)).toEqual([
      "session_start",
      "user_message",
      "assistant_message",
      "message_update",
      "user_message",
    ]);
    expect(projectSessionTreeMessages(state)).toEqual([
      message("u1"),
      message("a1", "assistant", "final"),
      message("u2"),
    ]);
  });

  test("projects model, mode, and config state independently from chat messages", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([message("u1")], options);
    state = appendSessionEntry(state, {
      type: "model_change",
      model: "gpt-5.6-sol",
      provider: "openai",
    }, options);
    state = appendSessionEntry(state, {
      type: "mode_change",
      mode: "BUILD",
    }, options);
    state = appendSessionEntry(state, {
      type: "config_change",
      key: "reasoningEffort",
      value: "xhigh",
    }, options);

    expect(projectSessionRuntimeState(state)).toEqual({
      model: "gpt-5.6-sol",
      provider: "openai",
      mode: "BUILD",
      config: { reasoningEffort: "xhigh" },
    });
    expect(projectSessionTreeMessages(state)).toEqual([message("u1")]);
  });

  test("state changes are branch-local and restored by the active entry", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    state = appendSessionEntry(state, { type: "model_change", model: "model-a" }, options);
    const modelAEntry = state.activeEntryId;
    state = appendSessionEntry(state, { type: "mode_change", mode: "BUILD" }, options);
    const buildLeaf = state.activeEntryId;

    state = jumpToSessionEntry(state, modelAEntry);
    state = appendSessionEntry(state, { type: "model_change", model: "model-b" }, options);
    const modelBLeaf = state.activeEntryId;

    expect(projectSessionRuntimeState(state, buildLeaf)).toEqual({
      model: "model-a",
      provider: undefined,
      mode: "BUILD",
      config: {},
    });
    expect(projectSessionRuntimeState(state, modelBLeaf)).toEqual({
      model: "model-b",
      provider: undefined,
      mode: undefined,
      config: {},
    });
  });

  test("restores legacy linear message arrays as v3 message entries", () => {
    const restored = restoreSessionTree<TestMessage>(
      [message("u1"), message("a1")],
      deterministicOptions(),
    );

    expect(restored.version).toBe(3);
    expect(restored.entries.map((entry) => entry.type)).toEqual([
      "session_start", "user_message", "assistant_message",
    ]);
    expect(projectSessionTreeMessages(restored)).toEqual([
      message("u1"), message("a1"),
    ]);
  });

  test("upgrades v1 per-node snapshots without losing branches", () => {
    const legacy = {
      version: 1,
      rootNodeId: "root",
      activeNodeId: "left",
      nodes: [
        { id: "root", parentId: null, createdAt: 1, messages: [message("u1"), message("a1")] },
        {
          id: "left",
          parentId: "root",
          createdAt: 2,
          messages: [message("u1"), message("a1"), message("u2"), message("a2")],
        },
        {
          id: "right",
          parentId: "root",
          createdAt: 3,
          messages: [message("u1"), message("a1"), message("u2b"), message("a2b")],
        },
      ],
    };

    const restored = restoreSessionTree<TestMessage>(legacy, deterministicOptions());
    expect(restored.version).toBe(3);
    expect(projectSessionTreeMessages(restored).map((entry) => entry.id)).toEqual([
      "u1", "a1", "u2", "a2",
    ]);

    const branchPoint = restored.entries.find(
      (entry) => entry.type === "assistant_message" && entry.messageId === "a1",
    );
    expect(branchPoint).toBeDefined();
    const branchChildren = restored.entries.filter((entry) => entry.parentId === branchPoint!.id);
    expect(branchChildren).toHaveLength(2);
  });

  test("upgrades v2 event-backed checkpoints and preserves branch-local message revisions", () => {
    const v2 = {
      version: 2,
      rootNodeId: "root",
      activeNodeId: "right",
      nodes: [
        { id: "root", parentId: null, createdAt: 1, eventIds: ["e1", "e2"] },
        { id: "left", parentId: "root", createdAt: 2, eventIds: ["e3", "e4"] },
        { id: "right", parentId: "root", createdAt: 3, eventIds: ["e5", "e6"] },
      ],
      events: [
        { id: "e1", nodeId: "root", kind: "message-upsert", messageId: "u1", createdAt: 1, message: message("u1") },
        { id: "e2", nodeId: "root", kind: "message-upsert", messageId: "a1", createdAt: 1, message: message("a1", "assistant", "draft") },
        { id: "e3", nodeId: "left", kind: "message-upsert", messageId: "a1", createdAt: 2, message: message("a1", "assistant", "left-final") },
        { id: "e4", nodeId: "left", kind: "message-upsert", messageId: "u2", createdAt: 2, message: message("u2") },
        { id: "e5", nodeId: "right", kind: "message-upsert", messageId: "a1", createdAt: 3, message: message("a1", "assistant", "right-final") },
        { id: "e6", nodeId: "right", kind: "message-upsert", messageId: "u2b", createdAt: 3, message: message("u2b") },
      ],
    };

    const restored = restoreSessionTree<TestMessage>(v2, deterministicOptions());
    expect(restored.version).toBe(3);
    expect(projectSessionTreeMessages(restored)).toEqual([
      message("u1"),
      message("a1", "assistant", "right-final"),
      message("u2b"),
    ]);

    const leftRevision = restored.entries.find(
      (entry) => entry.type === "message_update"
        && entry.messageId === "a1"
        && entry.message.text === "left-final",
    );
    expect(leftRevision).toBeDefined();
    expect(projectSessionTreeMessages(restored, leftRevision!.id)).toEqual([
      message("u1"),
      message("a1", "assistant", "left-final"),
    ]);
  });
});
