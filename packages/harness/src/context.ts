import { createHash } from "node:crypto";

export type ContextRecordKind = "instruction" | "history" | "summary" | "runtime";

export type ContextRecordCategory =
  | "core-instruction"
  | "global-instruction"
  | "project-instruction"
  | "skill-catalog"
  | "tool-definition"
  | "compaction-checkpoint"
  | "historical-conversation"
  | "retained-turn"
  | "runtime-continuation"
  | "current-input";

export type ContextStabilityClass = "stable" | "checkpoint" | "history" | "retained" | "dynamic";

export type ContextRecord<TPayload = unknown> = {
  id: string;
  kind: ContextRecordKind;
  payload: TPayload;
  estimatedTokens: number;
  required?: boolean;
  /** Records with the same groupId are admitted or omitted together. */
  groupId?: string;
  /**
   * Optional finer-grained semantic boundary used only by the pathological
   * split-group escape hatch. Callers must never place a Tool Call and its
   * terminal Tool Result in different split groups.
   */
  splitGroupId?: string;
  /** Provider-independent semantic position in the canonical model context. */
  category?: ContextRecordCategory;
  /** Cache stability classification; derived from category when omitted. */
  stability?: ContextStabilityClass;
  /** Deterministic tie-breaker for stable collections such as skills/tools. */
  deterministicKey?: string;
  /** Structured replacement checkpoint carried by summary records in V2. */
  checkpointV2?: CompactionCheckpointV2;
  /** Deterministically extracted facts that a replacement checkpoint should preserve. */
  requiredAnchors?: RequiredContextAnchor[];
};

export type ContextBudget = {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens?: number;
};

export type ContextCompactionTrigger =
  | "soft-limit"
  | "hard-limit"
  | "overflow"
  | "tool-pressure"
  | "manual";

export type ContextAnchorPriority = "P0" | "P1" | "P2" | "P3";

export type RequiredContextAnchor = {
  id: string;
  priority: ContextAnchorPriority;
  kind:
    | "goal"
    | "constraint"
    | "invariant"
    | "artifact"
    | "failure"
    | "pending-work"
    | "source-excerpt";
  text: string;
  sourceRecordIds: string[];
};

export type CompactionCheckpointFact = {
  id: string;
  text: string;
  sourceRecordIds: string[];
};

export type CompactionCheckpointState = {
  currentGoal: CompactionCheckpointFact[];
  currentState: CompactionCheckpointFact[];
  decisions: CompactionCheckpointFact[];
  constraints: CompactionCheckpointFact[];
  artifacts: CompactionCheckpointFact[];
  failuresAndLessons: CompactionCheckpointFact[];
  pendingWork: CompactionCheckpointFact[];
};

export type CompactionCheckpointV2 = {
  version: 2;
  checkpointId: string;
  baseCheckpointId: string | null;
  policyVersion: string;
  source: {
    recordIds: string[];
    firstRecordId: string;
    lastRecordId: string;
    sourceDigest: string;
  };
  trigger: ContextCompactionTrigger;
  compactedThroughRecordId: string;
  retainedFromRecordId: string | null;
  splitGroup: boolean;
  state: CompactionCheckpointState;
  validation: {
    quality: "verified" | "deterministic-degraded";
    requiredAnchorIds: string[];
    coveredAnchorIds: string[];
    sourceDigestVerified: true;
  };
  renderedSummary: string;
};

export type CompactionPlan = {
  version: 1;
  planId: string;
  policyVersion: string;
  trigger: ContextCompactionTrigger;
  baseCheckpointId: string | null;
  sourceRecordIds: string[];
  sourceDigest: string;
  provenanceRecordIds: string[];
  retainedRecordIds: string[];
  compactedThroughRecordId: string;
  retainedFromRecordId: string | null;
  splitGroup: boolean;
  inputTokensBefore: number;
  targetInputTokens: number;
  maxCheckpointTokens: number;
  requiredAnchors: RequiredContextAnchor[];
};

export type ContextCompactionMetadata = {
  trigger: ContextCompactionTrigger;
  inputTokensBefore: number;
  inputTokensAfter: number;
  inputBudgetTokens: number;
  softLimitTokens: number;
  hardLimitTokens: number;
  targetInputTokens: number;
  targetSummaryTokens: number;
  previousCheckpointRecordIds: string[];
  compactedRecordIds: string[];
  compactedThroughRecordId: string | null;
  retainedRecordIds: string[];
  retainedHistoryTokens: number;
  compactedHistoryTokens: number;
  recentTailTargetTokens: number;
};

