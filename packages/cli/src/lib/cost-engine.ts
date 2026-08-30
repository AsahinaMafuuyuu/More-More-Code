import {
    SUPPORTED_CHAT_MODELS,
    type ProviderKind,
} from "@more-more-code/shared";
import type {
    RuntimeModelStepCost,
    RuntimePricingSnapshot,
    RuntimeUsageEventPayload,
} from "@more-more-code/harness";

export type PricingRevision = RuntimePricingSnapshot;

export type PricingResolutionInput = {
    providerId: string;
    providerKind: ProviderKind;
    modelId: string;
    at: number;
    revisions?: readonly PricingRevision[];
};

const BUILT_IN_PRICING_REVISIONS: readonly PricingRevision[] = SUPPORTED_CHAT_MODELS.map(
    (definition) => ({
        revisionId: `${definition.provider}/${definition.id}@legacy-catalog-v1`,
        providerId: definition.provider,
        modelId: definition.id,
        effectiveFrom: 0,
        currency: "USD" as const,
        rates: {
            inputNoCacheUsdPerMillionTokens: definition.pricing.inputUsdPerMillionTokens,
            outputUsdPerMillionTokens: definition.pricing.outputUsdPerMillionTokens,
        },
    }),
).filter((revision) => revision.providerId !== "deepseek");

// DeepSeek's current peak/off-peak tariff took effect at 2026-08-16 16:00 UTC.
// Peak windows apply every day, not only on weekdays.
const DEEPSEEK_OFFICIAL_TARIFF_EFFECTIVE_FROM = Date.parse("2026-08-16T16:00:00.000Z");
const DEEPSEEK_PEAK_WINDOWS_UTC = [[1, 4], [6, 10]] as const;

const DEEPSEEK_TIME_OF_USE_RATES = {
    "deepseek-v4-flash": {
        peak: {
            inputNoCacheUsdPerMillionTokens: 0.44,
            cacheReadUsdPerMillionTokens: 0.014,
            outputUsdPerMillionTokens: 1.32,
        },
        offPeak: {
            inputNoCacheUsdPerMillionTokens: 0.22,
            cacheReadUsdPerMillionTokens: 0.007,
            outputUsdPerMillionTokens: 0.66,
        },
    },
    "deepseek-v4-pro": {
        peak: {
            inputNoCacheUsdPerMillionTokens: 1.32,
            cacheReadUsdPerMillionTokens: 0.044,
            outputUsdPerMillionTokens: 3.96,
        },
        offPeak: {
            inputNoCacheUsdPerMillionTokens: 0.66,
            cacheReadUsdPerMillionTokens: 0.022,
            outputUsdPerMillionTokens: 1.98,
        },
    },
} as const;

/** Resolve the immutable pricing basis applicable at the Model Step time. */
export function resolvePricingRevision(input: PricingResolutionInput): PricingRevision | null {
    // Custom OpenAI-compatible transport is a protocol fact, not a billing
    // identity. V1 deliberately has no implicit Custom Provider pricing.
    if (input.providerKind === "custom") return null;

    // DeepSeek V4 uses recurring daily UTC peak/off-peak windows. Resolve
    // that schedule to one concrete immutable snapshot at Model Step time so
    // persisted historical Cost never depends on a later catalog lookup.
    if (input.revisions === undefined
        && input.providerKind === "deepseek"
        && input.providerId === "deepseek") {
        const deepSeekPricing = resolveDeepSeekPricingSnapshot(input.modelId, input.at);
        if (deepSeekPricing) return deepSeekPricing;
    }

    const revisions = input.revisions ?? BUILT_IN_PRICING_REVISIONS;
    const matches = revisions.filter((revision) =>
        revision.providerId === input.providerId
        && revision.modelId === input.modelId
        && revision.effectiveFrom <= input.at
        && (revision.effectiveUntil === undefined || input.at < revision.effectiveUntil));

    if (matches.length === 0) return null;
    return structuredClone(matches.reduce((latest, candidate) =>
        candidate.effectiveFrom > latest.effectiveFrom ? candidate : latest));
}

/**
 * Price only mutually-exclusive Provider-reported buckets. Missing rates or
 * insufficient bucket detail produce unavailable Cost rather than a guess.
 */
