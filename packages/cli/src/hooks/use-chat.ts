import { useState, useRef, useCallback, useEffect, act } from "react";
import { EventSourceParserStream } from "eventsource-parser/stream";
import prettyMs from "pretty-ms";
import type { ClientResponse } from "hono/client";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import type { Mode } from "@more-more-code/database/enums";
import {
    chatStreamEventSchema,
    type SupportedChatModelId,
} from "@more-more-code/shared";
import { set } from "zod";
import { is } from "zod/locales";

export type ClientMessagePart = { type: "text"; text: string };

export type Message = {
    id: string;
    role: "user";
    content: string;
    mode: Mode;
    model: SupportedChatModelId;
} | {
    id: string;
    role: "assistant";
    content: string;
    mode: Mode;
    model: SupportedChatModelId;
    parts: ClientMessagePart[];
    duration?: string;
    interrupted?: boolean;
} | {
    id: string;
    role: "error";
    content: string;
};

type StreamingState =
    | { status: "idle" }
    | {
        status: "streaming";
        parts: ClientMessagePart[];
        mode: Mode;
        model: SupportedChatModelId;
    };

type ActiveStream = {
    requestId: string;
    controller: AbortController;
    mode: Mode;
    model: SupportedChatModelId;
    parts: ClientMessagePart[];
    interruptedCaptured: boolean;
}

type SubmitParams = {
    userText: string;
    mode: Mode;
    model: SupportedChatModelId;
}

type RunStreamParams = {
    mode: Mode;
    model: SupportedChatModelId;
    request: (controller: AbortController) => Promise<ClientResponse<unknown>>;
}

