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
  /** Observation age is diagnostic only; it must not change projection bytes. */
  freshness: ToolResultFreshness;
  /** Retained compatibility metadata; Context admission/retention is decided elsewhere. */
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
  /** Maximum share of the effective model input budget observed for Tool Results. */
  maxWorkingSetRatio?: number;
  /** Individual results above this share receive a stable bounded projection. */
  fullResultRatio?: number;
  /** Reserved compatibility floor for callers that need a tiny reference projection. */
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
  /** True when the stable projected Tool working set exceeds its aggregate budget signal. */
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

/**
 * Provider-independent Tool Result working-set budgeting.
 *
 * The manager never mutates canonical Session payloads. It only decides which
 * model-facing projections should remain full and which should be reduced by a
 * caller-supplied deterministic projector. A result's projection depends only
 * on that result and the current model profile, never on later neighboring
 * results. This keeps already-sent historical prefixes cache-stable.
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
    const results = candidates.map((candidate) => {
      if (candidate.estimatedTokens <= fullResultThresholdTokens) {
        return fullProjection(candidate);
      }

      const projected = projector.project({
        candidate,
        targetTokens: fullResultThresholdTokens,
        reason: "oversized-result",
      });
      assertTokens(projected.projectedTokens, `projectedTokens(${candidate.id})`);
      if (projected.projectedTokens > fullResultThresholdTokens) {
        throw new Error(`Tool Result projector exceeded targetTokens for ${candidate.id}`);
      }
      return projected;
    });

    const projectedTokens = results.reduce((total, result) => total + result.projectedTokens, 0);
    return {
      results,
      budgetTokens,
      fullResultThresholdTokens,
      referenceTargetTokens,
      originalTokens,
      projectedTokens,
      pruned: results.some((result) => result.mode !== "full"),
      overBudget: projectedTokens > budgetTokens,
    };
  }
}
