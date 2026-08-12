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
    type AgentRun,
    type AgentToolCall,
} from "@more-more-code/harness";
import { executeLocalTool } from "../lib/local-tools";
import { createAgentUserMessage } from "../lib/agent-chat-message";
import { LocalModelTransport } from "../lib/local-model-transport";
import { persistSessionMessages } from "../lib/session-store";
import type { ChatTools, Message } from "../lib/chat-types";

export type { Message } from "../lib/chat-types";

type PendingModelStep = {
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
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

export function useChat(sessionId: string, initialMessages: Message[]) {
    const agentLoop = useMemo(() => new AgentLoop(), []);
    const [run, setRun] = useState<AgentRun | null>(null);
    const pendingModelStepRef = useRef<PendingModelStep | null>(null);

    const transport = useMemo(() => {
        return new LocalModelTransport({
            onMessageSnapshot(messages) {
                void persistSessionMessages(sessionId, messages).catch((error) => {
                    console.error("Failed to sync session messages", {
                        sessionId,
                        error,
                    });
                });
            },
        });
    }, [sessionId]);

    const chat = useAiChat<Message>({
        id: sessionId,
        messages: initialMessages,
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

    return {
        messages: chat.messages,
        status: chat.status,
        error: chat.error,
        run,
        submit: (params: {
            userText: string;
            mode: ModeType;
            model: SupportedChatModelId;
        }) => {
            const inputMessageId = crypto.randomUUID();

            return agentLoop.run({
                sessionId,
                inputMessageId,
                onStateChange: setRun,
                adapter: {
                    async runModelStep({ continuation }) {
                        const responseMessage = await runModelRequest(() => {
                            if (continuation) {
                                return chat.sendMessage();
                            }

                            return chat.sendMessage(createAgentUserMessage({
                                id: inputMessageId,
                                text: params.userText,
                                mode: params.mode,
                                model: params.model,
                            }));
                        });

                        return {
                            toolCalls: getPendingToolCalls(responseMessage),
                        };
                    },
                    async runToolStep(toolCall) {
                        try {
                            const output = await executeLocalTool(
                                toolCall.toolName,
                                toolCall.input,
                                params.mode,
                            );

                            await chat.addToolOutput({
                                tool: toolCall.toolName as keyof ChatTools,
                                toolCallId: toolCall.toolCallId,
                                output,
                            });
                        } catch (error) {
                            await chat.addToolOutput({
                                tool: toolCall.toolName as keyof ChatTools,
                                toolCallId: toolCall.toolCallId,
                                state: "output-error",
                                errorText: toError(error).message,
                            });
                        }
                    },
                    abortModelStep: stopModelStep,
                },
            });
        },
        abort: interruptRun,
        interrupt: interruptRun,
    };
}
