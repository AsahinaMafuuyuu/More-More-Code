export type ToolResultProjectionMode = "full" | "truncated" | "summary" | "reference";

export type ToolResultFreshness = "fresh" | "warm" | "cold";

export type ToolResultPruningReason =
  | "within-budget"
  | "working-set-pressure"
  | "oversized-result"
  | "reference-eligible";

export type ToolResultProjectionCandidate<TPayload = unknown> = {
  id: string;
  toolCallId: string;
  toolName: string;
  status?: string;
  input?: unknown;
  payload: TPayload;
  estimatedTokens: number;
  freshness: ToolResultFreshness;
  /** Fresh/current observations may be marked required for their continuation step. */
  required?: boolean;
  /** Durable Session Entry identity when one is available. */
  sourceEntryId?: string;
};

export type ToolResultProjection<TPayload = unknown> = ToolResultProjectionCandidate<TPayload> & {
  mode: ToolResultProjectionMode;
  projectedPayload: TPayload;
  projectedTokens: number;
  reason: ToolResultPruningReason;
};

export type ToolResultProjectionRequest<TPayload = unknown> = {
  candidate: ToolResultProjectionCandidate<TPayload>;
  targetTokens: number;
  reason: Exclude<ToolResultPruningReason, "within-budget">;
};

export type ToolResultProjector<TPayload = unknown> = {
  project(request: ToolResultProjectionRequest<TPayload>): ToolResultProjection<TPayload>;
};

export type ToolResultWorkingSetPolicy = {
  /** Maximum share of the effective model input budget reserved for Tool Results. */
  maxWorkingSetRatio?: number;
  /** Individual warm/cold results above this share are eligible for proactive pruning. */
  fullResultRatio?: number;
  /** Minimum share used when a result must collapse to a small reference projection. */
  referenceResultRatio?: number;
};

export type ToolResultWorkingSetProjection<TPayload = unknown> = {
  results: ToolResultProjection<TPayload>[];
  budgetTokens: number;
  fullResultThresholdTokens: number;
  referenceTargetTokens: number;
  originalTokens: number;
  projectedTokens: number;
  pruned: boolean;
  /** True when the non-prunable fresh/required working set already exceeds its budget. */
  overBudget: boolean;
};

const DEFAULT_POLICY = {
  maxWorkingSetRatio: 0.25,
  fullResultRatio: 0.06,
  referenceResultRatio: 0.006,
} as const;

