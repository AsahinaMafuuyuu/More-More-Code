import { describe, expect, test } from "bun:test";
import {
  RUNTIME_EVENT_SCHEMA_VERSION,
  createRuntimeUsageProjection,
  isRuntimeEventPayload,
  projectSessionUsage,
  reduceRuntimeUsageProjection,
  type RuntimeEvent,
  type RuntimeUsageEventPayload,
} from "../src";

const pricedUsage: RuntimeUsageEventPayload = {
  schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
  kind: "model.usage",
  runId: "run-1",
  turnId: "turn-1",
  stepId: "step-1",
  providerId: "deepseek",
  providerKind: "deepseek",
  modelId: "deepseek-v4-flash",
  inputTokens: {
    total: 100,
    noCache: 25,
    cacheRead: 75,
  },
  outputTokens: {
    total: 20,
    text: 15,
    reasoning: 5,
  },
  pricing: {
    revisionId: "deepseek-v4-flash@2026-08-27",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    effectiveFrom: 1,
    currency: "USD",
    rates: {
      inputNoCacheUsdPerMillionTokens: 0.14,
      cacheReadUsdPerMillionTokens: 0.014,
      outputUsdPerMillionTokens: 0.28,
    },
  },
  cost: {
    inputUsd: 0.0000035,
    cacheReadUsd: 0.00000105,
    cacheWriteUsd: 0,
    outputUsd: 0.0000056,
    totalUsd: 0.00001015,
    quality: "calculated",
  },
};

function event(payload: RuntimeUsageEventPayload, offset = 1): RuntimeEvent<"usage"> {
  return {
    id: `event-${offset}`,
    offset,
    timestamp: 1000 + offset,
    sessionId: "session-1",
    type: "usage",
    payload,
  };
}

describe("Runtime Usage Event contract", () => {
  test("accepts strict model.usage v1 payloads and preserves explicit zero", () => {
    expect(isRuntimeEventPayload("usage", pricedUsage)).toBe(true);
    expect(isRuntimeEventPayload("usage", {
      ...pricedUsage,
      inputTokens: { total: 100, noCache: 100, cacheRead: 0 },
      pricing: undefined,
      cost: undefined,
    })).toBe(false);
    expect(isRuntimeEventPayload("usage", {
      schemaVersion: 1,
      kind: "model.usage",
      runId: "run-1",
      turnId: "turn-1",
      stepId: "step-zero",
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      inputTokens: { total: 100, noCache: 100, cacheRead: 0 },
    })).toBe(true);
  });

  test("rejects unknown/raw fields and invalid token values", () => {
    expect(isRuntimeEventPayload("usage", { ...pricedUsage, prompt: "secret" })).toBe(false);
    expect(isRuntimeEventPayload("usage", {
      ...pricedUsage,
      inputTokens: { total: -1 },
    })).toBe(false);
    expect(isRuntimeEventPayload("usage", {
      ...pricedUsage,
      inputTokens: { total: Number.POSITIVE_INFINITY },
    })).toBe(false);
  });
});