export type ContextProjection<TPayload = unknown> = {
  records: ContextRecord<TPayload>[];
  omittedRecords: ContextRecord<TPayload>[];
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  truncated: boolean;
  overBudget: boolean;
  /** Present only when this projection created a replacement checkpoint. */
  compaction?: ContextCompactionMetadata;
};

export type ManualContextCompactionNoopReason =
  | "nothing-compactable"
  | "insufficient-history"
  | "recent-compaction"
  | "insufficient-gain"
  | "compactor-unavailable";

export type ManualContextCompactionEligibilityMetrics = {
  inputBudgetTokens: number;
  compactableTokens: number;
  replacementSourceTokens: number;
  estimatedSummaryTokens: number;
  estimatedGainTokens: number;
  estimatedGainRatio: number;
  newTurnsSinceCheckpoint: number;
  minCompactableTokens: number;
  minEstimatedGainTokens: number;
  minEstimatedGainRatio: number;
  minNewTurnsSinceCheckpoint: number;
  hasPreviousCheckpoint: boolean;
};

export type ManualContextCompactionEligibility =
  | (ManualContextCompactionEligibilityMetrics & { eligible: true })
  | (ManualContextCompactionEligibilityMetrics & {
      eligible: false;
      reason: Exclude<ManualContextCompactionNoopReason, "compactor-unavailable">;
    });

export type ManualContextCompactionState = {
  /**
   * Records intentionally retained by the previous checkpoint. They predate
   * that checkpoint and must not be counted as newly completed Turns.
   */
  previousRetainedRecordIds?: readonly string[];
};

export type ManualContextCompactionResult<TPayload = unknown> =
  | {
      status: "compacted";
      eligibility: ManualContextCompactionEligibility & { eligible: true };
      projection: ContextProjection<TPayload>;
    }
  | {
      status: "noop";
      reason: ManualContextCompactionNoopReason;
      eligibility: ManualContextCompactionEligibility;
      projection: ContextProjection<TPayload>;
    };

export type ContextCompactionPolicy = {
  maxSummaryTokens?: number;
  /** Begin proactive compaction before the provider hard limit is reached. */
  softLimitRatio?: number;
  /** Escalate proactive compaction when the input budget is nearly exhausted. */
  hardLimitRatio?: number;
  /** Desired post-compaction utilization, leaving room for subsequent steps. */
  targetUtilizationRatio?: number;
  /** Minimum raw recent history retained when feasible. */
  retainRecentMinTokens?: number;
  /** Effective-input-budget share retained as recent raw history when feasible. */
  retainRecentRatio?: number;
  /** Allows callers to expose smaller semantic subgroups for oversized rounds. */
  allowSplitGroup?: boolean;
  /** Minimum historical tokens to checkpoint for an explicit tool-pressure transition. */
  toolPressureReliefTokens?: number;
  /** Version included in content-addressed CompactionPlan identity. */
  policyVersion?: string;
  /** Absolute floor for manually compactable history. Defaults to 2048 tokens. */
  manualMinCompactableTokens?: number;
  /** Input-budget-relative floor for manually compactable history. Defaults to 3%. */
  manualMinCompactableRatio?: number;
  /** New completed Turns required after an existing checkpoint. Defaults to 2. */
  manualMinTurnsSinceCheckpoint?: number;
  /** Absolute minimum estimated savings for manual compaction. Defaults to 1024 tokens. */
  manualMinEstimatedGainTokens?: number;
  /** Input-budget-relative minimum estimated savings. Defaults to 2%. */
  manualMinEstimatedGainInputRatio?: number;
  /** Minimum savings as a share of the replacement source. Defaults to 30%. */
  manualMinEstimatedGainRatio?: number;
};

export type ContextCompactor<TPayload = unknown> = {
  compact(input: {
    plan: CompactionPlan;
    records: readonly ContextRecord<TPayload>[];
    previousCheckpointRecords: readonly ContextRecord<TPayload>[];
    newlyCompactedRecords: readonly ContextRecord<TPayload>[];
    retainedRecords: readonly ContextRecord<TPayload>[];
    targetTokens: number;
    trigger: ContextCompactionTrigger;
  }): Promise<ContextRecord<TPayload> | null> | ContextRecord<TPayload> | null;
};

const CATEGORY_ORDER: Record<ContextRecordCategory, number> = {
  "core-instruction": 10,
  "global-instruction": 20,
  "project-instruction": 30,
  "skill-catalog": 40,
  "tool-definition": 50,
  "compaction-checkpoint": 60,
  "historical-conversation": 70,
  "retained-turn": 80,
  "runtime-continuation": 90,
  "current-input": 100,
};

