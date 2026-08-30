export type ModelPricing = {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
};

export const BUILT_IN_PROVIDER_KINDS = [
    "openai",
    "anthropic",
    "google",
    "deepseek",
] as const;

export type BuiltInProviderKind = (typeof BUILT_IN_PROVIDER_KINDS)[number];
export type ProviderKind = BuiltInProviderKind | "custom";
export type ProviderId = string;

/**
 * Canonical model identity. Provider accounts and model identifiers are data,
 * not a closed TypeScript union, so custom providers can coexist safely.
 */
export type ModelRef = {
    providerId: ProviderId;
    modelId: string;
};

/** @deprecated Prefer BuiltInProviderKind/ProviderKind + ProviderId. */
export type SupportedProvider = BuiltInProviderKind;

type RecommendedChatModelDefinition = {
    id: string;
    provider: BuiltInProviderKind;
    pricing: ModelPricing;
};

/**
 * Recommended model metadata used for defaults, pricing hints, and migration.
 * This is intentionally not an allowlist for Provider Registry model selection.
 */
export const SUPPORTED_CHAT_MODELS = [
    {
        id: "gpt-5.5",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 30,
        },
    },
    {
        id: "gpt-5.4-mini",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 0.75,
            outputUsdPerMillionTokens: 4.5,
        },
    },
    {
        id: "claude-sonnet-5",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 10,
        },
    },
    {
        id: "claude-haiku-4-5",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 5,
        },
    },
    {
        id: "gemini-2.5-flash",
        provider: "google",
        pricing: {
            inputUsdPerMillionTokens: 0.3,
            outputUsdPerMillionTokens: 2.5,
        },
    },
    {
        id: "gemini-2.5-flash-lite",
        provider: "google",
        pricing: {
            inputUsdPerMillionTokens: 0.1,
            outputUsdPerMillionTokens: 0.4,
        },
    },
    {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        pricing: {
            // Peak cache-miss/output hints. The Cost Engine resolves the
            // authoritative DeepSeek peak/off-peak + cache-hit tariff.
            inputUsdPerMillionTokens: 0.44,
            outputUsdPerMillionTokens: 1.32,
        },
    },
    {
        id: "deepseek-v4-pro",
        provider: "deepseek",
        pricing: {
            // Peak cache-miss/output hints; see the Cost Engine tariff.
            inputUsdPerMillionTokens: 1.32,
            outputUsdPerMillionTokens: 3.96,
        },
    },
] as const satisfies readonly RecommendedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
/** @deprecated Recommended model IDs are not the canonical runtime model type. */
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
    return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export function inferModelRefFromLegacyModelId(modelId: string): ModelRef | null {
    const definition = findSupportedChatModel(modelId);
    return definition
        ? { providerId: definition.provider, modelId: definition.id }
        : null;
}

export function modelRefEquals(left: ModelRef | null | undefined, right: ModelRef | null | undefined) {
    return left?.providerId === right?.providerId && left?.modelId === right?.modelId;
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "deepseek-v4-flash";
export const DEFAULT_CHAT_MODEL_REF: ModelRef = {
    providerId: "deepseek",
    modelId: DEFAULT_CHAT_MODEL_ID,
};
