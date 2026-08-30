import type { ChatMessageMetadata } from "./chat-types";
import type { ProviderUsage } from "./provider-usage";

export type ChatStreamChunk =
    | { type: "start"; messageId: string; metadata: ChatMessageMetadata }
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
    | { type: "finish"; metadata: ChatMessageMetadata; usage?: ProviderUsage };

export type LocalModelSendInput = {
    trigger?: string;
    chatId?: string;
    messageId?: string;
    messages: import("./chat-types").Message[];
    abortSignal?: AbortSignal;
};
