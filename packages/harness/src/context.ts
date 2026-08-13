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

export type ContextProjection<TPayload = unknown> = {
  records: ContextRecord<TPayload>[];
  omittedRecords: ContextRecord<TPayload>[];
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  truncated: boolean;
  overBudget: boolean;
};

export type ContextCompactor<TPayload = unknown> = {
  compact(input: {
    records: readonly ContextRecord<TPayload>[];
    targetTokens: number;
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
    options: { maxSummaryTokens?: number } = {},
  ): Promise<ContextProjection<TPayload>> {
    const canonicalRecords = compileContextRecords(records);
    const first = this.project(canonicalRecords, budget);
    if (!first.truncated || first.omittedRecords.length === 0) return first;

    const maxSummaryTokens = Math.max(0, options.maxSummaryTokens ?? 2_048);
    if (maxSummaryTokens === 0) return first;

    const summaryReserve = Math.min(maxSummaryTokens, first.inputBudgetTokens);
    const firstCheckpointTokens = first.records
      .filter((record) => record.kind === "summary")
      .reduce((total, record) => total + record.estimatedTokens, 0);
    // A new checkpoint replaces the old one, so reserve only the additional
    // room that the replacement may need instead of double-counting both.
    const additionalSummaryReserve = Math.max(0, summaryReserve - firstCheckpointTokens);
    const retentionProjection = this.project(canonicalRecords, {
      ...budget,
      safetyMarginTokens: (budget.safetyMarginTokens ?? 0) + additionalSummaryReserve,
    });
    const existingCheckpoints = retentionProjection.records.filter(
      (record) => record.kind === "summary",
    );
    const existingCheckpointTokens = existingCheckpoints.reduce(
      (total, record) => total + record.estimatedTokens,
      0,
    );
    const compactionSource = compileContextRecords([
      ...existingCheckpoints,
      ...retentionProjection.omittedRecords,
    ]);
    const retainedWithoutCheckpointTokens = Math.max(
      0,
      retentionProjection.estimatedInputTokens - existingCheckpointTokens,
    );
    const targetTokens = Math.min(
      summaryReserve,
      Math.max(0, first.inputBudgetTokens - retainedWithoutCheckpointTokens),
    );
    if (targetTokens === 0 || compactionSource.length === 0) return first;

    const summary = await compactor.compact({
      records: compactionSource,
      targetTokens,
    });
    if (!summary) return first;
    if (summary.kind !== "summary") {
      throw new Error("Context compactor must return a summary record");
    }
    if (summary.estimatedTokens > targetTokens) {
      throw new Error("Context compactor returned a summary larger than targetTokens");
    }

    // A new checkpoint supersedes prior checkpoint(s) and omitted history only.
    const retainedIds = new Set(
      retentionProjection.records
        .filter((record) => record.kind !== "summary")
        .map((record) => record.id),
    );
    const retainedRecords = canonicalRecords.filter((record) => retainedIds.has(record.id));
    const compactedRecords = [
      { ...summary, required: true, category: "compaction-checkpoint" as const, stability: "checkpoint" as const },
      ...retainedRecords,
    ];

    return this.project(compactedRecords, budget);
  }
}
