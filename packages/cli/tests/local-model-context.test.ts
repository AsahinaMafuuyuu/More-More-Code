import { describe, expect, test } from "bun:test";
import {
  createHeuristicTokenCounter,
  type ContextCompactor,
  type ModelContextProfile,
} from "@more-more-code/harness";
import {
  projectCurrentContextUsage,
  projectMessages,
} from "../src/lib/local-model-transport";
import type { Message } from "../src/lib/chat-types";

const tokenCounter = createHeuristicTokenCounter({
  id: "local-context-test",
  latinCharsPerToken: 4,
  cjkCharsPerToken: 1.5,
  structuralOverheadTokens: 1,
});

function profile(overrides: Partial<ModelContextProfile> = {}): ModelContextProfile {
  return {
    contextWindowTokens: 10_000,
    reservedOutputTokens: 0,
    safetyMarginTokens: 0,
    retainedTailTurns: 2,
    maxSummaryTokens: 200,
    compactionSoftLimitRatio: 0.8,
    compactionHardLimitRatio: 0.92,
    postCompactionTargetRatio: 0.7,
    toolResultWorkingSetRatio: 0.25,
    toolResultFullThresholdRatio: 0.06,
    toolResultReferenceRatio: 0.006,
    tokenCounter,
    ...overrides,
  };
}

