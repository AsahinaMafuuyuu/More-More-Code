import { describe, expect, test } from "bun:test";
import type { Message } from "../src/lib/chat-types";
import { projectConversationRounds } from "../src/lib/conversation-rounds";

function user(id: string): Message {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
    metadata: {
      mode: "BUILD",
      model: { providerId: "deepseek", modelId: "deepseek-v4-flash" },
    },
  } as Message;
}

function assistant(id: string, durationMs: number, toolCallId?: string): Message {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: id },
      ...(toolCallId ? [{
        type: "tool-bash",
        toolCallId,
        state: "output-available",
        input: { command: "echo ok" },
        output: "ok",
      }] : []),
    ],
    metadata: {
      mode: "BUILD",
      model: { providerId: "deepseek", modelId: "deepseek-v4-flash" },
      durationMs,
    },
  } as Message;
}

describe("conversation round projection", () => {
  test("shows one terminal summary for a multi-step round using exact AgentRun elapsed time", () => {
    const rounds = projectConversationRounds({
      messages: [user("u1"), assistant("a1", 1_200, "tc1"), assistant("a2", 800)],
      toolUses: {
        tc1: { toolCallId: "tc1", toolName: "bash", status: "completed", durationMs: 600 },
      },
      currentRun: { inputMessageId: "u1", status: "completed", durationMs: 5_000 },
    });

    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.summary).toEqual({
      mode: "BUILD",
      modelLabel: "deepseek/deepseek-v4-flash",
      durationMs: 5_000,
    });
  });

  test("does not show the round footer while the current run is still active", () => {
    const rounds = projectConversationRounds({
      messages: [user("u1"), assistant("a1", 1_200)],
      toolUses: {},
      currentRun: { inputMessageId: "u1", status: "running" },
    });
    expect(rounds[0]?.summary).toBeNull();
  });

  test("reconstructs historical duration from model and unique tool durations", () => {
    const rounds = projectConversationRounds({
      messages: [user("u1"), assistant("a1", 1_200, "tc1"), assistant("a2", 800)],
      toolUses: {
        tc1: { toolCallId: "tc1", toolName: "bash", status: "completed", durationMs: 600 },
      },
      currentRun: null,
    });
    expect(rounds[0]?.summary?.durationMs).toBe(2_600);
  });

  test("failed user-only runs still receive one terminal round summary", () => {
    const rounds = projectConversationRounds({
      messages: [user("u1")],
      toolUses: {},
      currentRun: { inputMessageId: "u1", status: "failed", durationMs: 500 },
    });
    expect(rounds[0]?.summary?.durationMs).toBe(500);
  });
});
