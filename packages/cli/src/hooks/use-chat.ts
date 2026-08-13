import { useCallback, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
    getToolName,
    isToolUIPart,
} from "ai";
import {
    type ModeType,
    type SupportedChatModelId,
} from "@more-more-code/shared";
import {
    AgentLoop,
    appendSessionEntry,
    appendSessionTreeMessages,
    getParentSessionEntry,
    getSessionEntry,
    jumpToSessionEntry,
    projectSessionRuntimeState,
    projectSessionTreeMessages,
    restoreSessionTree,
    type AgentInteraction,
    type AgentRun,
    type AgentToolCall,
    type SessionEntryInput,
    type SessionEntryMetadata,
    type SessionRuntimeState,
    type SessionTreeState,
} from "@more-more-code/harness";
import { executeLocalTool } from "../lib/local-tools";
import { createAgentUserMessage } from "../lib/agent-chat-message";
import {
    LocalModelTransport,
    type ContextCompactionEvent,
} from "../lib/local-model-transport";
import { persistSessionState } from "../lib/session-store";
import type { ChatTools, Message } from "../lib/chat-types";

export type { Message } from "../lib/chat-types";

type PendingModelStep = {
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
};

type PromptSelection = {
    mode: ModeType;
    model: SupportedChatModelId;
};

function toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

function getPendingToolCalls(message: Message): AgentToolCall[] {
    const toolCalls: AgentToolCall[] = [];

    for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "input-available") continue;

        toolCalls.push({
            toolCallId: part.toolCallId,
            toolName: getToolName(part),
            input: part.input,
        });
    }

    return toolCalls;
}

function cloneMessages(messages: readonly Message[]) {
    return structuredClone(messages) as Message[];
}

function getInteractionPrompt(
    interaction: AgentInteraction,
    fallback: PromptSelection,
) {
    return {
        id: interaction.inputMessageId ?? interaction.id,
        text: interaction.text,
        mode: (interaction.metadata?.mode as ModeType | undefined) ?? fallback.mode,
        model: (interaction.metadata?.model as SupportedChatModelId | undefined) ?? fallback.model,
    };
}

function getStepMetadata(input: {
    runId: string;
    turnId: string;
    stepId: string;
    inputMessageId?: string;
}): SessionEntryMetadata {
    return {
        runId: input.runId,
        turnId: input.turnId,
        stepId: input.stepId,
        ...(input.inputMessageId ? { inputMessageId: input.inputMessageId } : {}),
    };
}

