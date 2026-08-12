import { anthropic } from "@ai-sdk/anthropic";
import { deepSeek, type DeepSeekLanguageModelChatOptions } from "@ai-sdk/deepseek";
import { openai } from "@ai-sdk/openai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import {
    findSupportedChatModel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from "@more-more-code/shared";

type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"];
type DeepSeekModelId = Extract<SupportedChatModel, { provider: "deepseek" }>["id"];

export type ResolvedModel = {
    model: LanguageModel;
    provider: SupportedProvider;
    modelId: SupportedChatModelId;
    providerOptions?: ProviderOptions;
};

const DEEPSEEK_PROVIDER_OPTIONS: Partial<Record<DeepSeekModelId, ProviderOptions>> = {
    "deepseek-v4-flash": {
        deepseek: {
            thinking: { type: "enabled" },
            reasoningEffort: "medium",
        } satisfies DeepSeekLanguageModelChatOptions,
    },
    "deepseek-v4-pro": {
        deepseek: {
            thinking: { type: "enabled" },
            reasoningEffort: "medium",
        } satisfies DeepSeekLanguageModelChatOptions,
    },
};

function assertUnsupportedProvider(provider: string): never {
    throw new Error(`Unsupported provider: ${provider}`);
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    switch (model.provider) {
        case "anthropic":
            return {
                model: anthropic(model.id as AnthropicModelId),
                provider: model.provider,
                modelId: model.id,
            };
        case "openai":
            return {
                model: openai(model.id as OpenAIModelId),
                provider: model.provider,
                modelId: model.id,
            };
        case "deepseek":
            return {
                model: deepSeek(model.id as DeepSeekModelId),
                provider: model.provider,
                modelId: model.id,
                providerOptions: DEEPSEEK_PROVIDER_OPTIONS[model.id as DeepSeekModelId],
            };
        default:
            return assertUnsupportedProvider(model.provider);
    }
}

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) != null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
    const model = findSupportedChatModel(modelId);
    if (!model) throw new Error(`Unsupported model: ${modelId}`);
    return resolveSupportedChatModel(model);
}