export function calculateModelStepCost(
    usage: Pick<RuntimeUsageEventPayload, "inputTokens" | "outputTokens">,
    pricing: RuntimePricingSnapshot,
): RuntimeModelStepCost | null {
    const input = usage.inputTokens;
    const output = usage.outputTokens;
    const rates = pricing.rates;

    const noCache = input?.noCache;
    const cacheRead = input?.cacheRead;
    const cacheWrite = input?.cacheWrite;
    const inputTotal = input?.total;

    if (inputTotal !== undefined && inputTotal > 0) {
        if (noCache === undefined) return null;
        const knownBuckets = noCache + (cacheRead ?? 0) + (cacheWrite ?? 0);
        if (knownBuckets !== inputTotal) return null;
    }
    if ((cacheRead ?? 0) > 0 && rates.cacheReadUsdPerMillionTokens === undefined) return null;
    if ((cacheWrite ?? 0) > 0 && rates.cacheWriteUsdPerMillionTokens === undefined) return null;

    const inputUsd = priceTokens(noCache ?? 0, rates.inputNoCacheUsdPerMillionTokens);
    const cacheReadUsd = priceTokens(cacheRead ?? 0, rates.cacheReadUsdPerMillionTokens ?? 0);
    const cacheWriteUsd = priceTokens(cacheWrite ?? 0, rates.cacheWriteUsdPerMillionTokens ?? 0);
    const outputUsd = priceTokens(output?.total ?? 0, rates.outputUsdPerMillionTokens);
    const totalUsd = roundUsd(inputUsd + cacheReadUsd + cacheWriteUsd + outputUsd);

    return {
        inputUsd,
        cacheReadUsd,
        cacheWriteUsd,
        outputUsd,
        totalUsd,
        quality: "calculated",
    };
}

export function getBuiltInPricingRevisions(): readonly PricingRevision[] {
    return structuredClone(BUILT_IN_PRICING_REVISIONS);
}

function resolveDeepSeekPricingSnapshot(modelId: string, at: number): PricingRevision | null {
    if (!Number.isFinite(at) || at < DEEPSEEK_OFFICIAL_TARIFF_EFFECTIVE_FROM) return null;
    const modelRates = DEEPSEEK_TIME_OF_USE_RATES[
        modelId as keyof typeof DEEPSEEK_TIME_OF_USE_RATES
    ];
    if (!modelRates) return null;

    const peak = isDeepSeekPeakAt(at);
    const interval = resolveDeepSeekTariffInterval(at);
    return {
        revisionId: `deepseek/${modelId}@2026-08-official:${peak ? "peak" : "off-peak"}`,
        providerId: "deepseek",
        modelId,
        effectiveFrom: interval.effectiveFrom,
        effectiveUntil: interval.effectiveUntil,
        currency: "USD",
        rates: structuredClone(peak ? modelRates.peak : modelRates.offPeak),
    };
}

function isDeepSeekPeakAt(at: number) {
    const date = new Date(at);
    const hour = date.getUTCHours();
    return DEEPSEEK_PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end);
}

function resolveDeepSeekTariffInterval(at: number) {
    const date = new Date(at);
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const boundaries = [DEEPSEEK_OFFICIAL_TARIFF_EFFECTIVE_FROM];

    // Two days on either side covers the previous and next daily tariff
    // transition even at the edge of a UTC day.
    for (let dayOffset = -2; dayOffset <= 2; dayOffset += 1) {
        const dayStart = new Date(midnight + dayOffset * 86_400_000);
        for (const [start, end] of DEEPSEEK_PEAK_WINDOWS_UTC) {
            boundaries.push(dayStart.getTime() + start * 3_600_000);
            boundaries.push(dayStart.getTime() + end * 3_600_000);
        }
    }

    const applicable = boundaries.filter((boundary) => boundary <= at);
    const upcoming = boundaries.filter((boundary) => boundary > at);
    return {
        effectiveFrom: Math.max(...applicable),
        effectiveUntil: Math.min(...upcoming),
    };
}

function priceTokens(tokens: number, usdPerMillionTokens: number) {
    return roundUsd(tokens * usdPerMillionTokens / 1_000_000);
}

function roundUsd(value: number) {
    return Math.round((value + Number.EPSILON) * 1e12) / 1e12;
}
