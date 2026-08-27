import type { ManualContextCompactionOutcome } from "../../../lib/local-model-transport";

export type ManualCompactionNotice = {
  variant?: "success";
  message: string;
};

export function formatManualCompactionOutcome(
  result: ManualContextCompactionOutcome,
): ManualCompactionNotice {
  const usage = `${result.inputTokensBefore} → ${result.inputTokensAfter} / ${result.inputBudgetTokens} tokens`;
  const pruning = result.toolResultPruning.prunedResults > 0
    ? `; pruned ${result.toolResultPruning.prunedResults} tool result(s)`
    : "";
  const fallback = result.fallbackUsed
    ? `; deterministic fallback (${result.fallbackReason ?? "unknown"})`
    : "";

  if (result.status === "noop") {
    const eligibility = result.eligibility;
    const reason = (() => {
      switch (result.reason) {
        case "insufficient-history":
          return `Manual compaction skipped: ${eligibility.compactableTokens} compactable tokens; requires at least ${eligibility.minCompactableTokens}`;
        case "recent-compaction":
          return `Manual compaction skipped: checkpoint is still recent (${eligibility.newTurnsSinceCheckpoint} new turn(s), ${eligibility.compactableTokens} compactable tokens; requires at least ${eligibility.minNewTurnsSinceCheckpoint} turn(s) and ${eligibility.minCompactableTokens} tokens)`;
        case "insufficient-gain":
          return `Manual compaction skipped: estimated savings ${eligibility.estimatedGainTokens} tokens (${Math.round(eligibility.estimatedGainRatio * 100)}%); requires at least ${eligibility.minEstimatedGainTokens} tokens and ${Math.round(eligibility.minEstimatedGainRatio * 100)}%`;
        case "compactor-unavailable":
          return "Manual compaction skipped: compactor did not produce a valid replacement checkpoint";
        default:
          return "Nothing safely compactable";
      }
    })();
    return {
      message: `${reason} (${result.reason ?? "no-op"}); ${usage}${pruning}${fallback}`,
    };
  }

  return {
    variant: "success",
    message: `Manual context compaction complete (trigger=manual); ${usage}${pruning}${fallback}`,
  };
}
