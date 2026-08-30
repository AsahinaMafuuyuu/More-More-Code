import { describe, expect, test } from "bun:test";
import type { SessionTreeState } from "@more-more-code/harness";
import { runDurableSessionTurn } from "../src/lib/durable-session-turn";

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  parts: [{ type: "text"; text: string }];
};

type SessionTree = SessionTreeState<TestMessage>;

type DurableSessionTurnInput = {
  authority: {
    commit(...args: unknown[]): Promise<unknown>;
  };
  sessionId: string;
  state: SessionTree;
  userText: string;
  selection: {
    mode: "PLAN" | "BUILD";
    model: { providerId: string; modelId: string };
  };
  inputMessageId: string;
  runAgent: (...args: unknown[]) => Promise<unknown>;
};

const durableTurn = runDurableSessionTurn as unknown as (
  input: DurableSessionTurnInput,
) => Promise<unknown>;

function initialTree(): SessionTree {
  return {
    version: 3,
    rootEntryId: "durable-root",
    activeEntryId: "durable-root",
    entries: [{
      id: "durable-root",
      parentId: null,
      createdAt: 1,
      type: "session_start",
    }],
  };
}

function stateFromCommitArgs(args: readonly unknown[]) {
  for (const argument of args) {
    if (!argument || typeof argument !== "object") continue;
    if ("state" in argument && (argument as { state?: unknown }).state) {
      return (argument as { state: SessionTree }).state;
    }
    if ("entries" in argument && "activeEntryId" in argument) {
      return argument as SessionTree;
    }
  }
  return null;
}

function stateFromAgentArgs(args: readonly unknown[]) {
  for (const argument of args) {
    if (!argument || typeof argument !== "object") continue;
    if ("state" in argument && (argument as { state?: unknown }).state) {
      return (argument as { state: SessionTree }).state;
    }
    if ("entries" in argument && "activeEntryId" in argument) {
      return argument as SessionTree;
    }
  }
  return null;
}

const userMessage: TestMessage = {
  id: "durable-user-message",
  role: "user",
  parts: [{ type: "text", text: "run after commit" }],
};

describe("durable local Session turn orchestration", () => {
  test("commits the generated user_message before running the AgentLoop", async () => {
    const order: string[] = [];
    let committedState: SessionTree | null = null;
    let agentState: SessionTree | null = null;

    const result = await durableTurn({
      authority: {
        async commit(...args) {
          order.push("commit");
          committedState = stateFromCommitArgs(args);
          return { state: committedState };
        },
      },
      sessionId: "durable-session",
      state: initialTree(),
      userText: userMessage.parts[0].text,
      selection: {
        mode: "BUILD",
        model: { providerId: "custom-test", modelId: "offline-model" },
      },
      inputMessageId: userMessage.id,
      async runAgent(...args) {
        order.push("agent");
        agentState = stateFromAgentArgs(args);
        return "agent-result";
      },
    });

    expect(result).toBeDefined();
    expect(order).toEqual(["commit", "agent"]);
    const committed = committedState as unknown as SessionTree;
    expect(committed.entries.at(-1)).toMatchObject({
      type: "user_message",
      messageId: "durable-user-message",
      message: userMessage,
    });
    expect(agentState as unknown as SessionTree).toEqual(committed);
  });

  test("does not invoke AgentLoop/model/tool execution when the local commit fails", async () => {
    const order: string[] = [];
    let agentCalls = 0;
    let modelCalls = 0;
    let toolCalls = 0;

    await expect(durableTurn({
      authority: {
        async commit() {
          order.push("commit");
          throw new Error("local commit failed");
        },
      },
      sessionId: "durable-session",
      state: initialTree(),
      userText: userMessage.parts[0].text,
      selection: {
        mode: "BUILD",
        model: { providerId: "custom-test", modelId: "offline-model" },
      },
      inputMessageId: userMessage.id,
      async runAgent() {
        order.push("agent");
        agentCalls += 1;
        modelCalls += 1;
        toolCalls += 1;
      },
    })).rejects.toThrow("local commit failed");

    expect(order).toEqual(["commit"]);
    expect(agentCalls).toBe(0);
    expect(modelCalls).toBe(0);
    expect(toolCalls).toBe(0);
  });
});
