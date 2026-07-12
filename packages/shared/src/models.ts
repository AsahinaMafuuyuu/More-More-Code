// 定义可用的模型
export type ModelPricing = {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
}

export type SupportedProvider = "openai" | "anthropic" | "mistral" | "google";

type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    pricing: ModelPricing;
}

export const SUPPORTED_CHAT_MODELS = [
    // OpenAI
    // Standard / short context pricing
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

    // Anthropic
    // Claude Sonnet 5 使用 2026-08-31 前 introductory pricing
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

    // Mistral
    {
        id: "mistral-medium-latest",
        provider: "mistral",
        pricing: {
            inputUsdPerMillionTokens: 1.5,
            outputUsdPerMillionTokens: 7.5,
        },
    },
    {
        id: "mistral-small-latest",
        provider: "mistral",
        pricing: {
            inputUsdPerMillionTokens: 0.15,
            outputUsdPerMillionTokens: 0.6,
        },
    },

    // Google Gemini
    // Standard paid tier，文本/图像/视频输入价格
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
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
    return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "gpt-5.5";