function user(id: string, text: string): Message {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantTool(input: {
  id: string;
  toolCallId: string;
  command: string;
  output: unknown;
  text?: string;
}): Message {
  return {
    id: input.id,
    role: "assistant",
    parts: [
      ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
      {
        type: "tool-bash",
        toolCallId: input.toolCallId,
        state: "output-available",
        input: { command: input.command },
        output: input.output,
      } as never,
    ],
  };
}

function countingCompactor(state: { calls: number }): ContextCompactor<Message> {
  return {
    compact({ targetTokens }) {
      state.calls += 1;
      if (targetTokens < 10) return null;
      return {
        id: `summary-${state.calls}`,
        kind: "summary",
        payload: {
          id: `summary-message-${state.calls}`,
          role: "assistant",
          parts: [{ type: "text", text: "bounded semantic snapshot" }],
        },
        estimatedTokens: Math.min(10, targetTokens),
      };
    },
  };
}

describe("local model context reduction pipeline", () => {
  test("current Context observability reuses the canonical checkpoint/pruning budget without Provider work", async () => {
    const state = { calls: 0 };
    const messages = [
      assistantTool({
        id: "old-tool",
        toolCallId: "old-tool-call",
        command: "git status",
        output: { stdout: "noise\n".repeat(2_000), stderr: "", exitCode: 0 },
      }),
      user("u-current", "continue"),
      { id: "a-current", role: "assistant" as const, parts: [{ type: "text" as const, text: "ready" }] },
    ];
    const checkpoint = {
      summary: {
        id: "checkpoint",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "prior state" }],
      },
      compactedRecordIds: [] as string[],
      retainedTailRecordIds: ["u-current", "a-current"],
    };
    const currentProfile = profile({
      compactionSoftLimitRatio: 0.99,
      compactionHardLimitRatio: 1,
    });
    const actual = await projectMessages({
      messages,
      systemPrompt: "system",
      profile: currentProfile,
      checkpoint,
      compactor: countingCompactor(state),
    });
    const observed = projectCurrentContextUsage({
      messages,
      systemPrompt: "system",
      profile: currentProfile,
      checkpoint,
    });

    expect(state.calls).toBe(0);
    expect(observed.estimatedInputTokens).toBe(actual.projection.estimatedInputTokens);
    expect(observed.inputBudgetTokens).toBe(actual.projection.inputBudgetTokens);
    expect(observed.contextWindowTokens).toBe(currentProfile.contextWindowTokens);
    expect(observed.tokenCounterId).toBe(tokenCounter.id);
    expect(observed.tokenCountQuality).toBe("estimated");
  });

  test("takes the no-prune/no-compaction path for a small context", async () => {
    const state = { calls: 0 };
    const result = await projectMessages({
      messages: [user("u1", "hello"), { id: "a1", role: "assistant", parts: [{ type: "text", text: "hi" }] }],
      systemPrompt: "system",
      profile: profile(),
      checkpoint: null,
      compactor: countingCompactor(state),
    });

    expect(result.toolResultPruning.prunedResults).toBe(0);
    expect(result.projection.compaction).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  test("takes the prune-only path when a warm oversized Tool Result can be reduced below the compaction threshold", async () => {
    const state = { calls: 0 };
    const messages = [
      assistantTool({
        id: "old-tool-message",
        toolCallId: "old-call",
        command: "git status",
        output: { stdout: "noise\n".repeat(2_000), stderr: "", exitCode: 0 },
      }),
      assistantTool({
        id: "fresh-tool-message",
        toolCallId: "fresh-call",
        command: "pwd",
        output: { stdout: ".", stderr: "", exitCode: 0 },
      }),
    ];
    const result = await projectMessages({
      messages,
      systemPrompt: "system",
      profile: profile(),
      checkpoint: null,
      compactor: countingCompactor(state),
    });

    expect(result.toolResultPruning.prunedResults).toBe(1);
    expect(result.toolResultPruning.projectedTokens).toBeLessThan(result.toolResultPruning.originalTokens);
    expect(result.projection.compaction).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  test("prunes Tool Results before historical compaction when both reductions are required", async () => {
    const state = { calls: 0 };
    const result = await projectMessages({
      messages: [
        user("u-old", "old requirement ".repeat(800)),
        assistantTool({
          id: "a-old",
          toolCallId: "old-call",
          command: "git status",
          text: "old implementation detail ".repeat(200),
          output: { stdout: "tool noise\n".repeat(2_000), stderr: "", exitCode: 0 },
        }),
        user("u-current", "current task"),
        assistantTool({
          id: "a-current",
          toolCallId: "current-call",
          command: "pwd",
          output: { stdout: ".", stderr: "", exitCode: 0 },
        }),
      ],
      systemPrompt: "system",
      profile: profile({
        retainedTailTurns: 1,
        compactionSoftLimitRatio: 0.4,
        compactionHardLimitRatio: 0.9,
        postCompactionTargetRatio: 0.3,
      }),
      checkpoint: null,
      compactor: countingCompactor(state),
    });

    expect(result.toolResultPruning.prunedResults).toBeGreaterThan(0);
    expect(state.calls).toBe(1);
    expect(result.projection.compaction?.compactedRecordIds).toEqual(["u-old", "a-old"]);
    expect(result.projection.compaction?.trigger).toBe("soft-limit");
  });

  test("checkpoints accumulated Tool Result pressure without rewriting old results in place", async () => {
    const state = { calls: 0 };
    const messages: Message[] = [];
    for (let index = 0; index < 8; index += 1) {
      messages.push(user(`u-${index}`, `inspect ${index}`));
      messages.push(assistantTool({
        id: `a-${index}`,
        toolCallId: `call-${index}`,
        command: `type file-${index}.txt`,
        output: { stdout: `${String(index)}-${"x".repeat(1_500)}`, stderr: "", exitCode: 0 },
      }));
    }
    const toolPressureProfile = profile({
      retainedTailTurns: 2,
      compactionSoftLimitRatio: 0.95,
      compactionHardLimitRatio: 0.99,
      postCompactionTargetRatio: 0.9,
    });
    const first = await projectMessages({
      messages,
      systemPrompt: "system",
      profile: toolPressureProfile,
      checkpoint: null,
      compactor: countingCompactor(state),
    });

    expect(first.toolResultPruning.prunedResults).toBe(0);
    expect(first.toolResultPruning.overBudget).toBe(true);
    expect(first.projection.compaction?.trigger).toBe("tool-pressure");
    expect(first.projection.compaction?.compactedRecordIds.length).toBeGreaterThan(0);
    expect(state.calls).toBe(1);

    const summaryRecord = first.projection.records.find((record) => record.kind === "summary");
    expect(summaryRecord).toBeDefined();
    const checkpoint = {
      summary: summaryRecord!.payload as Message,
      compactedRecordIds: first.projection.compaction!.compactedRecordIds,
      retainedTailRecordIds: first.projection.compaction!.retainedRecordIds,
    };
    const second = await projectMessages({
      messages,
      systemPrompt: "system",
      profile: toolPressureProfile,
      checkpoint,
      compactor: countingCompactor(state),
    });

    expect(second.toolResultPruning.originalTokens).toBeLessThan(first.toolResultPruning.originalTokens);
    expect(second.toolResultPruning.overBudget).toBe(false);
    expect(second.projection.compaction).toBeUndefined();
    expect(state.calls).toBe(1);
  });

  test("projects Branch Summary as independent historical Context without changing UI messages", async () => {
    const state = { calls: 0 };
    const messages = [
      user("u1", "target branch message"),
      { id: "a1", role: "assistant" as const, parts: [{ type: "text" as const, text: "target answer" }] },
    ];
    const result = await projectMessages({
      messages,
      systemPrompt: "system",
      profile: profile(),
      checkpoint: null,
      branchSummaries: [{
        entryId: "branch-summary-1",
        summary: "Transferred decision: preserve append-only Session history.",
        afterMessageId: "a1",
      }],
      compactor: countingCompactor(state),
    });

    const branchRecord = result.projection.records.find((record) => record.id === "branch-summary-1");
    expect(branchRecord?.kind).toBe("history");
    expect(branchRecord?.payload).toMatchObject({
      type: "branch-summary",
      entryId: "branch-summary-1",
    });
    expect(messages).toHaveLength(2);
    expect(state.calls).toBe(0);
  });

  test("does not re-project Branch Summary knowledge already absorbed by a checkpoint", async () => {
    const state = { calls: 0 };
    const result = await projectMessages({
      messages: [user("u2", "new turn")],
      systemPrompt: "system",
      profile: profile(),
      checkpoint: {
        summary: {
          id: "checkpoint",
          role: "assistant",
          parts: [{ type: "text", text: "Checkpoint already contains branch knowledge." }],
        },
        compactedRecordIds: ["branch-summary-1"],
        retainedTailRecordIds: ["u2"],
      },
      branchSummaries: [{
        entryId: "branch-summary-1",
        summary: "This must not be duplicated.",
        afterMessageId: null,
      }],
      compactor: countingCompactor(state),
    });

    expect(result.projection.records.filter((record) => record.id === "branch-summary-1")).toHaveLength(0);
    expect(result.projection.records.filter((record) => record.kind === "summary")).toHaveLength(1);
  });
});