export function useChat(
    sessionId: string,
    initialMessages: Message[],
) {
    const [messages, setMessages] =
        useState<Message[]>(initialMessages);

    const [streaming, setStreaming] = useState<StreamingState>({
        status: "idle",
    });

    const activeStreamRef = useRef<ActiveStream | null>(null);

    const updateMessages = useCallback(
        (updater: (prev: Message[]) => Message[]) => {
            setMessages((prev) => updater(prev));
        },
        [],
    );

    const isActiveRequest = useCallback(
        (requestId: string) => {
            return activeStreamRef.current?.requestId === requestId;
        },
        [],
    );

    const emitParts = useCallback((requestId: string, parts: ClientMessagePart[]) => {
        if (!isActiveRequest(requestId)) return;

        const snapshot = [...parts];
        const activeStream = activeStreamRef.current; // 设置快照
        if (!activeStream) return;

        activeStream.parts = snapshot; // 这样做是为了避免在回调函数中修改parts

        setStreaming({
            status: "streaming",
            parts: snapshot,
            mode: activeStream.mode,
            model: activeStream.model,

        });
    }, [isActiveRequest])

    const captureInterruptedMessage = useCallback((activeStream: ActiveStream) => {
        if (activeStream.interruptedCaptured ||
            activeStream.parts.length === 0
        ) {
            return; // 如果已经处理过了，则返回
        }

        activeStream.interruptedCaptured = true; // 标记为已处理
        const parts = [...activeStream.parts]
        const fullText = parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("");

        updateMessages((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                role: "assistant",
                content: fullText,
                mode: activeStream.mode,
                model: activeStream.model,
                parts,
                interrupted: true,
            },
        ]);
    }, [])

    const clearStream = useCallback((requestId: string) => {
        if (!isActiveRequest(requestId)) return;

        activeStreamRef.current = null;
        setStreaming({ status: "idle" });
    }, [isActiveRequest])

    const handleStream = useCallback(async (response: ClientResponse<unknown>, activeStream: ActiveStream) => {
        if (!isActiveRequest(activeStream.requestId)) return;

        if (!response.ok) {
            // 错误处理
            const message = await getErrorMessage(response);
            updateMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "error",
                    content: message,
                },
            ]);

            return;
        }

        const parts: ClientMessagePart[] = [];

        const stream = response.body!
            .pipeThrough(new TextDecoderStream()) // 创建一个TextDecoderStream
            .pipeThrough(new EventSourceParserStream()) // 创建一个EventSourceParserStream

        for await (const { data } of stream) {
            if (!isActiveRequest(activeStream.requestId)) return;

            let event;

            try {
                event = chatStreamEventSchema.parse(JSON.parse(data));
            } catch (error) {
                const message = error instanceof Error ? error.message : "Invalid stream event";
                updateMessages((prev) => [
                    ...prev,
                    {
                        id: crypto.randomUUID(),
                        role: "error",
                        content: message,
                    },
                ]);
                break;
            }

            switch (event.type) {
                case "text-delta": {
                    const last = parts[parts.length - 1];
                    // 如果最后一条消息是text，则追加
                    if (last && last.type === "text") {
                        last.text += event.text;
                    } else {  // 否则创建新的text消息
                        parts.push({
                            type: "text",
                            text: event.text,
                        });
                    }

                    emitParts(activeStream.requestId, parts); // 发送消息
                    break;
                }
                case "done": {
                    if (!isActiveRequest(activeStream.requestId)) return; // 确保 still active

                    const fullText = parts
                        .filter((p) => p.type === "text")
                        .map((p) => p.text)
                        .join(""); // 将所有text消息拼接成完整的文本

                    // 创建新的assistant消息 
                    updateMessages((prev) => [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "assistant",
                            content: fullText,
                            mode: activeStream.mode,
                            model: activeStream.model,
                            duration: prettyMs(event.duration),
                            parts: [...parts],
                        },
                    ]);
                    break;
                }
                case "error": {
                    updateMessages((prev) => [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "error",
                            content: event.message,
                        },
                    ]);
                    break;
                }

            }
        }
    }, [updateMessages, isActiveRequest, emitParts])

    const runStream = useCallback(async ({
        mode, model, request
    }: RunStreamParams) => {
        const controller = new AbortController();
        const activeStream: ActiveStream = {
            requestId: crypto.randomUUID(),
            mode,
            model,
            parts: [],
            controller,
            interruptedCaptured: false,
        };

        activeStreamRef.current = activeStream; // 设置当前流
        setStreaming({
            status: "streaming",
            parts: [],
            mode: mode,
            model: model,
        });

        try {
            const response = await request(controller); // 发送请求
            await handleStream(response, activeStream);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                return;
            }

            if (!isActiveRequest(activeStream.requestId)) return;

            const message = error instanceof Error ? error.message : String(error);
            updateMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "error",
                    content: message,
                },
            ]);
        } finally {
            clearStream(activeStream.requestId); // 清空流
        }
    }, [isActiveRequest, updateMessages, clearStream, handleStream])

    // 中断当前流   
    const stopActiveStream = useCallback((
        capturePartial: boolean
    ) => {
        const activeStream = activeStreamRef.current;
        if (!activeStream) return; // 没有流

        if (capturePartial) {
            captureInterruptedMessage(activeStream); // 捕获中断消息
        }

        activeStreamRef.current = null; // 清空流
        setStreaming({
            status: "idle"
        }); // 设置为idle
        activeStream.controller.abort();

    }, [captureInterruptedMessage]);

    // 恢复之前的流
    const resume = useCallback(async ({
        mode, model }: Omit<SubmitParams, "userText">
    ) => {
        await runStream({
            mode,
            model,
            request: async (controller) => {
                return apiClient.chat[":sessionId"].resume.$post({
                    param: { sessionId }
                }, {
                    init: {
                        signal: controller.signal,
                    }
                })
            }
        })
    }, [runStream, sessionId])

    // 自动resume当用户的对话作为会话结尾并且没有回复的时候
    const hasAutoResumeRef = useRef(false);
    useEffect(() => {
        if (hasAutoResumeRef.current) return;

        const last = initialMessages[initialMessages.length - 1] // 获取最后一条消息
        if (!last || last.role !== "user") return; // 如果不是用户消息则返回

        hasAutoResumeRef.current = true; // 设置为已自动resume

        // 恢复会话
        void resume({
            mode: last.mode,
            model: last.model,
        });
    }, [initialMessages, resume])

    const submit = useCallback(async (
        { userText, mode, model }: SubmitParams
    ) => {
        // 在发送请求之前，展示部分的消息
        stopActiveStream(true); // 中断当前流
        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: userText,
            mode,
            model,
        };

        updateMessages((prev) => [...prev, userMessage]);

        await runStream({
            mode,
            model,
            request: async (controller) => {
                return apiClient.chat[":sessionId"].$post({
                    param: { sessionId },
                    json: {
                        content: userText,
                        mode,
                        model,
                    }
                }, {
                    init: {
                        signal: controller.signal,
                    }
                })
            }
        })
    }, [runStream, sessionId, updateMessages])

    const abort = useCallback(() => {
        stopActiveStream(false); 
    }, [stopActiveStream]);

    const interrupt = useCallback(() => {
        stopActiveStream(true); // 中断当前流
    }, [stopActiveStream]);

    return { submit, streaming, abort, resume, messages, interrupt }; // 返回提交、流、中断、恢复方法
};