function assertRatio(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be greater than 0 and less than or equal to 1`);
  }
}

function assertTokens(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function fullProjection<TPayload>(
  candidate: ToolResultProjectionCandidate<TPayload>,
): ToolResultProjection<TPayload> {
  return {
    ...candidate,
    mode: "full",
    projectedPayload: candidate.payload,
    projectedTokens: candidate.estimatedTokens,
    reason: "within-budget",
  };
}

function priority(candidate: ToolResultProjectionCandidate) {
  if (candidate.required || candidate.freshness === "fresh") return 3;
  if (candidate.freshness === "warm") return 2;
  return 1;
}

/**
 * Provider-independent Tool Result working-set budgeting.
 *
 * The manager never mutates canonical Session payloads. It only decides which
 * model-facing projections should remain full and which should be reduced by a
 * caller-supplied deterministic projector.
 */
export class ToolResultWorkingSetManager<TPayload = unknown> {
  project(
    candidates: readonly ToolResultProjectionCandidate<TPayload>[],
    inputBudgetTokens: number,
    projector: ToolResultProjector<TPayload>,
    options: ToolResultWorkingSetPolicy = {},
  ): ToolResultWorkingSetProjection<TPayload> {
    assertTokens(inputBudgetTokens, "inputBudgetTokens");
    for (const candidate of candidates) {
      assertTokens(candidate.estimatedTokens, `estimatedTokens(${candidate.id})`);
    }

    const maxWorkingSetRatio = options.maxWorkingSetRatio ?? DEFAULT_POLICY.maxWorkingSetRatio;
    const fullResultRatio = options.fullResultRatio ?? DEFAULT_POLICY.fullResultRatio;
    const referenceResultRatio = options.referenceResultRatio ?? DEFAULT_POLICY.referenceResultRatio;
    assertRatio(maxWorkingSetRatio, "maxWorkingSetRatio");
    assertRatio(fullResultRatio, "fullResultRatio");
    assertRatio(referenceResultRatio, "referenceResultRatio");
    if (fullResultRatio > maxWorkingSetRatio) {
      throw new Error("fullResultRatio must be less than or equal to maxWorkingSetRatio");
    }
    if (referenceResultRatio > fullResultRatio) {
      throw new Error("referenceResultRatio must be less than or equal to fullResultRatio");
    }

    const budgetTokens = Math.floor(inputBudgetTokens * maxWorkingSetRatio);
    const fullResultThresholdTokens = Math.max(1, Math.floor(inputBudgetTokens * fullResultRatio));
    const referenceTargetTokens = Math.max(1, Math.floor(inputBudgetTokens * referenceResultRatio));
    const originalTokens = candidates.reduce((total, candidate) => total + candidate.estimatedTokens, 0);
    const nonPrunableTokens = candidates
      .filter((candidate) => candidate.required || candidate.freshness === "fresh")
      .reduce((total, candidate) => total + candidate.estimatedTokens, 0);
    const requiredWorkingSetOverBudget = nonPrunableTokens > budgetTokens;

    const results = candidates.map(fullProjection);
    const eligibleIndexes = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !candidate.required && candidate.freshness !== "fresh")
      .sort((left, right) => {
        const priorityDelta = priority(left.candidate) - priority(right.candidate);
        if (priorityDelta !== 0) return priorityDelta;
        return left.index - right.index;
      });

    const aggregatePressure = originalTokens > budgetTokens;
    const availableForEligible = Math.max(0, budgetTokens - nonPrunableTokens);
    const totalWeight = eligibleIndexes.reduce(
      (total, { candidate }) => total + (candidate.freshness === "warm" ? 2 : 1),
      0,
    );
    const weightUnit = totalWeight > 0 ? Math.floor(availableForEligible / totalWeight) : 0;

    for (const { candidate, index } of eligibleIndexes) {
      const oversized = candidate.estimatedTokens > fullResultThresholdTokens;
      if (!aggregatePressure && !oversized) continue;

      const weight = candidate.freshness === "warm" ? 2 : 1;
      const weightedTarget = Math.max(referenceTargetTokens, weightUnit * weight);
      const targetTokens = aggregatePressure
        ? Math.min(fullResultThresholdTokens, weightedTarget)
        : fullResultThresholdTokens;
      if (candidate.estimatedTokens <= targetTokens) continue;

      const reason: Exclude<ToolResultPruningReason, "within-budget"> = aggregatePressure
        ? candidate.freshness === "cold" && targetTokens <= referenceTargetTokens
          ? "reference-eligible"
          : "working-set-pressure"
        : "oversized-result";
      const projected = projector.project({ candidate, targetTokens, reason });
      assertTokens(projected.projectedTokens, `projectedTokens(${candidate.id})`);
      if (projected.projectedTokens > targetTokens) {
        throw new Error(`Tool Result projector exceeded targetTokens for ${candidate.id}`);
      }
      results[index] = projected;
    }

    const projectedTokens = results.reduce((total, result) => total + result.projectedTokens, 0);
    return {
      results,
      budgetTokens,
      fullResultThresholdTokens,
      referenceTargetTokens,
      originalTokens,
      projectedTokens,
      pruned: results.some((result) => result.mode !== "full"),
      overBudget: requiredWorkingSetOverBudget || projectedTokens > budgetTokens,
    };
  }
}
