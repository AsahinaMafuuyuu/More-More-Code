import { describe, expect, test } from "bun:test";
import {
  aggregateProviderUsage,
  createRuntimeUsagePayload,
  normalizeProviderUsage,
} from "../src/lib/provider-usage";

describe("Provider Usage normalization", () => {
  test("aggregates auxiliary and primary Provider requests without inventing missing buckets", () => {
    expect(aggregateProviderUsage([
      {
        inputTokens: 100,
        inputNoCacheTokens: 100,
        cacheReadTokens: 0,
        outputTokens: 10,
      },
      {
        inputTokens: 200,
        inputNoCacheTokens: 50,
        cacheReadTokens: 150,
        outputTokens: 20,
      },
    ])).toEqual({
      inputTokens: 300,
      inputNoCacheTokens: 150,
      cacheReadTokens: 150,
      outputTokens: 30,
    });

    expect(aggregateProviderUsage([
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, cacheReadTokens: 150, outputTokens: 20 },
    ])).toEqual({ inputTokens: 300, outputTokens: 30 });
  });
  test("preserves reported buckets, explicit zero, and missing fields", () => {
    const source = {
      inputTokens: 120,
      inputNoCacheTokens: 40,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      outputTokens: 30,
      outputTextTokens: 20,
      outputReasoningTokens: 10,
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
      outputTokens: undefined,
    })).toEqual({
      inputTokens: { total: 25 },
    });
  });

  test("rejects invalid numeric usage rather than coercing it", () => {
    expect(() => normalizeProviderUsage({
      inputTokens: -1,
      outputTokens: 0,
    })).toThrow();
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
