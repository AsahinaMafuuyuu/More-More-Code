import type { SessionUsageSummary } from "@more-more-code/harness";
import type { CurrentContextUsage } from "./local-model-transport";

export type SessionObservability = {
    readonly context: CurrentContextUsage | null;
    readonly usage: SessionUsageSummary;
    readonly usagePersistenceIncomplete: boolean;
};

export type StatusBarObservability = {
    context: string;
    cost: string;
    cache: string;
};

export function createSessionObservability(input: SessionObservability): SessionObservability {
    return {
        context: input.context ? structuredClone(input.context) : null,
        usage: structuredClone(input.usage),
        usagePersistenceIncomplete: input.usagePersistenceIncomplete,
    };
}

/** Presentation-only formatting. No Usage aggregation or token counting lives here. */
export function formatStatusBarObservability(
    observability: SessionObservability | null | undefined,
): StatusBarObservability {
    if (!observability) {
        return { context: "Ctx —", cost: "API —", cache: "Cache —" };
    }

    const context = observability.context
        ? `Ctx ${observability.context.tokenCountQuality === "estimated" ? "~" : ""}${formatTokens(observability.context.estimatedInputTokens)}/${formatTokens(observability.context.contextWindowTokens)}`
        : "Ctx —";

    const trusted = observability.usage.integrity === "valid";
    const knownCost = observability.usage.cost.totalUsd;
    const costPartial = observability.usagePersistenceIncomplete
        || observability.usage.cost.coverage === "partial";
    const cost = !trusted || knownCost === undefined
        ? "API —"
        : costPartial
            ? `API ≥~$${formatUsd(knownCost)}`
            : observability.usage.cost.coverage === "complete"
                ? `API ~$${formatUsd(knownCost)}`
                : "API —";

    const cache = trusted
        && !observability.usagePersistenceIncomplete
        && observability.usage.cache.coverage === "complete"
        && observability.usage.cache.hitRate !== undefined
        ? `Cache ${Math.round(observability.usage.cache.hitRate * 100)}%`
        : "Cache —";

    return { context, cost, cache };
}

function formatTokens(value: number) {
    if (value < 1_000) return String(value);
    if (value < 1_000_000) return `${stripTrailingZero((value / 1_000).toFixed(1))}k`;
    return `${stripTrailingZero((value / 1_000_000).toFixed(1))}m`;
}

function formatUsd(value: number) {
    if (value < 10) return value.toFixed(4);
    if (value < 1_000) return value.toFixed(2);
    return value.toFixed(0);
}

function stripTrailingZero(value: string) {
    return value.endsWith(".0") ? value.slice(0, -2) : value;
}
