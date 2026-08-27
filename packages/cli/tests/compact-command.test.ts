import { describe, expect, test } from "bun:test";
import { formatManualCompactionOutcome } from "../src/ui/session/command/manual-compaction-presentation";

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

function outcome(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  } as never;
}

describe("manual compact presentation", () => {
  test("reports token reduction and Tool Result pruning", () => {
    const notice = formatManualCompactionOutcome(outcome());
    expect(notice.variant).toBe("success");
    expect(notice.message).toContain("8000 → 3200 / 10000 tokens");
    expect(notice.message).toContain("pruned 2 tool result(s)");
  });

  test("surfaces typed no-op and deterministic fallback outcomes", () => {
    const notice = formatManualCompactionOutcome(outcome({
      status: "noop",
      reason: "nothing-compactable",
      eligibility: eligibility({ eligible: false, compactableTokens: 0, estimatedGainTokens: 0, estimatedGainRatio: 0 }),
      fallbackUsed: true,
      fallbackReason: "reducer-error",
      inputTokensBefore: 1_200,
      inputTokensAfter: 1_200,
      toolResultPruning: { budgetTokens: 2_500, originalTokens: 0, projectedTokens: 0, prunedResults: 0, overBudget: false },
    }));
    expect(notice.message).toContain("Nothing safely compactable (nothing-compactable)");
    expect(notice.message).toContain("deterministic fallback (reducer-error)");
  });

  test("explains recent checkpoint and low-gain eligibility failures", () => {
    const recent = formatManualCompactionOutcome(outcome({
      status: "noop",
      reason: "recent-compaction",
      eligibility: eligibility({ eligible: false, hasPreviousCheckpoint: true, compactableTokens: 2_200, newTurnsSinceCheckpoint: 1, minCompactableTokens: 3_000 }),
    }));
    expect(recent.message).toContain("1 new turn(s)");
    expect(recent.message).toContain("requires at least 2 turn(s) and 3000 tokens");

    const gain = formatManualCompactionOutcome(outcome({
      status: "noop",
      reason: "insufficient-gain",
      eligibility: eligibility({ eligible: false, estimatedGainTokens: 500, estimatedGainRatio: 0.125, minEstimatedGainTokens: 2_000 }),
    }));
    expect(gain.message).toContain("estimated savings 500 tokens (13%)");
    expect(gain.message).toContain("requires at least 2000 tokens and 30%");
  });
});
