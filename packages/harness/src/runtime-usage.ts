import {
  isRuntimeEventPayload,
  type RuntimeEvent,
  type RuntimeModelStepCost,
  type RuntimeUsageEventPayload,
} from "./event-store";

export type UsageCoverage = "complete" | "partial" | "none";

export type SessionUsageSummary = {
  completedStepCount: number;
  tokens: {
    inputTotal?: number;
    inputNoCache?: number;
    cacheRead?: number;
    cacheWrite?: number;
    outputTotal?: number;
    text?: number;
    reasoning?: number;
  };
  cache: {
    hitRate?: number;
    coverage: UsageCoverage;
  };
  cost: {
    totalUsd?: number;
    coverage: UsageCoverage;
  };
  integrity: "valid" | "invalid";
};

export type RuntimeUsageProjection = {
  schemaVersion: 1;
  factsByStep: Record<string, RuntimeUsageEventPayload>;
  integrity: "valid" | "invalid";
  summary: SessionUsageSummary;
};

export function createRuntimeUsageProjection(): RuntimeUsageProjection {
  const projection: RuntimeUsageProjection = {
    schemaVersion: 1,
    factsByStep: {},
    integrity: "valid",
    summary: emptySummary(),
  };
  return projection;
}

export function reduceRuntimeUsageProjection(
  state: RuntimeUsageProjection,
  event: RuntimeEvent<"usage">,
): RuntimeUsageProjection {
  const next = structuredClone(state);
  const existing = next.factsByStep[event.payload.stepId];
  if (existing) {
    if (!usagePayloadEquals(existing, event.payload)) {
      next.integrity = "invalid";
    }
  } else {
    next.factsByStep[event.payload.stepId] = structuredClone(event.payload);
  }
  next.summary = summarizeFacts(next.factsByStep, next.integrity);
  return next;
}

export function projectSessionUsage(
  events: readonly RuntimeEvent<"usage">[],
): SessionUsageSummary {
  let state = createRuntimeUsageProjection();
  for (const event of events) state = reduceRuntimeUsageProjection(state, event);
  return state.summary;
}

export function isRuntimeUsageProjection(value: unknown): value is RuntimeUsageProjection {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !isRecord(value.factsByStep)
    || (value.integrity !== "valid" && value.integrity !== "invalid")
    || !isSessionUsageSummary(value.summary)) {
    return false;
  }
  const factsValid = Object.entries(value.factsByStep).every(([stepId, fact]) =>
    stepId.trim().length > 0
    && isRuntimeEventPayload("usage", fact)
    && fact.stepId === stepId);
  if (!factsValid) return false;

  const expected = summarizeFacts(
    value.factsByStep as Record<string, RuntimeUsageEventPayload>,
    value.integrity,
  );
  return stableSerialize(value.summary) === stableSerialize(expected);
}

function summarizeFacts(
  factsByStep: Record<string, RuntimeUsageEventPayload>,
  integrity: "valid" | "invalid",
): SessionUsageSummary {
  const facts = Object.values(factsByStep);
  const tokens: SessionUsageSummary["tokens"] = {};
  assignSum(tokens, "inputTotal", facts.map((fact) => fact.inputTokens?.total));
  assignSum(tokens, "inputNoCache", facts.map((fact) => fact.inputTokens?.noCache));
  assignSum(tokens, "cacheRead", facts.map((fact) => fact.inputTokens?.cacheRead));
  assignSum(tokens, "cacheWrite", facts.map((fact) => fact.inputTokens?.cacheWrite));
  assignSum(tokens, "outputTotal", facts.map((fact) => fact.outputTokens?.total));
  assignSum(tokens, "text", facts.map((fact) => fact.outputTokens?.text));
  assignSum(tokens, "reasoning", facts.map((fact) => fact.outputTokens?.reasoning));

  const cacheRelevant = facts.filter((fact) =>
    fact.inputTokens !== undefined && Object.keys(fact.inputTokens).length > 0);
  const cacheComplete = cacheRelevant.filter((fact) =>
    fact.inputTokens?.total !== undefined && fact.inputTokens.cacheRead !== undefined);
  let cache: SessionUsageSummary["cache"] = { coverage: "none" };
  if (cacheRelevant.length > 0 && cacheComplete.length > 0) {
    const coverage = cacheComplete.length === cacheRelevant.length ? "complete" : "partial";
    const totalInput = cacheComplete.reduce((sum, fact) => sum + fact.inputTokens!.total!, 0);
    const cacheRead = cacheComplete.reduce((sum, fact) => sum + fact.inputTokens!.cacheRead!, 0);
    cache = totalInput > 0
      ? { hitRate: cacheRead / totalInput, coverage }
      : { coverage };
  }

  const billableFacts = facts.filter(hasBillableTokens);
  const pricedFacts = billableFacts.filter((fact): fact is RuntimeUsageEventPayload & {
    cost: RuntimeModelStepCost;
  } => fact.cost !== undefined);
  let cost: SessionUsageSummary["cost"] = { coverage: "none" };
  if (billableFacts.length > 0 && pricedFacts.length > 0) {
    cost = {
      totalUsd: pricedFacts.reduce((sum, fact) => sum + fact.cost.totalUsd, 0),
      coverage: pricedFacts.length === billableFacts.length ? "complete" : "partial",
    };
  }

  return {
    completedStepCount: facts.length,
    tokens,
    cache,
    cost,
    integrity,
  };
}

function assignSum(
  target: SessionUsageSummary["tokens"],
  key: keyof SessionUsageSummary["tokens"],
  values: Array<number | undefined>,
) {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length > 0) target[key] = present.reduce((sum, value) => sum + value, 0);
}

function hasBillableTokens(fact: RuntimeUsageEventPayload): boolean {
  return [
    fact.inputTokens?.total,
    fact.inputTokens?.noCache,
    fact.inputTokens?.cacheRead,
    fact.inputTokens?.cacheWrite,
    fact.outputTokens?.total,
  ].some((value) => value !== undefined && value > 0);
}

function usagePayloadEquals(left: RuntimeUsageEventPayload, right: RuntimeUsageEventPayload) {
  return stableSerialize(left) === stableSerialize(right);
}

function emptySummary(): SessionUsageSummary {
  return {
    completedStepCount: 0,
    tokens: {},
    cache: { coverage: "none" },
    cost: { coverage: "none" },
    integrity: "valid",
  };
}

function isSessionUsageSummary(value: unknown): value is SessionUsageSummary {
  return isRecord(value)
    && Number.isSafeInteger(value.completedStepCount)
    && Number(value.completedStepCount) >= 0
    && isRecord(value.tokens)
    && isRecord(value.cache)
    && isRecord(value.cost)
    && (value.integrity === "valid" || value.integrity === "invalid");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
