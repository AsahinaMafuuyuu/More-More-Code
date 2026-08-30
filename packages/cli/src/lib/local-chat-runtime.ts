import { isToolUIPart, type Message, type ToolUIPart } from "./chat-types";
import type { ChatStreamChunk } from "./chat-stream";
import type { LocalModelTransport } from "./local-model-transport";

export type LocalChatStatus = "ready" | "submitted" | "streaming" | "error";

/**
 * Reactive metadata only. The complete transcript deliberately does not live in
 * the external-store snapshot: doing so makes every streaming delta allocate a
 * new history-sized array/object graph. Consumers that need message data read it
 * explicitly from LocalChatRuntime using the monotonic `messageRevision` as the
 * invalidation key.
 */
export type LocalChatSnapshot = Readonly<{
    messageRevision: number;
    messageCount: number;
    activeMessageId: string | null;
    status: LocalChatStatus;
    error: Error | null;
}>;

type LocalChatRuntimeOptions = {
    id: string;
    messages: Message[];
    transport: Pick<LocalModelTransport, "sendMessages">;
    onFinish?: (input: {
        message: Message;
        isAbort: boolean;
        isDisconnect: boolean;
        isError: boolean;
    }) => void;
    onError?: (error: Error) => void;
};

type Listener = () => void;

function cloneMessages(messages: readonly Message[]) {
    return structuredClone(messages) as Message[];
}

function toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Project-owned in-memory chat state. It intentionally does not persist
 * anything; SessionController remains the durable authority.
 *
 * Long-context invariant: finalized history is indexed and stable. A stream
 * chunk replaces only the one assistant message it changes. Full-history
 * cloning is reserved for explicit diagnostic reads, never the hot stream path.
 */
export class LocalChatRuntime {
    private readonly listeners = new Set<Listener>();
    private snapshot: LocalChatSnapshot;
    private activeAbort: AbortController | null = null;
    private messageIds: string[] = [];
    private readonly messagesById = new Map<string, Message>();
    private readonly messageIndexById = new Map<string, number>();
    private readonly toolCallMessageId = new Map<string, string>();

    constructor(private readonly options: LocalChatRuntimeOptions) {
        this.replaceAllMessages(options.messages);
        this.snapshot = Object.freeze({
            messageRevision: 0,
            messageCount: this.messageIds.length,
            activeMessageId: null,
            status: "ready",
            error: null,
        });
    }

    getSnapshot = () => this.snapshot;

    subscribe = (listener: Listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    /** Explicit full-history diagnostic/test read. Never use this per stream tick. */
    getMessages(): Message[] {
        return cloneMessages(this.getMessageReferences());
    }

    getMessageCount(): number {
        return this.messageIds.length;
    }

    /**
     * Read-only-by-contract message reference for bounded UI projection. The
     * runtime replaces changed messages copy-on-write and never mutates a sealed
     * message object in place.
     */
    getMessageAt(index: number): Message | undefined {
        const id = this.messageIds[index];
        return id ? this.messagesById.get(id) : undefined;
    }

    getMessageIndex(messageId: string): number | undefined {
        return this.messageIndexById.get(messageId);
    }

    getLatestAssistantMessage(): Message | undefined {
        for (let index = this.messageIds.length - 1; index >= 0; index -= 1) {
            const message = this.getMessageAt(index);
            if (message?.role === "assistant") return message;
        }
        return undefined;
    }

    setMessages(messages: Message[]) {
        this.replaceAllMessages(messages);
        this.commit({
            messageCount: this.messageIds.length,
            activeMessageId: null,
        }, true);
    }

    async sendMessage(message?: Message) {
        if (this.activeAbort) throw new Error("A model request is already active");
        if (message) this.appendMessage(structuredClone(message));
        const abort = new AbortController();
        this.activeAbort = abort;
        this.commit({
            messageCount: this.messageIds.length,
            status: "submitted",
            error: null,
        }, Boolean(message));

        let assistant: Message | null = null;
        let aborted = false;
        try {
            // One shallow ordered materialization per Model Step is acceptable;
            // LocalModelTransport validates/clones at the Provider boundary.
            const requestMessages = this.getMessageReferences();
            const stream = await this.options.transport.sendMessages({
                trigger: message ? "submit-message" : "continue",
                chatId: this.options.id,
                messageId: message?.id,
                messages: requestMessages,
                abortSignal: abort.signal,
            });
            const reader = stream.getReader();
            this.commit({ status: "streaming" });
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                assistant = this.reduceChunk(assistant, next.value);
            }

            if (assistant) {
                const finalized = structuredClone(assistant) as Message;
                this.commit({ status: "ready", error: null });
                this.options.onFinish?.({
                    message: finalized,
                    isAbort: false,
                    isDisconnect: false,
                    isError: false,
                });
            } else {
                this.commit({ status: "ready", error: null });
            }
        } catch (error) {
            const resolved = toError(error);
            aborted = abort.signal.aborted || resolved.name === "AbortError";
            this.commit({ status: aborted ? "ready" : "error", error: aborted ? null : resolved });
            if (assistant && aborted) {
                this.options.onFinish?.({
                    message: structuredClone(assistant) as Message,
                    isAbort: true,
                    isDisconnect: false,
                    isError: false,
                });
            } else if (!aborted) {
                this.options.onError?.(resolved);
            }
            throw resolved;
        } finally {
            if (this.activeAbort === abort) this.activeAbort = null;
        }
    }

