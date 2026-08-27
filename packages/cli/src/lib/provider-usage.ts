import type { LanguageModelUsage } from "ai";
import type {
    RuntimeModelStepCost,
    RuntimePricingSnapshot,
    RuntimeUsageEventPayload,
    RuntimeUsageInputTokens,
    RuntimeUsageOutputTokens,
} from "@more-more-code/harness";
import type { ProviderKind } from "@more-more-code/shared";

export type NormalizedProviderUsage = {
    inputTokens?: RuntimeUsageInputTokens;
    outputTokens?: RuntimeUsageOutputTokens;
};

type RuntimeUsageCompletion = NormalizedProviderUsage & {
    providerId: string;
    providerKind: ProviderKind;
    modelId: string;
    pricing?: RuntimePricingSnapshot;
    cost?: RuntimeModelStepCost;
};

export function createRuntimeUsagePayload(input: {
    correlation: { runId: string; turnId: string; stepId: string };
    completion: RuntimeUsageCompletion;
}): RuntimeUsageEventPayload {
    const { correlation, completion } = input;
    for (const [name, value] of Object.entries(correlation)) {
        if (!value.trim()) throw new Error(`Runtime Usage requires ${name}`);
    }
    return {
        schemaVersion: 1,
        kind: "model.usage",
        ...correlation,
        providerId: completion.providerId,
        providerKind: completion.providerKind,
        modelId: completion.modelId,
        ...(completion.inputTokens ? { inputTokens: structuredClone(completion.inputTokens) } : {}),
        ...(completion.outputTokens ? { outputTokens: structuredClone(completion.outputTokens) } : {}),
        ...(completion.pricing ? { pricing: structuredClone(completion.pricing) } : {}),
        ...(completion.cost ? { cost: structuredClone(completion.cost) } : {}),
    };
}

/**
 * Reduce AI SDK usage into the small provider-independent allowlist that is
 * safe to persist as Runtime telemetry. Missing provider buckets remain
 * missing; explicit zero remains a real reported value.
 */
export function normalizeProviderUsage(usage: LanguageModelUsage): NormalizedProviderUsage {
    const inputTokens = compactTokenGroup({
        total: usage.inputTokens,
        noCache: usage.inputTokenDetails?.noCacheTokens,
        cacheRead: usage.inputTokenDetails?.cacheReadTokens,
        cacheWrite: usage.inputTokenDetails?.cacheWriteTokens,
    });
    const outputTokens = compactTokenGroup({
        total: usage.outputTokens,
        text: usage.outputTokenDetails?.textTokens,
        reasoning: usage.outputTokenDetails?.reasoningTokens,
    });

    return {
        ...(inputTokens ? { inputTokens } : {}),
        ...(outputTokens ? { outputTokens } : {}),
    };
}

function compactTokenGroup<T extends Record<string, number | undefined | null>>(
    values: T,
): { [K in keyof T]?: number } | undefined {
    const output: Partial<Record<keyof T, number>> = {};
    for (const [key, raw] of Object.entries(values) as Array<[keyof T, number | undefined | null]>) {
        if (raw == null) continue;
        assertTokenCount(raw, String(key));
        output[key] = raw;
    }
    return Object.keys(output).length > 0
        ? output as { [K in keyof T]?: number }
        : undefined;
}

function assertTokenCount(value: number, field: string) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Provider usage ${field} must be a non-negative safe integer`);
    }
}
