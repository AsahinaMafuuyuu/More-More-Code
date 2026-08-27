import { describe, expect, test } from "bun:test";
import type { LanguageModelUsage } from "ai";
import {
  createRuntimeUsagePayload,
  normalizeProviderUsage,
} from "../src/lib/provider-usage";

describe("Provider Usage normalization", () => {
  test("preserves reported buckets, explicit zero, and missing fields", () => {
    const source: LanguageModelUsage = {
      inputTokens: 120,
      inputTokenDetails: {
        noCacheTokens: 40,
        cacheReadTokens: 80,
        cacheWriteTokens: 0,
      },
      outputTokens: 30,
      outputTokenDetails: {
        textTokens: 20,
        reasoningTokens: 10,
      },
      totalTokens: 150,
    };
    const clone = structuredClone(source);

    expect(normalizeProviderUsage(source)).toEqual({
      inputTokens: {
        total: 120,
        noCache: 40,
        cacheRead: 80,
        cacheWrite: 0,
      },
      outputTokens: {
        total: 30,
        text: 20,
        reasoning: 10,
      },
    });
    expect(source).toEqual(clone);

    expect(normalizeProviderUsage({
      inputTokens: 25,
      inputTokenDetails: {},
      outputTokens: undefined,
      outputTokenDetails: {},
      totalTokens: 25,
    } as LanguageModelUsage)).toEqual({
      inputTokens: { total: 25 },
    });
  });

  test("rejects invalid numeric usage rather than coercing it", () => {
    expect(() => normalizeProviderUsage({
      inputTokens: -1,
      inputTokenDetails: {},
      outputTokens: 0,
      outputTokenDetails: {},
      totalTokens: -1,
    } as LanguageModelUsage)).toThrow();
  });

  test("builds the strict durable Usage payload from active Model Step correlation", () => {
    expect(createRuntimeUsagePayload({
      correlation: { runId: "run-1", turnId: "turn-1", stepId: "step-1" },
      completion: {
        providerId: "deepseek",
        providerKind: "deepseek",
        modelId: "deepseek-v4-flash",
        inputTokens: { total: 10, noCache: 10, cacheRead: 0 },
      },
    })).toEqual({
      schemaVersion: 1,
      kind: "model.usage",
      runId: "run-1",
      turnId: "turn-1",
      stepId: "step-1",
      providerId: "deepseek",
      providerKind: "deepseek",
      modelId: "deepseek-v4-flash",
      inputTokens: { total: 10, noCache: 10, cacheRead: 0 },
    });

    expect(() => createRuntimeUsagePayload({
      correlation: { runId: "", turnId: "turn-1", stepId: "step-1" },
      completion: {
        providerId: "deepseek",
        providerKind: "deepseek",
        modelId: "deepseek-v4-flash",
      },
    })).toThrow("runId");
  });
});