export function useChat(sessionId: string, persistedSessionState: unknown) {
    const agentLoop = useMemo(() => new AgentLoop(), []);
    const [run, setRun] = useState<AgentRun | null>(null);
    const [busy, setBusy] = useState(false);
    const [sessionTree, setSessionTree] = useState<SessionTreeState<Message>>(() =>
        restoreSessionTree<Message>(persistedSessionState),
    );
    const sessionTreeRef = useRef(sessionTree);
    const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
    const pendingModelStepRef = useRef<PendingModelStep | null>(null);
    const activeModelStepMetadataRef = useRef<SessionEntryMetadata>({});
    const contextCompactionHandlerRef = useRef<((event: ContextCompactionEvent) => void) | null>(null);
    const latestMessagesRef = useRef<Message[]>(
        cloneMessages(projectSessionTreeMessages(sessionTree)),
    );

    const transport = useMemo(() => {
        return new LocalModelTransport({
            onMessageSnapshot(messages) {
                latestMessagesRef.current = cloneMessages(messages);
            },
            onContextCompaction(event) {
                contextCompactionHandlerRef.current?.(event);
            },
        });
    }, []);

    const chat = useAiChat<Message>({
        id: sessionId,
        messages: latestMessagesRef.current,
        transport,
        onFinish({ message, isAbort, isDisconnect, isError }) {
            const pending = pendingModelStepRef.current;
            if (!pending) return;

            pendingModelStepRef.current = null;

            if (isAbort) {
                pending.reject(new Error("Model step was interrupted"));
                return;
            }

            if (isDisconnect) {
                pending.reject(new Error("Model step disconnected"));
                return;
            }

            if (isError) {
                pending.reject(new Error("Model step failed"));
                return;
            }

            pending.resolve(message);
        },
        onError(error) {
            const pending = pendingModelStepRef.current;
            if (!pending) return;

            pendingModelStepRef.current = null;
            pending.reject(error);
        },
    });

    const persistTreeBestEffort = useCallback((state: SessionTreeState<Message>) => {
        const snapshot = structuredClone(state) as SessionTreeState<Message>;
        persistQueueRef.current = persistQueueRef.current
            .catch(() => undefined)
            .then(() => persistSessionState(sessionId, snapshot))
            .catch((error) => {
                console.error("Failed to sync session entry tree", {
                    sessionId,
                    error,
                });
            });
    }, [sessionId]);

    const applyTreeState = useCallback((state: SessionTreeState<Message>, persist = true) => {
        sessionTreeRef.current = state;
        setSessionTree(state);
        if (persist) persistTreeBestEffort(state);
    }, [persistTreeBestEffort]);

    const appendEntry = useCallback((input: SessionEntryInput<Message>) => {
        const nextTree = appendSessionEntry(sessionTreeRef.current, input);
        applyTreeState(nextTree);
        return nextTree;
    }, [applyTreeState]);

    const syncMessagesToTree = useCallback((metadata: SessionEntryMetadata = {}) => {
        const currentTree = sessionTreeRef.current;
        const nextTree = appendSessionTreeMessages(
            currentTree,
            latestMessagesRef.current,
            metadata,
        );
        if (nextTree !== currentTree) applyTreeState(nextTree);
        return nextTree;
    }, [applyTreeState]);

    contextCompactionHandlerRef.current = (event) => {
        const metadata = activeModelStepMetadataRef.current;
        syncMessagesToTree(metadata);
        appendEntry({
            type: "compaction",
            summary: event.summary,
            tokensBefore: event.tokensBefore,
            compactedMessageIds: event.compactedMessageIds,
            retainedTailMessageIds: event.retainedTailMessageIds,
            ...metadata,
        });
    };

    const recordPromptSelection = useCallback((
        selection: PromptSelection,
        metadata: SessionEntryMetadata = {},
    ) => {
        const currentTree = sessionTreeRef.current;
        const runtime = projectSessionRuntimeState(currentTree);
        let nextTree = currentTree;

        if (runtime.model !== selection.model) {
            nextTree = appendSessionEntry(nextTree, {
                type: "model_change",
                model: selection.model,
                ...metadata,
            });
        }
        if (runtime.mode !== selection.mode) {
            nextTree = appendSessionEntry(nextTree, {
                type: "mode_change",
                mode: selection.mode,
                ...metadata,
            });
        }

        if (nextTree !== currentTree) applyTreeState(nextTree);
        return nextTree;
    }, [applyTreeState]);

    const chatStopRef = useRef(chat.stop);
    chatStopRef.current = chat.stop;

    const stopModelStep = useCallback(() => {
        chatStopRef.current();

        const pending = pendingModelStepRef.current;
        if (!pending) return;

        pendingModelStepRef.current = null;
        pending.reject(new Error("Model step was interrupted"));
    }, []);

    const interruptRun = useCallback(() => {
        if (!agentLoop.interrupt()) {
            stopModelStep();
        }
    }, [agentLoop, stopModelStep]);

    function runModelRequest(request: () => Promise<void>) {
        if (pendingModelStepRef.current) {
            return Promise.reject(new Error("A model step is already pending"));
        }

        return new Promise<Message>((resolve, reject) => {
            const pending: PendingModelStep = { resolve, reject };
            pendingModelStepRef.current = pending;

            void request().catch((error) => {
                if (pendingModelStepRef.current !== pending) return;

                pendingModelStepRef.current = null;
                reject(toError(error));
            });
        });
    }

    const jumpToEntry = useCallback((entryId: string): SessionRuntimeState => {
        if (agentLoop.isBusy) {
            throw new Error("Cannot jump session entries while the agent runtime is busy");
        }

        const nextTree = jumpToSessionEntry(sessionTreeRef.current, entryId);
        const messages = cloneMessages(projectSessionTreeMessages(nextTree));
        const runtime = projectSessionRuntimeState(nextTree);

        latestMessagesRef.current = messages;
        chat.setMessages(messages);
        applyTreeState(nextTree);
        return runtime;
    }, [agentLoop, applyTreeState, chat]);

    const jumpToParent = useCallback(() => {
        const parent = getParentSessionEntry(sessionTreeRef.current);
        if (!parent) return null;
        return jumpToEntry(parent.id);
    }, [jumpToEntry]);

    const jumpToRoot = useCallback(() => {
        return jumpToEntry(sessionTreeRef.current.rootEntryId);
    }, [jumpToEntry]);

    return {
        messages: chat.messages,
        status: chat.status,
        error: chat.error,
        run,
        busy,
        sessionTree,
        jumpToEntry,
        jumpToNode: jumpToEntry,
        jumpToParent,
        jumpToRoot,
        recordPromptSelection,
        recordConfigChange: (key: string, value: unknown, previousValue?: unknown) => {
            return appendEntry({
                type: "config_change",
                key,
                value,
                ...(previousValue === undefined ? {} : { previousValue }),
            });
        },
        recordCustomEntry: (customType: string, data: unknown) => {
            return appendEntry({ type: "custom", customType, data });
        },
        submit: async (params: {
            userText: string;
            mode: ModeType;
            model: SupportedChatModelId;
        }) => {
            const inputMessageId = crypto.randomUUID();
            recordPromptSelection(params);
            setBusy(true);

            try {
                let activeExecutionSelection: PromptSelection = {
                    mode: params.mode,
                    model: params.model,
                };
                let activeExecutionInputMessageId: string = inputMessageId;

                const completedRun = await agentLoop.run({
                    sessionId,
                    inputMessageId,
                    onStateChange: setRun,
                    adapter: {
                        async runModelStep({ continuation, interaction, run, turn, step }) {
                            const prompt = interaction
                                ? getInteractionPrompt(interaction, activeExecutionSelection)
                                : continuation
                                    ? null
                                    : {
                                        id: inputMessageId,
                                        text: params.userText,
                                        mode: params.mode,
                                        model: params.model,
                                    };

                            if (prompt) {
                                activeExecutionSelection = {
                                    mode: prompt.mode,
                                    model: prompt.model,
                                };
                                activeExecutionInputMessageId = prompt.id;
                            }

                            const metadata = getStepMetadata({
                                runId: run.id,
                                turnId: turn.id,
                                stepId: step.id,
                                inputMessageId: activeExecutionInputMessageId,
                            });
                            if (prompt) recordPromptSelection(activeExecutionSelection, metadata);
                            activeModelStepMetadataRef.current = metadata;

                            try {
                                const responseMessage = await runModelRequest(() => {
                                    if (prompt) {
                                        return chat.sendMessage(createAgentUserMessage(prompt));
                                    }

                                    return chat.sendMessage();
                                });

                                syncMessagesToTree(metadata);
                                return {
                                    toolCalls: getPendingToolCalls(responseMessage),
                                };
                            } catch (error) {
                                syncMessagesToTree(metadata);
                                const resolved = toError(error);
                                appendEntry({
                                    type: "error",
                                    message: resolved.message,
                                    code: "model_step_failed",
                                    details: { cause: turn.cause },
                                    ...metadata,
                                });
                                throw resolved;
                            }
                        },
                        async runToolStep(toolCall, { run, turn, step }) {
                            const metadata = getStepMetadata({
                                runId: run.id,
                                turnId: turn.id,
                                stepId: step.id,
                                inputMessageId: turn.inputMessageId,
                            });
                            appendEntry({
                                type: "tool_call",
                                toolCallId: toolCall.toolCallId,
                                toolName: toolCall.toolName,
                                input: toolCall.input,
                                ...metadata,
                            });

                            try {
                                const output = await executeLocalTool(
                                    toolCall.toolName,
                                    toolCall.input,
                                    activeExecutionSelection.mode,
                                );

                                await chat.addToolOutput({
                                    tool: toolCall.toolName as keyof ChatTools,
                                    toolCallId: toolCall.toolCallId,
                                    output,
                                });
                                appendEntry({
                                    type: "tool_result",
                                    toolCallId: toolCall.toolCallId,
                                    toolName: toolCall.toolName,
                                    output,
                                    ...metadata,
                                });
                            } catch (error) {
                                const resolved = toError(error);
                                await chat.addToolOutput({
                                    tool: toolCall.toolName as keyof ChatTools,
                                    toolCallId: toolCall.toolCallId,
                                    state: "output-error",
                                    errorText: resolved.message,
                                });
                                appendEntry({
                                    type: "tool_result",
                                    toolCallId: toolCall.toolCallId,
                                    toolName: toolCall.toolName,
                                    error: resolved.message,
                                    ...metadata,
                                });
                                appendEntry({
                                    type: "error",
                                    message: resolved.message,
                                    code: "tool_execution_failed",
                                    details: {
                                        toolCallId: toolCall.toolCallId,
                                        toolName: toolCall.toolName,
                                    },
                                    ...metadata,
                                });
                            }
                        },
                        abortModelStep: stopModelStep,
                    },
                });

                syncMessagesToTree({
                    runId: completedRun.id,
                    inputMessageId,
                });
                if (completedRun.status === "failed" && completedRun.error) {
                    appendEntry({
                        type: "error",
                        message: completedRun.error,
                        code: "run_failed",
                        runId: completedRun.id,
                        inputMessageId,
                    });
                }

                return completedRun;
            } finally {
                setBusy(false);
            }
        },
        steer: (params: {
            userText: string;
            mode: ModeType;
            model: SupportedChatModelId;
        }) => {
            const queued = agentLoop.steer({
                text: params.userText,
                inputMessageId: crypto.randomUUID(),
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            });
            if (queued) recordPromptSelection(params, {
                runId: agentLoop.currentRun?.id,
            });
            return queued;
        },
        followUp: (params: {
            userText: string;
            mode: ModeType;
            model: SupportedChatModelId;
        }) => {
            const queued = agentLoop.followUp({
                text: params.userText,
                inputMessageId: crypto.randomUUID(),
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            });
            if (queued) recordPromptSelection(params, {
                runId: agentLoop.currentRun?.id,
            });
            return queued;
        },
        abort: interruptRun,
        interrupt: interruptRun,
        waitForIdle: () => agentLoop.waitForIdle(),
        getEntry: (entryId: string) => getSessionEntry(sessionTreeRef.current, entryId),
        getNode: (nodeId: string) => getSessionEntry(sessionTreeRef.current, nodeId),
    };
}
