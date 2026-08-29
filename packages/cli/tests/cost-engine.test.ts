import { describe, expect, test } from "bun:test";
import type { RuntimePricingSnapshot, RuntimeUsageEventPayload } from "@more-more-code/harness";
import {
  calculateModelStepCost,
  resolvePricingRevision,
  type PricingRevision,
} from "../src/lib/cost-engine";

const usage: Pick<RuntimeUsageEventPayload, "inputTokens" | "outputTokens"> = {
  inputTokens: {
    total: 1_000,
    noCache: 600,
    cacheRead: 300,
    cacheWrite: 100,
  },
  outputTokens: {
    total: 200,
    reasoning: 50,
  },
};

const revision: PricingRevision = {
  revisionId: "rev-a",
  providerId: "openai",
  modelId: "model-a",
  effectiveFrom: 1_000,
  effectiveUntil: 2_000,
  currency: "USD",
  rates: {
    inputNoCacheUsdPerMillionTokens: 2,
    cacheReadUsdPerMillionTokens: 0.5,
    cacheWriteUsdPerMillionTokens: 2.5,
    outputUsdPerMillionTokens: 10,
  },
};

describe("Pricing resolver", () => {
  test("selects the newest effective historical revision", () => {
    const newer: PricingRevision = {
      ...revision,
      revisionId: "rev-b",
      effectiveFrom: 2_000,
      effectiveUntil: undefined,
      rates: { ...revision.rates, outputUsdPerMillionTokens: 12 },
    };

    expect(resolvePricingRevision({
      providerId: "openai",
      providerKind: "openai",
      modelId: "model-a",
      at: 1_500,
      revisions: [revision, newer],
    })?.revisionId).toBe("rev-a");
    expect(resolvePricingRevision({
      providerId: "openai",
      providerKind: "openai",
      modelId: "model-a",
      at: 2_500,
      revisions: [revision, newer],
    })?.revisionId).toBe("rev-b");
  });

  test("never inherits built-in pricing for a custom provider id", () => {
    expect(resolvePricingRevision({
      providerId: "my-openai-compatible",
      providerKind: "custom",
      modelId: "model-a",
      at: 1_500,
      revisions: [revision],
    })).toBeNull();
  });

  test("resolves official DeepSeek V4 Flash peak pricing in UTC", () => {
    const pricing = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-27T02:00:00.000Z"),
    });

    expect(pricing).toMatchObject({
      revisionId: "deepseek/deepseek-v4-flash@2026-08-official:peak",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      currency: "USD",
      rates: {
        inputNoCacheUsdPerMillionTokens: 0.44,
        cacheReadUsdPerMillionTokens: 0.014,
        outputUsdPerMillionTokens: 1.32,
      },
    });
  });

  test("resolves official DeepSeek V4 Flash off-peak pricing outside UTC peak windows", () => {
    const pricing = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-27T13:00:00.000Z"),
    });

    expect(pricing).toMatchObject({
      revisionId: "deepseek/deepseek-v4-flash@2026-08-official:off-peak",
      rates: {
        inputNoCacheUsdPerMillionTokens: 0.22,
        cacheReadUsdPerMillionTokens: 0.007,
        outputUsdPerMillionTokens: 0.66,
      },
    });
  });

  test("uses the second daily DeepSeek peak window boundary exactly", () => {
    const before = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-27T05:59:59.999Z"),
    });
    const atBoundary = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-27T06:00:00.000Z"),
    });

    expect(before?.revisionId).toEndWith(":off-peak");
    expect(atBoundary?.revisionId).toEndWith(":peak");
  });

  test("applies DeepSeek peak pricing on weekends too", () => {
    const pricing = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-29T06:46:47.744Z"),
    });

    expect(pricing?.revisionId).toBe(
      "deepseek/deepseek-v4-flash@2026-08-official:peak",
    );
    expect(pricing?.rates).toMatchObject({
      inputNoCacheUsdPerMillionTokens: 0.44,
      cacheReadUsdPerMillionTokens: 0.014,
      outputUsdPerMillionTokens: 1.32,
    });
  });

  test("uses the current DeepSeek tariff from its official August 16 effective time", () => {
    const before = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-16T15:59:59.999Z"),
    });
    const after = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-16T16:00:00.000Z"),
    });

    expect(before).toBeNull();
    expect(after).not.toBeNull();
  });
});

describe("Cost Engine", () => {
  test("prices mutually exclusive input buckets and output without double charging reasoning", () => {
    const cost = calculateModelStepCost(usage, revision as RuntimePricingSnapshot);
    expect(cost).toEqual({
      inputUsd: 0.0012,
      cacheReadUsd: 0.00015,
      cacheWriteUsd: 0.00025,
      outputUsd: 0.002,
      totalUsd: 0.0036,
      quality: "calculated",
    });
  });

  test("returns unavailable when a positive token bucket lacks a trusted rate", () => {
    const pricing = {
      ...revision,
      rates: {
        inputNoCacheUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 10,
      },
    } satisfies RuntimePricingSnapshot;
    expect(calculateModelStepCost(usage, pricing)).toBeNull();
  });

  test("allows explicit zero cache usage without requiring a cache rate", () => {
    const pricing = {
      ...revision,
      rates: {
        inputNoCacheUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 10,
      },
    } satisfies RuntimePricingSnapshot;
    expect(calculateModelStepCost({
      inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0 },
      outputTokens: { total: 0 },
    }, pricing)?.totalUsd).toBe(0.002);
  });

  test("calculates DeepSeek V4 Flash cache-aware cost from the resolved tariff", () => {
    const pricing = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-27T13:00:00.000Z"),
    });
    expect(pricing).not.toBeNull();

    const cost = calculateModelStepCost({
      inputTokens: {
        total: 20_000,
        noCache: 4_000,
        cacheRead: 16_000,
      },
      outputTokens: { total: 1_000 },
    }, pricing!);

    expect(cost).toEqual({
      inputUsd: 0.00088,
      cacheReadUsd: 0.000112,
      cacheWriteUsd: 0,
      outputUsd: 0.00066,
      totalUsd: 0.001652,
      quality: "calculated",
    });
  });

  test("prices the observed Saturday DeepSeek request with peak rates", () => {
    const pricing = resolvePricingRevision({
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      at: Date.parse("2026-08-29T06:46:47.744Z"),
    });
    expect(pricing).not.toBeNull();

    expect(calculateModelStepCost({
      inputTokens: { total: 18_326, noCache: 2_454, cacheRead: 15_872 },
      outputTokens: { total: 923, text: 769, reasoning: 154 },
    }, pricing!)).toEqual({
      inputUsd: 0.00107976,
      cacheReadUsd: 0.000222208,
      cacheWriteUsd: 0,
      outputUsd: 0.00121836,
      totalUsd: 0.002520328,
      quality: "calculated",
    });
  });
});