    addToolOutput(input: {
        tool: string;
        toolCallId: string;
        state?: "output-error";
        errorText?: string;
        output?: unknown;
    }) {
        const messageId = this.toolCallMessageId.get(input.toolCallId);
        if (!messageId) {
            throw new Error(`Cannot attach output for unknown tool call '${input.toolCallId}'`);
        }
        const current = this.messagesById.get(messageId);
        if (!current) {
            throw new Error(`Cannot attach output for unknown tool call '${input.toolCallId}'`);
        }
        const partIndex = current.parts.findIndex((candidate): candidate is ToolUIPart => (
            isToolUIPart(candidate) && candidate.toolCallId === input.toolCallId
        ));
        if (partIndex < 0) {
            throw new Error(`Cannot attach output for unknown tool call '${input.toolCallId}'`);
        }

        const parts = [...current.parts];
        const part = { ...(parts[partIndex] as ToolUIPart) };
        if (input.state === "output-error") {
            part.state = "output-error";
            part.errorText = input.errorText ?? "Tool execution failed";
            delete part.output;
        } else {
            part.state = "output-available";
            part.output = structuredClone(input.output);
            delete part.errorText;
        }
        parts[partIndex] = part;
        this.replaceMessage({ ...current, parts });
        this.commit({}, true);
    }

    stop() {
        this.activeAbort?.abort();
    }

    dispose() {
        this.stop();
        this.listeners.clear();
    }

