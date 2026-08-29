import type {
    ContextEpochId,
    PromptPrefixIdentity,
    RenderedPrefixDigest,
} from "./cache-identity";
import type { ProviderUsage } from "./provider-usage";

export type CacheRetention = "none" | "short" | "long";

export type NativeToolDefinition = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
};

export type NativeModelContent =
    | { type: "text"; text: string; providerMetadata?: Record<string, unknown> }
    | { type: "reasoning"; text: string; providerMetadata?: Record<string, unknown> }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerMetadata?: Record<string, unknown>;
    }
    | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown; isError?: boolean };

export type NativeModelMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: NativeModelContent[];
};

export type NativeModelRequest = {
    system: string;
    messages: NativeModelMessage[];
    tools: NativeToolDefinition[];
    prefixIdentity?: PromptPrefixIdentity;
    contextEpochId?: ContextEpochId;
    /** Provider-native availability mask. Definitions remain in tools. */
    allowedToolNames?: string[];
    maxOutputTokens?: number;
    temperature?: number;
    cacheRetention?: CacheRetention;
};

export type ProviderFinishReason = "stop" | "tool-calls" | "length" | "content-filter" | "unknown";

export type ProviderStreamEvent =
    | { type: "cache-diagnostic"; renderedPrefix: RenderedPrefixDigest }
    | { type: "text-delta"; text: string }
    | { type: "reasoning-delta"; text: string }
    | {
        type: "part-metadata";
        target: "text" | "reasoning";
        providerMetadata: Record<string, unknown>;
    }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerMetadata?: Record<string, unknown>;
    }
    | { type: "usage"; usage: ProviderUsage }
    | { type: "finish"; reason: ProviderFinishReason };

export type ProviderExecutionOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
    maxRetryDelayMs?: number;
    fetch?: typeof globalThis.fetch;
};

export type ProviderStream = AsyncIterable<ProviderStreamEvent>;