export function inferContextCategory(record: ContextRecord): ContextRecordCategory {
  if (record.category) return record.category;
  if (record.kind === "instruction") return "core-instruction";
  if (record.kind === "summary") return "compaction-checkpoint";
  if (record.kind === "runtime") return "runtime-continuation";
  return "historical-conversation";
}

export function inferContextStability(record: ContextRecord): ContextStabilityClass {
  if (record.stability) return record.stability;
  const category = inferContextCategory(record);
  if (CATEGORY_ORDER[category] <= CATEGORY_ORDER["tool-definition"]) return "stable";
  if (category === "compaction-checkpoint") return "checkpoint";
  if (category === "historical-conversation") return "history";
  if (category === "retained-turn") return "retained";
  return "dynamic";
}

/**
 * Canonical provider-independent ordering. Stable collections may opt into a
 * deterministic key; chronological records preserve their original order.
 */
export function compileContextRecords<TPayload>(
  records: readonly ContextRecord<TPayload>[],
): ContextRecord<TPayload>[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const categoryDelta = CATEGORY_ORDER[inferContextCategory(a.record)]
        - CATEGORY_ORDER[inferContextCategory(b.record)];
      if (categoryDelta !== 0) return categoryDelta;

      const aKey = a.record.deterministicKey;
      const bKey = b.record.deterministicKey;
      if (aKey != null || bKey != null) {
        const keyDelta = (aKey ?? a.record.id).localeCompare(bKey ?? b.record.id);
        if (keyDelta !== 0) return keyDelta;
      }
      return a.index - b.index;
    })
    .map(({ record }) => ({
      ...record,
      category: inferContextCategory(record),
      stability: inferContextStability(record),
    }));
}

function assertNonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertRatio(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be greater than 0 and less than or equal to 1`);
  }
}

function assertNonNegativeRatio(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be greater than or equal to 0 and less than or equal to 1`);
  }
}

