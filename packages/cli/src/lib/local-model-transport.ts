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
} from "@more-more-code/shared";
import type { Message } from "./chat-types";
import { resolveChatModel } from "./models";
import { buildSystemPrompt } from "./system-prompt";

type LocalModelTransportOptions = {
    onMessageSnapshot?: (messages: Message[]) => void;
};

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
        const tools = getToolContracts(mode);
        const resolvedModel = resolveChatModel(model);
        const startedAt = Date.now();

        const validatedMessages = await validateUIMessages<Message>({
            messages,
            tools,
        });
        const modelMessages = await convertToModelMessages(validatedMessages, {
            tools,
        });

        this.emitMessageSnapshot(validatedMessages);

        let completedUsage: LanguageModelUsage | undefined;

        const result = streamText({
            model: resolvedModel.model,
            system: buildSystemPrompt({ mode }),
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
