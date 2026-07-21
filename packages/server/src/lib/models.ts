import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { deepSeek, type DeepSeekLanguageModelChatOptions } from '@ai-sdk/deepseek';
import type { ProviderOptions } from "@ai-sdk/provider-utils"

import {
    findSupportedChatModel,
    type SupportedChatModelId,
    type SupportedChatModel,
    type SupportedProvider,
} from "@more-more-code/shared"
import type { LanguageModel } from "ai"

type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"]
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"]
type DeepSeekModelId = Extract<SupportedChatModel, { provider: "deepseek" }>["id"]

export type ResolvedModel = {
    model: LanguageModel;
    provider: SupportedProvider;
    modelId: SupportedChatModelId;
    providerOptions?: ProviderOptions
}

// DeepSeek 模型配置
// 相关配置详见：https://ai-sdk.dev/providers/ai-sdk-providers/deepseek

const DEEPSEEK_PROVIDER_OPTIONS: Partial<Record<DeepSeekModelId, ProviderOptions>> = {
    "deepseek-v4-flash": {
        deepSeek: {
            thinking: {
                type: "enabled",
            },
            reasoningEffort: 'medium',
        } satisfies DeepSeekLanguageModelChatOptions
    },
    "deepseek-v4-pro": {
        deepseek: {
            thinking: {
                type: "enabled",
            },
            reasoningEffort: 'medium',
        } satisfies DeepSeekLanguageModelChatOptions
    },

}

// 该函数抛出一个错误，提示不支持的提供者
function assertUnsupportedProvider(provider: any): never {
    throw new Error(`Unsupported provider: ${provider}`);
}

// 获取 Anthropic 模型
function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
    return {
        model: anthropic(modelId),
        provider: "anthropic",
        modelId,
    };
}

// 获取 OpenAI 模型
function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
    return {
        model: openai(modelId),
        provider: "openai",
        modelId,
    };
}

// 获取 DeepSeek 模型
function resolveDeepSeekModel(modelId: DeepSeekModelId): ResolvedModel {
    return {
        model: deepSeek(modelId),
        provider: "deepseek",
        modelId,
        providerOptions: DEEPSEEK_PROVIDER_OPTIONS[modelId],
    };
}


function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    const provider = model.provider; // 获取模型提供者
    switch (provider) {
        case "anthropic":
            return resolveAnthropicModel(model.id);
        case "openai":
            return resolveOpenAIModel(model.id);
        case "deepseek":
            return resolveDeepSeekModel(model.id);
        default:
            return assertUnsupportedProvider(provider); // 抛出一个错误，提示不支持的提供者
    }
}

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) != null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
    const model = findSupportedChatModel(modelId);
    if (!model) {
        throw new Error(`Unsupported model: ${modelId}`);
    }
    return resolveSupportedChatModel(model);
}