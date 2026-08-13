export type ContextRecordKind = "instruction" | "history" | "summary";

export type ContextRecord<TPayload = unknown> = {
  id: string;
  kind: ContextRecordKind;
  payload: TPayload;
  estimatedTokens: number;
  required?: boolean;
  /** Records with the same groupId are admitted or omitted together. */
  groupId?: string;
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
 * Projects immutable history into the subset that is safe to send to a model.
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

    for (const record of records) {
      assertNonNegativeInteger(record.estimatedTokens, `estimatedTokens(${record.id})`);
    }

    const inputBudgetTokens = Math.max(
      0,
      budget.contextWindowTokens
        - budget.reservedOutputTokens
        - (budget.safetyMarginTokens ?? 0),
    );
    const groups = groupRecords(records);
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

    const projectedRecords = records
      .filter((_, index) => selectedIndexes.has(index))
      .map(cloneRecord);
    const omittedRecords = records
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
    const first = this.project(records, budget);
    if (!first.truncated || first.omittedRecords.length === 0) return first;

    const maxSummaryTokens = Math.max(0, options.maxSummaryTokens ?? 2_048);
    if (maxSummaryTokens === 0) return first;

    // Reserve summary room only after we know normal projection truncates.
    const summaryReserve = Math.min(maxSummaryTokens, first.inputBudgetTokens);
    const retentionProjection = this.project(records, {
      ...budget,
      safetyMarginTokens: (budget.safetyMarginTokens ?? 0) + summaryReserve,
    });
    const targetTokens = Math.min(
      summaryReserve,
      Math.max(0, first.inputBudgetTokens - retentionProjection.estimatedInputTokens),
    );
    if (targetTokens === 0 || retentionProjection.omittedRecords.length === 0) return first;

    const summary = await compactor.compact({
      records: retentionProjection.omittedRecords,
      targetTokens,
    });
    if (!summary) return first;
    if (summary.kind !== "summary") {
      throw new Error("Context compactor must return a summary record");
    }
    if (summary.estimatedTokens > targetTokens) {
      throw new Error("Context compactor returned a summary larger than targetTokens");
    }

    // Summary replaces only omitted prefix/groups; retained records remain unchanged.
    const retainedIds = new Set(retentionProjection.records.map((record) => record.id));
    const firstRetainedIndex = records.findIndex((record) => retainedIds.has(record.id));
    const insertAt = firstRetainedIndex === -1 ? records.length : firstRetainedIndex;
    const compactedRecords = [
      ...records.slice(0, insertAt).filter((record) => retainedIds.has(record.id)),
      { ...summary, required: true },
      ...records.slice(insertAt).filter((record) => retainedIds.has(record.id)),
    ];

    return this.project(compactedRecords, budget);
  }
}
