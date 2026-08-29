import {
    findSupportedChatModel,
    inferModelRefFromLegacyModelId,
    type ModelRef,
    type ProviderId,
    type ProviderKind,
} from "@more-more-code/shared";
import type { AgentEnvironment } from "./agent-environment";
import { getAgentEnvironment } from "./agent-environment";
import { resolveProviderAuth, type ResolvedProviderAuth } from "./provider-auth";
import type { ProviderConfig } from "./provider-registry";
import { BUILT_IN_PROVIDER_BASE_URLS } from "./provider-endpoints";
import type { ProviderRequestProtocol } from "./provider-runtime";

export type ProviderModelOptions = {
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
};

export type ResolvedModel = {
    provider: ProviderKind;
    providerId: ProviderId;
    modelId: string;
    protocol: ProviderRequestProtocol;
    endpoint: string;
    auth: ResolvedProviderAuth;
    modelOptions?: ProviderModelOptions;
};

const DEEPSEEK_PROVIDER_OPTIONS: Record<string, ProviderModelOptions | undefined> = {
    "deepseek-v4-flash": { reasoningEffort: "medium" },
    "deepseek-v4-pro": { reasoningEffort: "medium" },
};

function providerModelOptions(providerKind: ProviderKind, modelId: string): ProviderModelOptions | undefined {
    if (providerKind === "deepseek") return DEEPSEEK_PROVIDER_OPTIONS[modelId];
    return undefined;
}

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
        throw new Error(`Model '${ref.modelId}' is not configured for provider '${provider.id}'`);
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

/** Resolve non-secret execution options for presentation and request compilation. */
export function getConfiguredModelOptions(
    modelRef: ModelRef,
    environment: AgentEnvironment = getAgentEnvironment(),
): ProviderModelOptions | undefined {
    const provider = resolveConfiguredProvider(modelRef, environment);
    const options = providerModelOptions(provider.kind, modelRef.modelId);
    return options ? structuredClone(options) : undefined;
}

function customEndpoint(baseURL: string) {
    return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

/** Resolve Provider Registry + Credential Store into a native execution descriptor. */
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
        case "openai":
            if (auth.type !== "api-key" && auth.type !== "codex-oauth") {
                throw new Error(`Unsupported OpenAI auth strategy: ${auth.type}`);
            }
            return {
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
                protocol: "openai-responses",
                endpoint: `${BUILT_IN_PROVIDER_BASE_URLS.openai}/responses`,
                auth,
            };
        case "anthropic":
            if (auth.type !== "api-key") throw new Error(`Unsupported Anthropic auth strategy: ${auth.type}`);
            return {
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
                protocol: "anthropic-messages",
                endpoint: `${BUILT_IN_PROVIDER_BASE_URLS.anthropic}/messages`,
                auth,
            };
        case "deepseek":
            if (auth.type !== "api-key") throw new Error(`Unsupported DeepSeek auth strategy: ${auth.type}`);
            const modelOptions = providerModelOptions(provider.kind, modelRef.modelId);
            return {
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
                protocol: "openai-chat-completions",
                endpoint: `${BUILT_IN_PROVIDER_BASE_URLS.deepseek}/chat/completions`,
                auth,
                ...(modelOptions ? { modelOptions } : {}),
            };
        case "google":
            if (auth.type !== "api-key") throw new Error(`Unsupported Google auth strategy: ${auth.type}`);
            return {
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
                protocol: "google-generative-ai",
                endpoint: `${BUILT_IN_PROVIDER_BASE_URLS.google}/models/${encodeURIComponent(modelRef.modelId)}:streamGenerateContent?alt=sse`,
                auth,
            };
        case "custom":
            if (auth.type !== "api-key" && auth.type !== "bearer" && auth.type !== "none") {
                throw new Error(`Unsupported custom provider auth strategy: ${auth.type}`);
            }
            return {
                provider: provider.kind,
                providerId: provider.id,
                modelId: modelRef.modelId,
                protocol: "openai-chat-completions",
                endpoint: customEndpoint(provider.baseURL),
                auth,
            };
    }
}

export function isRecommendedChatModel(modelId: string) {
    return findSupportedChatModel(modelId) != null;
}

/** @deprecated Use Provider Registry + ModelRef. */
export const isSupportedChatModel = isRecommendedChatModel;
