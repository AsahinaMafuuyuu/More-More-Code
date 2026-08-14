import { describe, expect, test } from "bun:test";
import { COMMANDS } from "../src/components/command-menu/commands";

const compactCommand = COMMANDS.find((command) => command.value === "/compact");

function eligibility(overrides: Record<string, unknown> = {}) {
  return {
    eligible: true,
    inputBudgetTokens: 10_000,
    compactableTokens: 5_000,
    replacementSourceTokens: 5_000,
    estimatedSummaryTokens: 1_000,
    estimatedGainTokens: 4_000,
    estimatedGainRatio: 0.8,
    newTurnsSinceCheckpoint: 2,
    minCompactableTokens: 2_048,
    minEstimatedGainTokens: 1_024,
    minEstimatedGainRatio: 0.3,
    minNewTurnsSinceCheckpoint: 2,
    hasPreviousCheckpoint: false,
    ...overrides,
  };
}

function context(input: {
  compact?: () => Promise<unknown>;
  messages: Array<{ variant?: string; message: string }>;
}) {
  return {
    exit() {},
    toast: {
      show(value: { variant?: string; message: string }) {
        input.messages.push(value);
      },
    },
    dialog: { open() {}, close() {} },
    navigate() {},
    mode: "BUILD",
    setMode() {},
    setModel() {},
    compact: input.compact,
  } as never;
}

describe("/compact command", () => {
  test("routes manual compaction through the runtime and reports token reduction", async () => {
    expect(compactCommand).toBeDefined();
    let calls = 0;
    const messages: Array<{ variant?: string; message: string }> = [];
    await compactCommand!.action?.(context({
      messages,
      compact: async () => {
        calls += 1;
        return {
          status: "compacted" as const,
          eligibility: eligibility(),
          fallbackUsed: false,
          inputTokensBefore: 8_000,
          inputTokensAfter: 3_200,
          inputBudgetTokens: 10_000,
          toolResultPruning: {
            budgetTokens: 2_500,
            originalTokens: 2_000,
            projectedTokens: 600,
            prunedResults: 2,
            overBudget: false,
          },
        };
      },
    }));

    expect(calls).toBe(1);
    expect(messages.at(-1)).toMatchObject({ variant: "success" });
    expect(messages.at(-1)?.message).toContain("8000 → 3200 / 10000 tokens");
    expect(messages.at(-1)?.message).toContain("pruned 2 tool result(s)");
  });

  test("surfaces typed no-op and deterministic fallback outcomes", async () => {
    const messages: Array<{ variant?: string; message: string }> = [];
    await compactCommand!.action?.(context({
      messages,
      compact: async () => ({
        status: "noop" as const,
        reason: "nothing-compactable" as const,
        eligibility: eligibility({
          eligible: false,
          compactableTokens: 0,
          estimatedGainTokens: 0,
          estimatedGainRatio: 0,
        }),
        fallbackUsed: true,
        fallbackReason: "reducer-error" as const,
        inputTokensBefore: 1_200,
        inputTokensAfter: 1_200,
        inputBudgetTokens: 10_000,
        toolResultPruning: {
          budgetTokens: 2_500,
          originalTokens: 0,
          projectedTokens: 0,
          prunedResults: 0,
          overBudget: false,
        },
      }),
    }));

    expect(messages.at(-1)?.message).toContain("Nothing safely compactable (nothing-compactable)");
    expect(messages.at(-1)?.message).toContain("deterministic fallback (reducer-error)");
  });

  test("explains recent-compaction eligibility failures", async () => {
    const messages: Array<{ variant?: string; message: string }> = [];
    await compactCommand!.action?.(context({
      messages,
      compact: async () => ({
        status: "noop" as const,
        reason: "recent-compaction" as const,
        eligibility: eligibility({
          eligible: false,
          hasPreviousCheckpoint: true,
          compactableTokens: 2_200,
          newTurnsSinceCheckpoint: 1,
          minCompactableTokens: 3_000,
        }),
        fallbackUsed: false,
        inputTokensBefore: 8_000,
        inputTokensAfter: 8_000,
        inputBudgetTokens: 100_000,
        toolResultPruning: {
          budgetTokens: 25_000,
          originalTokens: 0,
          projectedTokens: 0,
          prunedResults: 0,
          overBudget: false,
        },
      }),
    }));

    expect(messages.at(-1)?.message).toContain("checkpoint is still recent");
    expect(messages.at(-1)?.message).toContain("1 new turn(s)");
    expect(messages.at(-1)?.message).toContain("requires at least 2 turn(s) and 3000 tokens");
  });

  test("explains low-benefit manual compaction", async () => {
    const messages: Array<{ variant?: string; message: string }> = [];
    await compactCommand!.action?.(context({
      messages,
      compact: async () => ({
        status: "noop" as const,
        reason: "insufficient-gain" as const,
        eligibility: eligibility({
          eligible: false,
          estimatedGainTokens: 500,
          estimatedGainRatio: 0.125,
          minEstimatedGainTokens: 2_000,
        }),
        fallbackUsed: false,
        inputTokensBefore: 8_000,
        inputTokensAfter: 8_000,
        inputBudgetTokens: 100_000,
        toolResultPruning: {
          budgetTokens: 25_000,
          originalTokens: 0,
          projectedTokens: 0,
          prunedResults: 0,
          overBudget: false,
        },
      }),
    }));

    expect(messages.at(-1)?.message).toContain("estimated savings 500 tokens (13%)");
    expect(messages.at(-1)?.message).toContain("requires at least 2000 tokens and 30%");
  });
});
