export type ContextRecordKind = "instruction" | "history" | "summary";

export type ContextRecord<TPayload = unknown> = {
  id: string;
  kind: ContextRecordKind;
  payload: TPayload;
  estimatedTokens: number;
  required?: boolean;
};

export type ContextBudget = {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens?: number;
};

export type ContextProjection<TPayload = unknown> = {
  records: ContextRecord<TPayload>[];
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  truncated: boolean;
  overBudget: boolean;
};

function assertNonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function cloneRecord<TPayload>(record: ContextRecord<TPayload>): ContextRecord<TPayload> {
  return { ...record };
}

/**
 * Projects immutable history into the subset that is safe to send to a model.
 * It never mutates or compacts the source history. Newer optional records win
 * when the budget cannot fit the full history, while required records are kept.
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

    const selected = new Set<number>();
    let estimatedInputTokens = 0;

    records.forEach((record, index) => {
      if (!record.required) return;
      selected.add(index);
      estimatedInputTokens += record.estimatedTokens;
    });

    let remaining = Math.max(0, inputBudgetTokens - estimatedInputTokens);

    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      if (record.required || selected.has(index)) continue;
      if (record.estimatedTokens > remaining) continue;

      selected.add(index);
      remaining -= record.estimatedTokens;
      estimatedInputTokens += record.estimatedTokens;
    }

    const projectedRecords = records
      .filter((_, index) => selected.has(index))
      .map(cloneRecord);

    return {
      records: projectedRecords,
      inputBudgetTokens,
      estimatedInputTokens,
      truncated: projectedRecords.length !== records.length,
      overBudget: estimatedInputTokens > inputBudgetTokens,
    };
  }
}
