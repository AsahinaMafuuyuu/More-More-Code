import { describe, expect, test } from "bun:test";
import {
  createHeuristicTokenCounter,
  type ContextCompactor,
  type ModelContextProfile,
} from "@more-more-code/harness";
import { projectMessages } from "../src/lib/local-model-transport";
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
});
