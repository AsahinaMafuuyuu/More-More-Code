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
  /** Provider-independent semantic position in the canonical model context. */
  category?: ContextRecordCategory;
  /** Cache stability classification; derived from category when omitted. */
  stability?: ContextStabilityClass;
  /** Deterministic tie-breaker for stable collections such as skills/tools. */
  deterministicKey?: string;
};

export type ContextBudget = {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens?: number;
};

export type ContextCompactionTrigger = "soft-limit" | "hard-limit" | "overflow";

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

export type ContextCompactionPolicy = {
  maxSummaryTokens?: number;
  /** Begin proactive compaction before the provider hard limit is reached. */
  softLimitRatio?: number;
  /** Escalate proactive compaction when the input budget is nearly exhausted. */
  hardLimitRatio?: number;
  /** Desired post-compaction utilization, leaving room for subsequent steps. */
  targetUtilizationRatio?: number;
};

export type ContextCompactor<TPayload = unknown> = {
  compact(input: {
    records: readonly ContextRecord<TPayload>[];
    previousCheckpointRecords: readonly ContextRecord<TPayload>[];
    newlyCompactedRecords: readonly ContextRecord<TPayload>[];
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

function sumRecordTokens<TPayload>(records: readonly ContextRecord<TPayload>[]) {
  return records.reduce((total, record) => total + record.estimatedTokens, 0);
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
  ): Promise<ContextProjection<TPayload>> {
    const canonicalRecords = compileContextRecords(records);
    const first = this.project(canonicalRecords, budget);
    const maxSummaryTokens = Math.max(0, Math.floor(options.maxSummaryTokens ?? 2_048));
    if (maxSummaryTokens === 0 || first.inputBudgetTokens === 0) return first;

    const softLimitRatio = options.softLimitRatio ?? 0.8;
    const hardLimitRatio = options.hardLimitRatio ?? 0.92;
    const targetUtilizationRatio = options.targetUtilizationRatio ?? 0.7;
    assertRatio(softLimitRatio, "softLimitRatio");
    assertRatio(hardLimitRatio, "hardLimitRatio");
    assertRatio(targetUtilizationRatio, "targetUtilizationRatio");
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
    const trigger: ContextCompactionTrigger | null = first.truncated
      || first.overBudget
      || inputTokensBefore > first.inputBudgetTokens
      ? "overflow"
      : inputTokensBefore > hardLimitTokens
        ? "hard-limit"
        : inputTokensBefore > softLimitTokens
          ? "soft-limit"
          : null;
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
    let remainingHistoryTokens = Math.max(
      0,
      targetInputTokens - summaryReserve - fixedTokens,
    );
    const retainedGroupKeys = new Set<string>();
    let cutReached = false;

    for (let index = compactableGroups.length - 1; index >= 0; index -= 1) {
      const group = compactableGroups[index]!;
      if (cutReached) continue;
      if (group.estimatedTokens > remainingHistoryTokens) {
        cutReached = true;
        continue;
      }
      retainedGroupKeys.add(group.key);
      remainingHistoryTokens -= group.estimatedTokens;
    }

    const compactedIndexes = new Set<number>();
    for (const group of compactableGroups) {
      if (retainedGroupKeys.has(group.key)) continue;
      group.records.forEach(({ index }) => compactedIndexes.add(index));
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
    const summary = await compactor.compact({
      records: compactionSource,
      previousCheckpointRecords,
      newlyCompactedRecords,
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
        compactedThroughRecordId: newlyCompactedRecords.at(-1)?.id ?? null,
        retainedRecordIds: projected.records
          .filter((record) => record.kind !== "summary")
          .map((record) => record.id),
      },
    };
  }
}