    private reduceChunk(current: Message | null, chunk: ChatStreamChunk): Message | null {
        if (chunk.type === "start") {
            const message: Message = {
                id: chunk.messageId,
                role: "assistant",
                parts: [{ type: "step-start" }],
                metadata: structuredClone(chunk.metadata),
            };
            this.appendMessage(message);
            this.commit({
                messageCount: this.messageIds.length,
                activeMessageId: message.id,
            }, true);
            return message;
        }
        if (!current) throw new Error(`Chat stream emitted '${chunk.type}' before start`);

        const message = this.messagesById.get(current.id);
        if (!message) throw new Error("Active assistant message disappeared from chat state");
        let nextMessage = message;

        if (chunk.type === "text-delta") {
            const parts = [...message.parts];
            const lastIndex = parts.length - 1;
            const last = parts[lastIndex];
            if (last?.type === "text" && last.state === "streaming") {
                parts[lastIndex] = { ...last, text: last.text + chunk.text };
            } else {
                parts.push({ type: "text", text: chunk.text, state: "streaming" });
            }
            nextMessage = { ...message, parts };
        } else if (chunk.type === "reasoning-delta") {
            const parts = [...message.parts];
            const lastIndex = parts.length - 1;
            const last = parts[lastIndex];
            if (last?.type === "reasoning" && last.state === "streaming") {
                parts[lastIndex] = { ...last, text: last.text + chunk.text };
            } else {
                parts.push({ type: "reasoning", text: chunk.text, state: "streaming" });
            }
            nextMessage = { ...message, parts };
        } else if (chunk.type === "part-metadata") {
            const parts = [...message.parts];
            for (let index = parts.length - 1; index >= 0; index -= 1) {
                const part = parts[index];
                if (!part || part.type !== chunk.target) continue;
                parts[index] = {
                    ...part,
                    providerMetadata: {
                        ...(part.providerMetadata ?? {}),
                        ...structuredClone(chunk.providerMetadata),
                    },
                };
                break;
            }
            nextMessage = { ...message, parts };
        } else if (chunk.type === "tool-call") {
            nextMessage = {
                ...message,
                parts: [
                    ...message.parts,
                    {
                        type: `tool-${chunk.toolName}`,
                        toolCallId: chunk.toolCallId,
                        state: "input-available",
                        input: structuredClone(chunk.input),
                        ...(chunk.providerMetadata
                            ? { providerMetadata: structuredClone(chunk.providerMetadata) }
                            : {}),
                    },
                ],
            };
        } else if (chunk.type === "finish") {
            nextMessage = {
                ...message,
                parts: message.parts.map((part) => {
                    if ((part.type === "text" || part.type === "reasoning") && part.state === "streaming") {
                        return { ...part, state: "done" as const };
                    }
                    return part;
                }),
                metadata: { ...message.metadata, ...structuredClone(chunk.metadata) },
            };
        }

        if (nextMessage !== message) {
            this.replaceMessage(nextMessage);
            this.commit({}, true);
        }
        return nextMessage;
    }

    private getMessageReferences(): Message[] {
        const output = new Array<Message>(this.messageIds.length);
        for (let index = 0; index < this.messageIds.length; index += 1) {
            const id = this.messageIds[index]!;
            const message = this.messagesById.get(id);
            if (!message) throw new Error(`Chat message '${id}' is missing from runtime index`);
            output[index] = message;
        }
        return output;
    }

    private replaceAllMessages(messages: readonly Message[]) {
        this.messageIds = [];
        this.messagesById.clear();
        this.messageIndexById.clear();
        this.toolCallMessageId.clear();
        for (const source of messages) {
            // SessionController already hands this runtime an owned projection.
            // Adopting sealed message references avoids a second history-sized
            // deep clone at durable synchronization boundaries. Subsequent live
            // edits are copy-on-write, so adopted history is never mutated.
            this.appendMessage(source);
        }
    }

    private appendMessage(message: Message) {
        if (this.messagesById.has(message.id)) {
            throw new Error(`Duplicate chat message id '${message.id}'`);
        }
        const index = this.messageIds.length;
        this.messageIds.push(message.id);
        this.messagesById.set(message.id, message);
        this.messageIndexById.set(message.id, index);
        this.indexToolParts(message);
    }

    private replaceMessage(message: Message) {
        const current = this.messagesById.get(message.id);
        if (!current) throw new Error(`Cannot replace unknown chat message '${message.id}'`);
        this.unindexToolParts(current);
        this.messagesById.set(message.id, message);
        this.indexToolParts(message);
    }

    private indexToolParts(message: Message) {
        for (const part of message.parts) {
            if (isToolUIPart(part)) this.toolCallMessageId.set(part.toolCallId, message.id);
        }
    }

    private unindexToolParts(message: Message) {
        for (const part of message.parts) {
            if (!isToolUIPart(part)) continue;
            if (this.toolCallMessageId.get(part.toolCallId) === message.id) {
                this.toolCallMessageId.delete(part.toolCallId);
            }
        }
    }

    private commit(patch: Partial<LocalChatSnapshot>, messageChanged = false) {
        this.snapshot = Object.freeze({
            ...this.snapshot,
            ...patch,
            messageCount: this.messageIds.length,
            messageRevision: this.snapshot.messageRevision + (messageChanged ? 1 : 0),
        });
        for (const listener of this.listeners) listener();
    }
}
