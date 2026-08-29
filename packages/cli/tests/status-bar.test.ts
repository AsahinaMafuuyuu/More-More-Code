import { describe, expect, test } from "bun:test";
import type { SessionUsageSummary } from "@more-more-code/harness";
import {
  createSessionObservability,
  formatStatusBarObservability,
} from "../src/lib/session-observability";

function usage(overrides: Partial<SessionUsageSummary> = {}): SessionUsageSummary {
  return {
    completedStepCount: 1,
    tokens: { inputTotal: 100, cacheRead: 72, outputTotal: 20 },
    cache: { hitRate: 0.72, coverage: "complete" },
    cost: { totalUsd: 0.0187, coverage: "complete" },
    integrity: "valid",
    ...overrides,
  };
}

const context = {
  estimatedInputTokens: 42_800,
  contextWindowTokens: 128_000,
  inputBudgetTokens: 100_000,
  reservedOutputTokens: 16_000,
  safetyMarginTokens: 12_000,
  utilizationRatio: 42_800 / 128_000,
  tokenCounterId: "estimator-v1",
  tokenCountQuality: "estimated" as const,
};

describe("StatusBar observability formatting", () => {
  test("creates an immutable-by-copy UI state seam independent from source projections", () => {
    const sourceUsage = usage();
    const state = createSessionObservability({
      context,
      usage: sourceUsage,
      usagePersistenceIncomplete: false,
    });
    sourceUsage.tokens.inputTotal = 999;
    expect(state.usage.tokens.inputTotal).toBe(100);
    expect(state.context).not.toBe(context);
  });

  test("formats complete Context, calculated Cost, and cache hit coverage", () => {
    expect(formatStatusBarObservability({
      context,
      usage: usage(),
      usagePersistenceIncomplete: false,
    })).toEqual({
      context: "42.8k/128k",
      contextUtilizationRatio: 42_800 / 128_000,
      cost: "$0.02",
      cache: "Cache 72%",
    });
  });

  test("shows the latest Provider request cache hit instead of hiding it behind the session average", () => {
    expect(formatStatusBarObservability({
      context,
      usage: usage({ cache: { hitRate: 0.595, coverage: "complete" } }),
      usagePersistenceIncomplete: false,
      latestProviderCacheHitRate: 15_872 / 18_326,
    })).toMatchObject({
      cache: "Cache 87%",
    });
  });

  test("preserves exact zero cache and unknown data distinctly", () => {
    expect(formatStatusBarObservability({
      context: { ...context, tokenCountQuality: "exact" },
      usage: usage({ cache: { hitRate: 0, coverage: "complete" } }),
      usagePersistenceIncomplete: false,
    })).toMatchObject({
      context: "42.8k/128k",
      cache: "Cache 0%",
    });

    expect(formatStatusBarObservability({
      context,
      usage: usage({
        cache: { coverage: "none" },
        cost: { coverage: "none" },
      }),
      usagePersistenceIncomplete: false,
    })).toMatchObject({ cost: "$—", cache: "Cache —" });
  });

  test("never renders incomplete persisted history as an exact compact cost", () => {
    expect(formatStatusBarObservability({
      context,
      usage: usage(),
      usagePersistenceIncomplete: true,
    })).toMatchObject({
      cost: "$—",
      cache: "Cache —",
    });

    expect(formatStatusBarObservability({
      context,
      usage: usage({ integrity: "invalid" }),
      usagePersistenceIncomplete: false,
    })).toMatchObject({ cost: "$—", cache: "Cache —" });
  });
});
