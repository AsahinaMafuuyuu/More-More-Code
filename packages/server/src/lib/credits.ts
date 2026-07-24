import {
    SUPPORTED_CHAT_MODELS,
    findSupportedChatModel,
    type ModelPricing
} from "@more-more-code/shared";
import type { LanguageModelUsage } from "ai";

type CalculateCreditsForUsageParams = {
    provider: string;
    model: string;
    usage: LanguageModelUsage;
}

type BillableUsage = {
    credits: number;
}

type TokenCounts = {
    inputTokens: number;
    outputTokens: number;
}

const TOKENS_PER_MILLION = 1_000_000; // 1 million tokens

const USD_PER_CREDIT = 0.01; // 1 cent per credit

function getTokenCounts(usage: LanguageModelUsage): TokenCounts {
    const inputTokens = usage.inputTokens;
    const outputTokens = usage.outputTokens;

    if (inputTokens == null || outputTokens == null) {
        throw new Error("Input and output token counts must be provided in the usage object.");
    }

    return {
        inputTokens,
        outputTokens,
    }
}

function getModelPricing(provider: string, model: string): ModelPricing {
    const supportedModel = findSupportedChatModel(model);
    if (!supportedModel || supportedModel.provider !== provider) {
        if (!SUPPORTED_CHAT_MODELS
            .some(m => m.provider === provider)
        ) {
            throw new Error(`Unsupported billing provider: ${provider}`);
        }
        throw new Error(`Unsupported model for provider ${provider}: ${model}`);
    }
    return supportedModel.pricing;
}

function estimateCostUsd({
    inputTokens,
    outputTokens
}: TokenCounts,
    pricing: ModelPricing
) {
    return (
        (
            inputTokens * pricing.inputUsdPerMillionTokens +
            outputTokens * pricing.outputUsdPerMillionTokens
        ) / TOKENS_PER_MILLION
    )
}

function convertUsdToCredits(estimatedCostUsd: number): number {
    if (estimatedCostUsd <= 0) {
        return 0;
    }

    return Math.max(1, Math.ceil(estimatedCostUsd / USD_PER_CREDIT));
}

export function calculateCreditsForUsage({
    provider,
    model,
    usage
}: CalculateCreditsForUsageParams): BillableUsage {
    const tokenCounts = getTokenCounts(usage);
    const pricing = getModelPricing(provider, model);
    const estimatedCostUsd = estimateCostUsd(tokenCounts, pricing);
    const credits = convertUsdToCredits(estimatedCostUsd);
    
    return { credits };
}