function sumRecordTokens<TPayload>(records: readonly ContextRecord<TPayload>[]) {
  return records.reduce((total, record) => total + record.estimatedTokens, 0);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function digestContextRecords<TPayload>(records: readonly ContextRecord<TPayload>[]) {
  return sha256(stableJson(records.map((record) => ({
    id: record.id,
    kind: record.kind,
    payload: record.payload,
    estimatedTokens: record.estimatedTokens,
    groupId: record.groupId ?? null,
    splitGroupId: record.splitGroupId ?? null,
    category: inferContextCategory(record),
    checkpointId: record.checkpointV2?.checkpointId ?? null,
  }))));
}

function checkpointProvenanceIds<TPayload>(records: readonly ContextRecord<TPayload>[]) {
  const ids = new Set<string>(records.map((record) => record.id));
  for (const record of records) {
    if (!record.checkpointV2) continue;
    for (const fact of Object.values(record.checkpointV2.state).flat()) {
      for (const sourceRecordId of fact.sourceRecordIds) ids.add(sourceRecordId);
    }
  }
  return [...ids].sort();
}

function collectRequiredAnchors<TPayload>(records: readonly ContextRecord<TPayload>[]) {
  const byId = new Map<string, RequiredContextAnchor>();
  for (const record of records) {
    for (const anchor of record.requiredAnchors ?? []) {
      if (!byId.has(anchor.id)) byId.set(anchor.id, structuredClone(anchor));
    }
    const checkpoint = record.checkpointV2;
    if (!checkpoint) continue;
    const carry = (
      facts: readonly CompactionCheckpointFact[],
      kind: RequiredContextAnchor["kind"],
      priority: ContextAnchorPriority,
    ) => {
      for (const fact of facts) {
        const id = `checkpoint:${checkpoint.checkpointId}:${fact.id}`;
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          priority,
          kind,
          text: fact.text,
          sourceRecordIds: [...fact.sourceRecordIds],
        });
      }
    };
    carry(checkpoint.state.currentGoal, "goal", "P0");
    carry(checkpoint.state.constraints, "constraint", "P0");
    carry(checkpoint.state.failuresAndLessons, "failure", "P0");
    carry(checkpoint.state.pendingWork, "pending-work", "P0");
    carry(checkpoint.state.artifacts, "artifact", "P1");
    carry(checkpoint.state.decisions, "source-excerpt", "P1");
    carry(checkpoint.state.currentState, "source-excerpt", "P2");
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function isCompactableHistory<TPayload>(record: ContextRecord<TPayload>) {
  return !record.required
    && record.kind === "history"
    && inferContextCategory(record) === "historical-conversation";
}

function cloneRecord<TPayload>(record: ContextRecord<TPayload>): ContextRecord<TPayload> {
  return { ...record };
}

type RecordGroup<TPayload> = {
  key: string;
  records: Array<{ record: ContextRecord<TPayload>; index: number }>;
  required: boolean;
  estimatedTokens: number;
  lastIndex: number;
};

function groupRecords<TPayload>(records: readonly ContextRecord<TPayload>[]) {
  const groupByKey = new Map<string, RecordGroup<TPayload>>();

  records.forEach((record, index) => {
    const key = record.groupId ?? `record:${index}`;
    const existing = groupByKey.get(key);
    if (existing) {
      existing.records.push({ record, index });
      existing.required ||= Boolean(record.required);
      existing.estimatedTokens += record.estimatedTokens;
      existing.lastIndex = index;
      return;
    }

    groupByKey.set(key, {
      key,
      records: [{ record, index }],
      required: Boolean(record.required),
      estimatedTokens: record.estimatedTokens,
      lastIndex: index,
    });
  });

  return [...groupByKey.values()].sort((a, b) => a.lastIndex - b.lastIndex);
}

/**
 * Projects immutable canonical context into the subset that is safe to send to a model.
 * History groups are atomic: a turn is never split merely to fit the budget.
 * Required groups always survive; newest optional groups win the remaining budget.
 */
export class ContextManager<TPayload = unknown> {
  project(
    records: readonly ContextRecord<TPayload>[],
    budget: ContextBudget,
  ): ContextProjection<TPayload> {
    assertNonNegativeInteger(budget.contextWindowTokens, "contextWindowTokens");
    assertNonNegativeInteger(budget.reservedOutputTokens, "reservedOutputTokens");
    assertNonNegativeInteger(budget.safetyMarginTokens ?? 0, "safetyMarginTokens");

    const canonicalRecords = compileContextRecords(records);
    for (const record of canonicalRecords) {
      assertNonNegativeInteger(record.estimatedTokens, `estimatedTokens(${record.id})`);
    }

    const inputBudgetTokens = Math.max(
      0,
      budget.contextWindowTokens
        - budget.reservedOutputTokens
        - (budget.safetyMarginTokens ?? 0),
    );
    const groups = groupRecords(canonicalRecords);
    const selectedGroups = new Set<string>();
    let estimatedInputTokens = 0;

    for (const group of groups) {
      if (!group.required) continue;
      selectedGroups.add(group.key);
      estimatedInputTokens += group.estimatedTokens;
    }

    let remaining = Math.max(0, inputBudgetTokens - estimatedInputTokens);
    let optionalHistoryCut = false;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index]!;
      if (group.required || selectedGroups.has(group.key)) continue;
      if (optionalHistoryCut) continue;
      if (group.estimatedTokens > remaining) {
        optionalHistoryCut = true;
        continue;
      }

      selectedGroups.add(group.key);
      remaining -= group.estimatedTokens;
      estimatedInputTokens += group.estimatedTokens;
    }

    const selectedIndexes = new Set<number>();
    for (const group of groups) {
      if (!selectedGroups.has(group.key)) continue;
      group.records.forEach(({ index }) => selectedIndexes.add(index));
    }

    const projectedRecords = canonicalRecords
      .filter((_, index) => selectedIndexes.has(index))
      .map(cloneRecord);
    const omittedRecords = canonicalRecords
      .filter((_, index) => !selectedIndexes.has(index))
      .map(cloneRecord);

    return {
      records: projectedRecords,
      omittedRecords,
      inputBudgetTokens,
      estimatedInputTokens,
      truncated: omittedRecords.length > 0,
      overBudget: estimatedInputTokens > inputBudgetTokens,
    };
  }

  async projectWithCompaction(
    records: readonly ContextRecord<TPayload>[],
    budget: ContextBudget,
    compactor: ContextCompactor<TPayload>,
    options: ContextCompactionPolicy = {},
    forcedTrigger: Exclude<ContextCompactionTrigger, "manual"> | null = null,
  ): Promise<ContextProjection<TPayload>> {
    return this.projectWithCompactionInternal(records, budget, compactor, options, forcedTrigger);
  }

  private async projectWithCompactionInternal(
    records: readonly ContextRecord<TPayload>[],
    budget: ContextBudget,
    compactor: ContextCompactor<TPayload>,
    options: ContextCompactionPolicy,
    forcedTrigger: ContextCompactionTrigger | null,
  ): Promise<ContextProjection<TPayload>> {
    const canonicalRecords = compileContextRecords(records);
    const first = this.project(canonicalRecords, budget);
    const maxSummaryTokens = Math.max(0, Math.floor(options.maxSummaryTokens ?? 2_048));
    if (maxSummaryTokens === 0 || first.inputBudgetTokens === 0) return first;

    const softLimitRatio = options.softLimitRatio ?? 0.8;
    const hardLimitRatio = options.hardLimitRatio ?? 0.92;
    const targetUtilizationRatio = options.targetUtilizationRatio ?? 0.7;
    const retainRecentMinTokens = Math.max(0, Math.floor(options.retainRecentMinTokens ?? 0));
    const retainRecentRatio = options.retainRecentRatio ?? 0;
    assertRatio(softLimitRatio, "softLimitRatio");
    assertRatio(hardLimitRatio, "hardLimitRatio");
    assertRatio(targetUtilizationRatio, "targetUtilizationRatio");
    assertNonNegativeInteger(retainRecentMinTokens, "retainRecentMinTokens");
    assertNonNegativeRatio(retainRecentRatio, "retainRecentRatio");
    if (softLimitRatio > hardLimitRatio) {
      throw new Error("softLimitRatio must be less than or equal to hardLimitRatio");
    }
    if (targetUtilizationRatio > softLimitRatio) {
      throw new Error("targetUtilizationRatio must be less than or equal to softLimitRatio");
    }

    const inputTokensBefore = sumRecordTokens(canonicalRecords);
    const softLimitTokens = Math.floor(first.inputBudgetTokens * softLimitRatio);
    const hardLimitTokens = Math.floor(first.inputBudgetTokens * hardLimitRatio);
    const targetInputTokens = Math.floor(first.inputBudgetTokens * targetUtilizationRatio);
    const trigger: ContextCompactionTrigger | null = forcedTrigger ?? (
      first.truncated
      || first.overBudget
      || inputTokensBefore > first.inputBudgetTokens
        ? "overflow"
        : inputTokensBefore > hardLimitTokens
          ? "hard-limit"
          : inputTokensBefore > softLimitTokens
            ? "soft-limit"
            : null
    );
    if (!trigger) return first;

    const groups = groupRecords(canonicalRecords);
    const compactableGroups = groups.filter((group) =>
      group.records.every(({ record }) => isCompactableHistory(record)),
    );
    if (compactableGroups.length === 0) return first;

    const compactableIndexes = new Set(
      compactableGroups.flatMap((group) => group.records.map(({ index }) => index)),
    );
    const fixedTokens = canonicalRecords.reduce((total, record, index) => {
      if (record.kind === "summary" || compactableIndexes.has(index)) return total;
      return total + record.estimatedTokens;
    }, 0);
    const summaryReserve = Math.min(maxSummaryTokens, first.inputBudgetTokens);
    const compactableHistoryTokens = compactableGroups.reduce(
      (total, group) => total + group.estimatedTokens,
      0,
    );
    const recentTailTargetTokens = Math.min(
      compactableHistoryTokens,
      Math.max(
        retainRecentMinTokens,
        Math.floor(first.inputBudgetTokens * retainRecentRatio),
      ),
    );
    const targetRetainedHistoryTokens = Math.max(
      0,
      targetInputTokens - summaryReserve - fixedTokens,
    );
    const retainedGroupKeys = new Set<string>();
    let retainedHistoryTokens = 0;
    let newestCandidateIndex = compactableGroups.length - 1;

    // First satisfy the Pi-style recent raw suffix floor. Complete semantic
    // groups may overshoot the target; this is preferable to splitting a normal
    // Model Cycle merely to hit an exact token count.
    while (newestCandidateIndex >= 0 && retainedHistoryTokens < recentTailTargetTokens) {
      const group = compactableGroups[newestCandidateIndex]!;
      retainedGroupKeys.add(group.key);
      retainedHistoryTokens += group.estimatedTokens;
      newestCandidateIndex -= 1;
    }

    // Then retain as much additional recent history as fits the desired
    // post-compaction target. This applies identically to tool-pressure: it no
    // longer means "compact every old record".
    if (trigger !== "manual") {
      while (newestCandidateIndex >= 0) {
        const group = compactableGroups[newestCandidateIndex]!;
        if (retainedHistoryTokens + group.estimatedTokens > targetRetainedHistoryTokens) break;
        retainedGroupKeys.add(group.key);
        retainedHistoryTokens += group.estimatedTokens;
        newestCandidateIndex -= 1;
      }
    }

    const compactedIndexes = new Set<number>();
    for (const group of compactableGroups) {
      if (retainedGroupKeys.has(group.key)) continue;
      group.records.forEach(({ index }) => compactedIndexes.add(index));
    }

    if (trigger === "tool-pressure") {
      const toolPressureReliefTokens = Math.max(
        1,
        Math.floor(options.toolPressureReliefTokens ?? 1),
      );
      let compactedForPressureTokens = compactableGroups
        .filter((group) => !retainedGroupKeys.has(group.key))
        .reduce((total, group) => total + group.estimatedTokens, 0);
      // Relieve only the measured pressure, oldest complete semantic groups
      // first. Keep the newest group raw so the immediate continuation never
      // loses the just-completed Tool Batch context.
      for (let index = 0; index < compactableGroups.length - 1; index += 1) {
        if (compactedForPressureTokens >= toolPressureReliefTokens) break;
        const group = compactableGroups[index]!;
        if (!retainedGroupKeys.has(group.key)) continue;
        retainedGroupKeys.delete(group.key);
        retainedHistoryTokens = Math.max(0, retainedHistoryTokens - group.estimatedTokens);
        group.records.forEach(({ index: recordIndex }) => compactedIndexes.add(recordIndex));
        compactedForPressureTokens += group.estimatedTokens;
      }
    }

    let splitGroup = false;
    if (
      compactedIndexes.size === 0
      && options.allowSplitGroup
      && compactableGroups.length === 1
    ) {
      const boundary = compactableGroups[0]!;
      const splitGroups: Array<{ key: string; indexes: number[]; estimatedTokens: number }> = [];
      for (const { record, index } of boundary.records) {
        const key = record.splitGroupId ?? "";
        const last = splitGroups.at(-1);
        if (!key || (last && last.key !== key)) {
          splitGroups.push({
            key: key || `unsplittable:${index}`,
            indexes: [index],
            estimatedTokens: record.estimatedTokens,
          });
        } else if (last) {
          last.indexes.push(index);
          last.estimatedTokens += record.estimatedTokens;
        } else {
          splitGroups.push({ key, indexes: [index], estimatedTokens: record.estimatedTokens });
        }
      }

      // A split is valid only when callers exposed at least two explicit
      // semantic subgroups. Records without splitGroupId are never split by
      // this escape hatch.
      const explicitSplitGroups = splitGroups.filter((group) => !group.key.startsWith("unsplittable:"));
      if (explicitSplitGroups.length === splitGroups.length && splitGroups.length >= 2) {
        let remainingTokens = boundary.estimatedTokens;
        for (let index = 0; index < splitGroups.length - 1; index += 1) {
          const subgroup = splitGroups[index]!;
          const projectedWithReserve = fixedTokens + remainingTokens + summaryReserve;
          const mustRelievePressure = projectedWithReserve > targetInputTokens;
          const suffixAlreadyLargeEnough = remainingTokens - subgroup.estimatedTokens >= recentTailTargetTokens;
          if (!mustRelievePressure && !suffixAlreadyLargeEnough) break;
          subgroup.indexes.forEach((recordIndex) => compactedIndexes.add(recordIndex));
          remainingTokens -= subgroup.estimatedTokens;
          splitGroup = true;
          if (
            fixedTokens + remainingTokens + summaryReserve <= targetInputTokens
            && remainingTokens >= recentTailTargetTokens
          ) break;
        }
      }
    }
    if (compactedIndexes.size === 0) return first;

    const previousCheckpointRecords = canonicalRecords.filter((record) => record.kind === "summary");
    const newlyCompactedRecords = canonicalRecords.filter((_, index) => compactedIndexes.has(index));
    const retainedRecords = canonicalRecords.filter(
      (record, index) => record.kind !== "summary" && !compactedIndexes.has(index),
    );
    const retainedWithoutCheckpointTokens = sumRecordTokens(retainedRecords);
    const targetTokens = Math.min(
      summaryReserve,
      Math.max(0, first.inputBudgetTokens - retainedWithoutCheckpointTokens),
    );
    if (targetTokens === 0 || newlyCompactedRecords.length === 0) return first;

    const compactionSource = compileContextRecords([
      ...previousCheckpointRecords,
      ...newlyCompactedRecords,
    ]);
    const sourceDigest = digestContextRecords(compactionSource);
    const policyVersion = options.policyVersion ?? "context-compaction-v2";
    const baseCheckpointId = previousCheckpointRecords
      .map((record) => record.checkpointV2?.checkpointId)
      .filter((id): id is string => Boolean(id))
      .at(-1) ?? null;
    const requiredAnchors = collectRequiredAnchors(compactionSource);
    const compactedThroughRecordId = newlyCompactedRecords.at(-1)!.id;
    const retainedHistory = retainedRecords.filter((record) => record.kind === "history");
    const retainedFromRecordId = retainedHistory.at(0)?.id ?? null;
    const retainedRecordIds = retainedRecords.map((record) => record.id);
    const sourceRecordIds = compactionSource.map((record) => record.id);
    const planId = sha256(stableJson({
      version: 1,
      policyVersion,
      trigger,
      baseCheckpointId,
      sourceDigest,
      sourceRecordIds,
      retainedRecordIds,
      compactedThroughRecordId,
      retainedFromRecordId,
      splitGroup,
      targetInputTokens,
      targetTokens,
    }));
    const plan: CompactionPlan = {
      version: 1,
      planId,
      policyVersion,
      trigger,
      baseCheckpointId,
      sourceRecordIds,
      sourceDigest,
      provenanceRecordIds: checkpointProvenanceIds(compactionSource),
      retainedRecordIds,
      compactedThroughRecordId,
      retainedFromRecordId,
      splitGroup,
      inputTokensBefore,
      targetInputTokens,
      maxCheckpointTokens: targetTokens,
      requiredAnchors,
    };
    const summary = await compactor.compact({
      plan,
      records: compactionSource,
      previousCheckpointRecords,
      newlyCompactedRecords,
      retainedRecords,
      targetTokens,
      trigger,
    });
    if (!summary) return first;
    if (summary.kind !== "summary") {
      throw new Error("Context compactor must return a summary record");
    }
    if (summary.estimatedTokens > targetTokens) {
      throw new Error("Context compactor returned a summary larger than targetTokens");
    }

    const compactedRecords = [
      {
        ...summary,
        required: true,
        category: "compaction-checkpoint" as const,
        stability: "checkpoint" as const,
      },
      ...retainedRecords,
    ];
    const projected = this.project(compactedRecords, budget);
    return {
      ...projected,
      compaction: {
        trigger,
        inputTokensBefore,
        inputTokensAfter: projected.estimatedInputTokens,
        inputBudgetTokens: first.inputBudgetTokens,
        softLimitTokens,
        hardLimitTokens,
        targetInputTokens,
        targetSummaryTokens: targetTokens,
        previousCheckpointRecordIds: previousCheckpointRecords.map((record) => record.id),
        compactedRecordIds: newlyCompactedRecords.map((record) => record.id),
        compactedThroughRecordId,
        retainedRecordIds: projected.records
          .filter((record) => record.kind !== "summary")
          .map((record) => record.id),
        retainedHistoryTokens: sumRecordTokens(retainedHistory),
        compactedHistoryTokens: sumRecordTokens(newlyCompactedRecords),
        recentTailTargetTokens,
      },
    };
  }

  evaluateManualCompactionEligibility(
    records: readonly ContextRecord<TPayload>[],
    budget: ContextBudget,
    options: ContextCompactionPolicy = {},
    state: ManualContextCompactionState = {},
  ): ManualContextCompactionEligibility {
    const canonicalRecords = compileContextRecords(records);
    const projection = this.project(canonicalRecords, budget);
    const inputBudgetTokens = projection.inputBudgetTokens;

    const manualMinCompactableTokens = Math.max(
      0,
      Math.floor(options.manualMinCompactableTokens ?? 2_048),
    );
    const manualMinCompactableRatio = options.manualMinCompactableRatio ?? 0.03;
    const manualMinTurnsSinceCheckpoint = Math.max(
      0,
      Math.floor(options.manualMinTurnsSinceCheckpoint ?? 2),
    );
    const manualMinEstimatedGainTokens = Math.max(
      0,
      Math.floor(options.manualMinEstimatedGainTokens ?? 1_024),
    );
    const manualMinEstimatedGainInputRatio = options.manualMinEstimatedGainInputRatio ?? 0.02;
    const manualMinEstimatedGainRatio = options.manualMinEstimatedGainRatio ?? 0.3;

    assertNonNegativeInteger(manualMinCompactableTokens, "manualMinCompactableTokens");
    assertNonNegativeInteger(manualMinTurnsSinceCheckpoint, "manualMinTurnsSinceCheckpoint");
    assertNonNegativeInteger(manualMinEstimatedGainTokens, "manualMinEstimatedGainTokens");
    assertNonNegativeRatio(manualMinCompactableRatio, "manualMinCompactableRatio");
    assertNonNegativeRatio(
      manualMinEstimatedGainInputRatio,
      "manualMinEstimatedGainInputRatio",
    );
    assertNonNegativeRatio(manualMinEstimatedGainRatio, "manualMinEstimatedGainRatio");

    const groups = groupRecords(canonicalRecords);
    const compactableGroups = groups.filter((group) =>
      group.records.every(({ record }) => isCompactableHistory(record)),
    );
    const compactableTokens = compactableGroups.reduce(
      (total, group) => total + group.estimatedTokens,
      0,
    );
    const compactableIndexes = new Set(
      compactableGroups.flatMap((group) => group.records.map(({ index }) => index)),
    );
    const previousCheckpointRecords = canonicalRecords.filter((record) => record.kind === "summary");
    const hasPreviousCheckpoint = previousCheckpointRecords.length > 0;
    const previousCheckpointTokens = sumRecordTokens(previousCheckpointRecords);
    const replacementSourceTokens = previousCheckpointTokens + compactableTokens;
    const maxSummaryTokens = Math.max(0, Math.floor(options.maxSummaryTokens ?? 2_048));
    const retainedTokens = canonicalRecords.reduce((total, record, index) => {
      if (record.kind === "summary" || compactableIndexes.has(index)) return total;
      return total + record.estimatedTokens;
    }, 0);
    const availableSummaryTokens = Math.max(0, inputBudgetTokens - retainedTokens);
    const estimatedSummaryTokens = Math.min(
      maxSummaryTokens,
      replacementSourceTokens,
      availableSummaryTokens,
    );
    const estimatedGainTokens = Math.max(0, replacementSourceTokens - estimatedSummaryTokens);
    const estimatedGainRatio = replacementSourceTokens === 0
      ? 0
      : estimatedGainTokens / replacementSourceTokens;
    const previousRetainedRecordIds = new Set(state.previousRetainedRecordIds ?? []);
    const newTurnKeys = new Set<string>();
    canonicalRecords.forEach((record, index) => {
      if (record.kind !== "history" || previousRetainedRecordIds.has(record.id)) return;
      newTurnKeys.add(record.groupId ?? `record:${index}`);
    });
    const newTurnsSinceCheckpoint = hasPreviousCheckpoint ? newTurnKeys.size : 0;
    const minCompactableTokens = Math.max(
      manualMinCompactableTokens,
      Math.floor(inputBudgetTokens * manualMinCompactableRatio),
    );
    const minEstimatedGainTokens = Math.max(
      manualMinEstimatedGainTokens,
      Math.floor(inputBudgetTokens * manualMinEstimatedGainInputRatio),
    );
    const metrics: ManualContextCompactionEligibilityMetrics = {
      inputBudgetTokens,
      compactableTokens,
      replacementSourceTokens,
      estimatedSummaryTokens,
      estimatedGainTokens,
      estimatedGainRatio,
      newTurnsSinceCheckpoint,
      minCompactableTokens,
      minEstimatedGainTokens,
      minEstimatedGainRatio: manualMinEstimatedGainRatio,
      minNewTurnsSinceCheckpoint: manualMinTurnsSinceCheckpoint,
      hasPreviousCheckpoint,
    };

    if (compactableGroups.length === 0) {
      if (hasPreviousCheckpoint) {
        return { eligible: false, reason: "recent-compaction", ...metrics };
      }
      return { eligible: false, reason: "nothing-compactable", ...metrics };
    }

    if (hasPreviousCheckpoint && (
      compactableTokens < minCompactableTokens
      || newTurnsSinceCheckpoint < manualMinTurnsSinceCheckpoint
    )) {
      return { eligible: false, reason: "recent-compaction", ...metrics };
    }

    if (!hasPreviousCheckpoint && compactableTokens < minCompactableTokens) {
      return { eligible: false, reason: "insufficient-history", ...metrics };
    }

    if (
      estimatedGainTokens < minEstimatedGainTokens
      || estimatedGainRatio < manualMinEstimatedGainRatio
    ) {
      return { eligible: false, reason: "insufficient-gain", ...metrics };
    }

    return { eligible: true, ...metrics };
  }

  /**
   * Requests the existing compaction pipeline below automatic thresholds. The
   * request must first pass manual eligibility gates and never relaxes atomic
   * group, required-record, or checkpoint replacement rules.
   */
  async compactManually(
    records: readonly ContextRecord<TPayload>[],
    budget: ContextBudget,
    compactor: ContextCompactor<TPayload>,
    options: ContextCompactionPolicy = {},
    state: ManualContextCompactionState = {},
  ): Promise<ManualContextCompactionResult<TPayload>> {
    const canonicalRecords = compileContextRecords(records);
    const eligibility = this.evaluateManualCompactionEligibility(
      canonicalRecords,
      budget,
      options,
      state,
    );
    if (!eligibility.eligible) {
      return {
        status: "noop",
        reason: eligibility.reason,
        eligibility,
        projection: this.project(canonicalRecords, budget),
      };
    }

    const projection = await this.projectWithCompactionInternal(
      canonicalRecords,
      budget,
      compactor,
      options,
      "manual",
    );
    if (!projection.compaction) {
      return {
        status: "noop",
        reason: "compactor-unavailable",
        eligibility,
        projection,
      };
    }
    return { status: "compacted", eligibility, projection };
  }
}