describe("Session Usage projection", () => {
  test("folds exact duplicate step facts once", () => {
    const second: RuntimeUsageEventPayload = {
      ...pricedUsage,
      runId: "run-2",
      turnId: "turn-2",
      stepId: "step-2",
      inputTokens: { total: 100, noCache: 100, cacheRead: 0 },
      outputTokens: { total: 10 },
      cost: { ...pricedUsage.cost!, totalUsd: 0.00002 },
    };
    const summary = projectSessionUsage([
      event(pricedUsage, 1),
      event(structuredClone(pricedUsage), 2),
      event(second, 3),
    ]);

    expect(summary.integrity).toBe("valid");
    expect(summary.completedStepCount).toBe(2);
    expect(summary.tokens.inputTotal).toBe(200);
    expect(summary.cache.coverage).toBe("complete");
    expect(summary.cache.hitRate).toBeCloseTo(0.375);
    expect(summary.cost.coverage).toBe("complete");
  });

  test("marks incompatible duplicate step facts invalid without double charging", () => {
    const conflicting: RuntimeUsageEventPayload = {
      ...pricedUsage,
      inputTokens: { total: 999, noCache: 999, cacheRead: 0 },
    };
    const summary = projectSessionUsage([
      event(pricedUsage, 1),
      event(conflicting, 2),
    ]);

    expect(summary.integrity).toBe("invalid");
    expect(summary.completedStepCount).toBe(1);
    expect(summary.tokens.inputTotal).toBe(100);
  });

  test("distinguishes zero cache hit from unavailable/partial telemetry", () => {
    const zero = {
      ...pricedUsage,
      stepId: "step-zero",
      inputTokens: { total: 100, noCache: 100, cacheRead: 0 },
    } satisfies RuntimeUsageEventPayload;
    expect(projectSessionUsage([event(zero)]).cache).toEqual({
      hitRate: 0,
      coverage: "complete",
    });

    const missing = {
      ...zero,
      stepId: "step-missing",
      inputTokens: { total: 100, noCache: 100 },
    } satisfies RuntimeUsageEventPayload;
    expect(projectSessionUsage([event(missing)]).cache).toEqual({ coverage: "none" });
    expect(projectSessionUsage([event(zero, 1), event(missing, 2)]).cache.coverage).toBe("partial");
  });

  test("incremental projection matches full replay", () => {
    const state = reduceRuntimeUsageProjection(
      reduceRuntimeUsageProjection(createRuntimeUsageProjection(), event(pricedUsage, 1)),
      event({ ...pricedUsage, stepId: "step-2" }, 2),
    );
    expect(state.summary).toEqual(projectSessionUsage([
      event(pricedUsage, 1),
      event({ ...pricedUsage, stepId: "step-2" }, 2),
    ]));
  });

  test("keeps mixed provider/model persisted cost bases stable", () => {
    const second: RuntimeUsageEventPayload = {
      ...pricedUsage,
      runId: "run-2",
      turnId: "turn-2",
      stepId: "step-2",
      providerId: "anthropic",
      providerKind: "anthropic",
      modelId: "claude-sonnet-5",
      pricing: {
        ...pricedUsage.pricing!,
        revisionId: "anthropic-rev-older",
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        rates: {
          inputNoCacheUsdPerMillionTokens: 2,
          cacheReadUsdPerMillionTokens: 0.2,
          outputUsdPerMillionTokens: 10,
        },
      },
      cost: {
        inputUsd: 0.00005,
        cacheReadUsd: 0.000015,
        cacheWriteUsd: 0,
        outputUsd: 0.0002,
        totalUsd: 0.000265,
        quality: "calculated",
      },
    };
    const summary = projectSessionUsage([event(pricedUsage, 1), event(second, 2)]);
    expect(summary.completedStepCount).toBe(2);
    expect(summary.cost.totalUsd).toBeCloseTo(pricedUsage.cost!.totalUsd + second.cost!.totalUsd);
    expect(summary.integrity).toBe("valid");
  });

  test("treats semantically identical duplicate payloads as identical regardless of key order", () => {
    const reordered = {
      kind: "model.usage",
      schemaVersion: 1,
      stepId: pricedUsage.stepId,
      turnId: pricedUsage.turnId,
      runId: pricedUsage.runId,
      modelId: pricedUsage.modelId,
      providerKind: pricedUsage.providerKind,
      providerId: pricedUsage.providerId,
      outputTokens: { reasoning: 5, text: 15, total: 20 },
      inputTokens: { cacheRead: 75, noCache: 25, total: 100 },
      cost: { ...pricedUsage.cost! },
      pricing: { ...pricedUsage.pricing!, rates: { ...pricedUsage.pricing!.rates } },
    } satisfies RuntimeUsageEventPayload;
    expect(projectSessionUsage([event(pricedUsage, 1), event(reordered, 2)])).toMatchObject({
      completedStepCount: 1,
      integrity: "valid",
    });
  });
});
