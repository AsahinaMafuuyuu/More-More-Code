import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { deepSeek } from '@ai-sdk/deepseek';

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