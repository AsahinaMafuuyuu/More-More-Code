import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek, type DeepSeekLanguageModelChatOptions } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { FetchFunction, ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import {
    findSupportedChatModel,
    inferModelRefFromLegacyModelId,
    type ModelRef,
    type ProviderId,
    type ProviderKind,
} from "@more-more-code/shared";
import type { AgentEnvironment } from "./agent-environment";
import { getAgentEnvironment } from "./agent-environment";
import { resolveProviderAuth } from "./provider-auth";
import type { ProviderConfig } from "./provider-registry";

export type ResolvedModel = {
    model: LanguageModel;
    provider: ProviderKind;
    providerId: ProviderId;
    modelId: string;
    providerOptions?: ProviderOptions;
};

const DEEPSEEK_PROVIDER_OPTIONS: Record<string, ProviderOptions | undefined> = {
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

export function normalizeModelRef(input: ModelRef | string, providerId?: string): ModelRef {
    if (typeof input !== "string") {
        if (!input.providerId.trim() || !input.modelId.trim()) {
            throw new Error("ModelRef requires providerId and modelId");
        }
        return { providerId: input.providerId, modelId: input.modelId };
    }
    if (providerId) return { providerId, modelId: input };
    const migrated = inferModelRefFromLegacyModelId(input);
    if (!migrated) {
        throw new Error(
            `Legacy model '${input}' has no provider metadata and cannot be migrated deterministically`,
        );
    }
    return migrated;
}

function assertConfiguredModel(provider: ProviderConfig, ref: ModelRef) {
    if (!provider.enabled) throw new Error(`Provider '${provider.id}' is disabled`);
    if (!provider.models.includes(ref.modelId)) {
        throw new Error(
            `Model '${ref.modelId}' is not configured for provider '${provider.id}'`,
        );
    }
}

export function resolveConfiguredProvider(
    modelRef: ModelRef,
    environment: AgentEnvironment = getAgentEnvironment(),
) {
    const provider = environment.providers.get(modelRef.providerId);
    if (!provider) throw new Error(`Unknown provider: ${modelRef.providerId}`);
    assertConfiguredModel(provider, modelRef);
    return provider;
}

/**
 * Resolve a configured ModelRef into an AI SDK LanguageModel. Provider config
 * and credentials are resolved before returning, so missing/invalid auth fails
 * before the Model Step can perform a network side effect.
 */
export async function resolveChatModel(
    modelRef: ModelRef,
    environment: AgentEnvironment = getAgentEnvironment(),
): Promise<ResolvedModel> {
    const provider = resolveConfiguredProvider(modelRef, environment);

    const auth = await resolveProviderAuth({
        provider,
        credentialStore: environment.credentials,
        codexOAuthBroker: environment.codexOAuth,
    });

    switch (provider.kind) {
        case "openai": {
            if (auth.type !== "api-key" && auth.type !== "codex-oauth") {
                throw new Error(`Unsupported OpenAI auth strategy: ${auth.type}`);
            }
            const openai = createOpenAI({ apiKey: auth.value });
            return {
                model: openai.responses(modelRef.modelId),
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
            };
        }
        case "anthropic": {
            if (auth.type !== "api-key") throw new Error(`Unsupported Anthropic auth strategy: ${auth.type}`);
            const anthropic = createAnthropic({ apiKey: auth.value });
            return {
                model: anthropic(modelRef.modelId),
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
            };
        }
        case "deepseek": {
            if (auth.type !== "api-key") throw new Error(`Unsupported DeepSeek auth strategy: ${auth.type}`);
            const deepseek = createDeepSeek({ apiKey: auth.value });
            return {
                model: deepseek(modelRef.modelId),
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
                providerOptions: DEEPSEEK_PROVIDER_OPTIONS[modelRef.modelId],
            };
        }
        case "google": {
            if (auth.type !== "api-key") throw new Error(`Unsupported Google auth strategy: ${auth.type}`);
            // Google exposes an OpenAI-compatible Gemini endpoint. Keeping this
            // transport behind the provider resolver avoids leaking protocol
            // choices into AgentLoop/Context and avoids a second model runtime.
            const google = createOpenAI({
                name: "google",
                baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
                apiKey: auth.value,
            });
            return {
                model: google.chat(modelRef.modelId),
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
            };
        }
        case "custom": {
            let apiKey: string | undefined;
            if (auth.type === "api-key" || auth.type === "bearer") apiKey = auth.value;
            else if (auth.type !== "none") throw new Error(`Unsupported custom provider auth strategy: ${auth.type}`);
            const unauthenticatedFetch = auth.type === "none"
                ? async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                    const requestHeaders = new Headers(init?.headers);
                    requestHeaders.delete("authorization");
                    requestHeaders.delete("x-api-key");
                    return fetch(input, { ...init, headers: requestHeaders });
                }
                : undefined;
            const custom = createOpenAI({
                name: provider.id,
                baseURL: provider.baseURL,
                // The OpenAI SDK requires a non-empty key before invoking its
                // fetch hook. For explicit no-auth providers we supply a
                // non-secret sentinel and remove the generated auth header in
                // the fetch adapter below, preventing ambient OPENAI_API_KEY use.
                apiKey: apiKey ?? "more-more-code-no-auth",
                ...(unauthenticatedFetch ? { fetch: unauthenticatedFetch as FetchFunction } : {}),
            });
            return {
                model: custom.chat(modelRef.modelId),
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
            };
        }
    }
}

export function isRecommendedChatModel(modelId: string) {
    return findSupportedChatModel(modelId) != null;
}

/** @deprecated Use Provider Registry + ModelRef. */
export const isSupportedChatModel = isRecommendedChatModel;
