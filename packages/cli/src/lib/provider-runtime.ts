import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModelUsage } from "ai";
import type { ModeType } from "@more-more-code/shared";
import type { PromptPrefixIdentity } from "./cache-identity";
import type { ResolvedModel } from "./models";

export type ProviderRequestCompilation = {
    providerOptions?: ProviderOptions;
    protocol: "openai-responses" | "provider-default";
};

export type ProviderCacheTelemetry = {
    provider: ResolvedModel["provider"];
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedPromptTokens?: number;
    cacheWriteTokens?: number;
    promptPrefixFingerprint: string;
    toolSetFingerprint: string;
};

export type ProviderAdapter = {
    compile(input: {
        resolvedModel: ResolvedModel;
        mode: ModeType;
        prefixIdentity: PromptPrefixIdentity;
    }): ProviderRequestCompilation;
};

export class OpenAIResponsesAdapter implements ProviderAdapter {
    compile({ resolvedModel, prefixIdentity }: Parameters<ProviderAdapter["compile"]>[0]) {
        const openaiOptions = {
            ...resolvedModel.providerOptions?.openai,
            promptCacheKey: `more-more-code:${prefixIdentity.fingerprint}`,
        } satisfies OpenAILanguageModelResponsesOptions;
        const providerOptions: ProviderOptions = {
            ...(resolvedModel.providerOptions ?? {}),
            openai: openaiOptions,
        };

        return {
            protocol: "openai-responses" as const,
            providerOptions,
        };
    }
}

class DefaultProviderAdapter implements ProviderAdapter {
    compile({ resolvedModel }: Parameters<ProviderAdapter["compile"]>[0]) {
        return {
            protocol: "provider-default" as const,
            providerOptions: resolvedModel.providerOptions,
        };
    }
}

const openAIResponsesAdapter = new OpenAIResponsesAdapter();
const defaultProviderAdapter = new DefaultProviderAdapter();

export function compileProviderRequest(input: {
    resolvedModel: ResolvedModel;
    mode: ModeType;
    prefixIdentity: PromptPrefixIdentity;
}): ProviderRequestCompilation {
    const adapter = input.resolvedModel.provider === "openai"
        ? openAIResponsesAdapter
        : defaultProviderAdapter;
    return adapter.compile(input);
}

export function createProviderCacheTelemetry(input: {
    resolvedModel: ResolvedModel;
    usage?: LanguageModelUsage;
    prefixIdentity: PromptPrefixIdentity;
}): ProviderCacheTelemetry {
    return {
        provider: input.resolvedModel.provider,
        model: input.resolvedModel.modelId,
        ...(input.usage?.inputTokens != null ? { inputTokens: input.usage.inputTokens } : {}),
        ...(input.usage?.outputTokens != null ? { outputTokens: input.usage.outputTokens } : {}),
        ...(input.usage?.inputTokenDetails.cacheReadTokens != null
            ? { cachedPromptTokens: input.usage.inputTokenDetails.cacheReadTokens }
            : {}),
        ...(input.usage?.inputTokenDetails.cacheWriteTokens != null
            ? { cacheWriteTokens: input.usage.inputTokenDetails.cacheWriteTokens }
            : {}),
        promptPrefixFingerprint: input.prefixIdentity.fingerprint,
        toolSetFingerprint: input.prefixIdentity.toolSetFingerprint,
    };
}
