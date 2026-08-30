import type { SessionUsageSummary } from "@more-more-code/harness";
import type { CurrentContextUsage } from "./local-model-transport";

export type SessionObservability = {
    readonly context: CurrentContextUsage | null;
    readonly usage: SessionUsageSummary;
    readonly usagePersistenceIncomplete: boolean;
    readonly latestProviderCacheHitRate?: number | null;
};

export type StatusBarObservability = {
    context: string;
    contextUtilizationRatio: number | null;
    cost: string;
    cache: string;
};

export function createSessionObservability(input: SessionObservability): SessionObservability {
    return {
        context: input.context ? structuredClone(input.context) : null,
        usage: structuredClone(input.usage),
        usagePersistenceIncomplete: input.usagePersistenceIncomplete,
        latestProviderCacheHitRate: input.latestProviderCacheHitRate ?? null,
    };
}

/** Presentation-only formatting. No Usage aggregation or token counting lives here. */
export function formatStatusBarObservability(
    observability: SessionObservability | null | undefined,
): StatusBarObservability {
    if (!observability) {
        return {
            context: "—",
            contextUtilizationRatio: null,
            cost: "$—",
            cache: "Cache —",
        };
    }

    const context = observability.context
        ? `${formatTokens(observability.context.estimatedInputTokens)}/${formatTokens(observability.context.contextWindowTokens)}`
        : "—";
    const contextUtilizationRatio = observability.context
        ? clampRatio(
            Number.isFinite(observability.context.utilizationRatio)
                ? observability.context.utilizationRatio
                : observability.context.contextWindowTokens > 0
                    ? observability.context.estimatedInputTokens / observability.context.contextWindowTokens
                    : 0,
        )
        : null;

    const trusted = observability.usage.integrity === "valid";
    const knownCost = observability.usage.cost.totalUsd;
    const costPartial = observability.usagePersistenceIncomplete
        || observability.usage.cost.coverage === "partial";
    const cost = trusted
        && knownCost !== undefined
        && !costPartial
        && observability.usage.cost.coverage === "complete"
        ? `$${formatUsd(knownCost)}`
        : "$—";

    const displayedCacheHitRate = observability.latestProviderCacheHitRate
        ?? observability.usage.cache.hitRate;
    const cache = trusted
        && !observability.usagePersistenceIncomplete
        && observability.usage.cache.coverage === "complete"
        && displayedCacheHitRate !== undefined
        ? `Cache ${Math.round(displayedCacheHitRate * 100)}%`
        : "Cache —";

    return { context, contextUtilizationRatio, cost, cache };
}

function formatTokens(value: number) {
    if (value < 1_000) return String(value);
    if (value < 1_000_000) return `${stripTrailingZero((value / 1_000).toFixed(1))}k`;
    return `${stripTrailingZero((value / 1_000_000).toFixed(1))}m`;
}

function formatUsd(value: number) {
    return value.toFixed(2);
}

function clampRatio(value: number) {
    return Math.max(0, Math.min(1, value));
}

function stripTrailingZero(value: string) {
    return value.endsWith(".0") ? value.slice(0, -2) : value;
}
