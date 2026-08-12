import {
    convertToModelMessages,
    streamText,
    toUIMessageStream,
    validateUIMessages,
    type ChatTransport,
    type LanguageModelUsage,
} from "ai";
import {
    getToolContracts,
    type ModeType,
    type SupportedChatModelId,
    type ToolContracts,
} from "@more-more-code/shared";
import { ContextManager, type ContextRecord } from "@more-more-code/harness";
import type { Message } from "./chat-types";
import { resolveChatModel } from "./models";
import { buildSystemPrompt } from "./system-prompt";

type LocalModelTransportOptions = {
    onMessageSnapshot?: (messages: Message[]) => void;
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const RESERVED_OUTPUT_TOKENS = 8_192;
const CONTEXT_SAFETY_MARGIN_TOKENS = 4_096;
const REQUIRED_TAIL_MESSAGES = 2;

function estimateTokens(value: unknown) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return Math.max(1, Math.ceil(text.length / 4));
}

function projectMessages(messages: Message[], systemPrompt: string) {
    const manager = new ContextManager<Message>();
    const records: ContextRecord<Message>[] = messages.map((message, index) => ({
        id: message.id,
        kind: "history",
        payload: message,
        estimatedTokens: estimateTokens(message),
        required: index >= Math.max(0, messages.length - REQUIRED_TAIL_MESSAGES),
    }));

    return manager.project(records, {
        contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
        safetyMarginTokens: CONTEXT_SAFETY_MARGIN_TOKENS + estimateTokens(systemPrompt),
    });
}

function resolveExecutionConfig(messages: Message[]): {
    mode: ModeType;
    model: SupportedChatModelId;
} {
    const metadata = messages.findLast(
        (message) => message.metadata?.mode && message.metadata?.model,
    )?.metadata;

    if (!metadata?.mode || !metadata.model) {
        throw new Error("Missing mode/model metadata for local model execution");
    }

    return {
        mode: metadata.mode,
        model: metadata.model as SupportedChatModelId,
    };
}

/**
 * AI SDK UI transport that executes one model step in the CLI process.
 *
 * It intentionally performs no HTTP chat call and has no knowledge of cloud
 * persistence. Message snapshots are emitted to the owning CLI application.
 */
export class LocalModelTransport implements ChatTransport<Message> {
    constructor(private readonly options: LocalModelTransportOptions = {}) {}

    async sendMessages({
        messages,
        abortSignal,
    }: Parameters<ChatTransport<Message>["sendMessages"]>[0]) {
        const { mode, model } = resolveExecutionConfig(messages);
        const tools = getToolContracts(mode) as ToolContracts;
        const resolvedModel = resolveChatModel(model);
        const startedAt = Date.now();

        const validatedMessages = await validateUIMessages<Message>({
            messages,
            tools,
        });
        const systemPrompt = buildSystemPrompt({ mode });
        const projection = projectMessages(validatedMessages, systemPrompt);
        const projectedMessages = projection.records.map((record) => record.payload);
        const modelMessages = await convertToModelMessages(projectedMessages, {
            tools,
        });

        this.emitMessageSnapshot(validatedMessages);

        let completedUsage: LanguageModelUsage | undefined;

        const result = streamText({
            model: resolvedModel.model,
            system: systemPrompt,
            messages: modelMessages,
            tools,
            providerOptions: resolvedModel.providerOptions,
            abortSignal,
            onFinish(event) {
                completedUsage = event.totalUsage;
            },
        });

        return toUIMessageStream<typeof tools, Message>({
            stream: result.stream,
            tools,
            originalMessages: validatedMessages,
            messageMetadata({ part }) {
                if (part.type === "start") {
                    return { mode, model };
                }

                if (part.type !== "finish") return undefined;

                return {
                    mode,
                    model,
                    durationMs: Date.now() - startedAt,
                    ...(completedUsage ? { usage: completedUsage } : {}),
                };
            },
            onEnd: ({ messages: completedMessages }) => {
                this.emitMessageSnapshot(completedMessages);
            },
            onError(error) {
                return error instanceof Error ? error.message : String(error);
            },
        });
    }

    async reconnectToStream() {
        // Model streams are local process resources. Session recovery happens
        // from persisted messages rather than by reconnecting to a server stream.
        return null;
    }

    private emitMessageSnapshot(messages: Message[]) {
        this.options.onMessageSnapshot?.(structuredClone(messages));
    }
}
