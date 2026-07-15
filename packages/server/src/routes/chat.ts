import { Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamText as aiStreamText } from "ai";
import { db } from "@more-more-code/database/client";
import { Mode, MessageStatus } from "@more-more-code/database/enums";
import { type ChatStreamEvent } from "@more-more-code/shared";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";

const submitSchema = z.object({
    content: z.string(),
    mode: z.enum(Mode),
    model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
    if (!result.success) {
        return c.json({
            error: "Invalid request body"
        }, 400)
    }
})

const activeResumeSessionIds = new Set<string>();
function buildConversationHistory(
    messages: {
        role: "USER" | "ASSISTANT" | "ERROR";
        content: string;
        status: MessageStatus;
    }[]) {
    return messages.flatMap((m) => {
        if (m.role === "ERROR") return [];
        if (m.role === "ASSISTANT" && m.content.length === 0) return [];
        return [
            {
                role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
                content: m.content,
            }
        ]
    });
}

function getResumableUserMessage(
    messages: {
        role: "USER" | "ASSISTANT" | "ERROR";
        model: string;
        mode: Mode;
    }[],
) {
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.role !== "USER") {
        return null;
    }

    return lastMessage;
}


type StreamParams = {
    sessionId: string;
    model: string;
    history: {
        role: "user" | "assistant";
        content: string;
    }[];
    mode: Mode;
    abortController: AbortController;
}

async function streamAIResponse(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    params: StreamParams,
) {
    const { sessionId, model, history, mode, abortController } = params;
    const startTime = Date.now();

    const resolvedModel = resolveChatModel(model);

    let fullText = "";

    const persistInterruptedMessage = async () => {
        if (fullText.length === 0) return;

        const elapsedMs = Date.now() - startTime;

        await db.message.create({
            data: {
                sessionId,
                role: "USER",
                content: fullText,
                status: MessageStatus.INTERRUPTED,
                mode,
                model,
                duration: Math.round(elapsedMs / 1000),
            }
        })
    }

    try {
        const result = aiStreamText({
            model: resolvedModel.model,
            messages: history,
            abortSignal: abortController.signal,
        })

        for await (const part of result.fullStream) {
            if (stream.aborted) break;

            if (part.type === 'text-delta') {
                fullText += part.text;
                const event: ChatStreamEvent = {
                    type: 'text-delta',
                    text: part.text,
                }
                // 发送事件
                await stream.writeSSE({
                    event: 'text-delta',
                    data: JSON.stringify(event),
                })
            }

            if (part.type === 'error') {
                throw part.error;
            }
        }

        // 
        if (stream.aborted || abortController.signal.aborted) {
            await persistInterruptedMessage(); // 保存中断的响应
            return;
        }

        const elapsedMs = Date.now() - startTime;

        // 将响应保存到数据库中
        const assistantMessage = await db.message.create({
            data: {
                sessionId,
                role: "ASSISTANT",
                content: fullText,
                status: MessageStatus.COMPLETE,
                mode,
                model,
                duration: Math.round(elapsedMs / 1000),
            }
        })

        const doneEvent: ChatStreamEvent = {
            type: 'done',
            messageId: assistantMessage.id,
            duration: elapsedMs,
        }

        await stream.writeSSE({
            event: 'done',
            data: JSON.stringify(doneEvent),
        })
    } catch (error) {
        if (abortController.signal.aborted) {
            await persistInterruptedMessage(); // 持久化中断的响应
            return;
        }

        const message = error instanceof Error ? error.message : String(error);

        // 将错误保存到数据库中
        await db.message.create({
            data: {
                sessionId,
                role: "ERROR",
                content: message,
                status: MessageStatus.COMPLETE,
                mode,
                model,
            }
        })

        const errorEvent: ChatStreamEvent = {
            type: 'error',
            message,
        }

        // 发送错误事件
        await stream.writeSSE({
            event: 'error',
            data: JSON.stringify(errorEvent),
        })
    }
}

const app = new Hono()
    .post("/:sessionId/resume", async (c) => {
        const sessionId = c.req.param("sessionId")

        const session = await db.session.findUnique({
            where: {
                id: sessionId,
            },
            include: {
                messages: {
                    orderBy: {
                        createdAt: "asc",
                    }
                }
            }
        });

        if (!session) {
            return c.json({
                error: "Session not found"
            }, 404)
        }

        const resumableMessage = getResumableUserMessage(session.messages) // 最后一条消息

        // 确保最后一条消息是 USER
        if (!resumableMessage) {
            return c.json({
                error: "Session has no pending user message to resume"
            }, 409)
        }

        if (!isSupportedChatModel(resumableMessage.model)) {
            return c.json({
                error: `Session uses Unsupported model: ${resumableMessage.model}`
            }
                , 409)
        }

        if (activeResumeSessionIds.has(sessionId)) {
            return c.json({
                error: "Session is already being resumed"
            }, 409)
        }

        activeResumeSessionIds.add(sessionId); // 添加到正在处理的会话列表

        const history = buildConversationHistory(session.messages); // 构建会话历史
        const abortController = new AbortController(); // 创建一个 AbortController

        try {
            return streamSSE(c,
                async (stream) => {
                    stream.onAbort(() => {
                        abortController.abort();
                    });

                    try {
                        await streamAIResponse(stream, {
                            sessionId,
                            model: resumableMessage.model,
                            history,
                            mode: resumableMessage.mode,
                            abortController,
                        });

                    } finally {
                        activeResumeSessionIds.delete(sessionId); // 从正在处理的会话列表中删除
                    }
                },

                async (err, stream) => {
                    activeResumeSessionIds.delete(sessionId); // 从正在处理的会话列表中删除
                    const message = err instanceof Error ? err.message : String(err);
                    const errorEvent: ChatStreamEvent = {
                        type: 'error',
                        message,
                    }
                    await stream.writeSSE({
                        event: 'error',
                        data: JSON.stringify(errorEvent),
                    })
                },
            )

        } catch (error) {
            activeResumeSessionIds.delete(sessionId); // 从正在处理的会话列表中删除
            throw error;
        }


    })
    .post("/:sessionId", submitValidator, async (c) => {
        const sessionId = c.req.param("sessionId");

        const session = await db.session.findUnique({
            where: {
                id: sessionId,
            },
            include: {
                messages: {
                    orderBy: {
                        createdAt: "asc",
                    }
                }
            }
        });

        if (!session) {
            return c.json({
                error: "Session not found"
            }, 404)
        }

        const data = c.req.valid("json");

        // 创建用户消息
        await db.message.create({
            data: {
                sessionId,
                role: "USER",
                content: data.content,
                status: MessageStatus.COMPLETE,
                mode: data.mode,
                model: data.model,
            }
        });

        const history = buildConversationHistory([
            // 只选中最新的10条消息
            ...session.messages.slice(-10),
            {
                role: "USER" as const,
                content: data.content,
                status: MessageStatus.COMPLETE,
            }
        ]);

        const abortController = new AbortController();

        return streamSSE(c, async (stream) => {
            stream.onAbort(() => {
                abortController.abort(); // 停止所有请求
            });

            await streamAIResponse(stream, {
                sessionId,
                model: data.model,
                history,
                mode: data.mode,
                abortController,
            });
        }, async (err, stream) => {
            const message = err instanceof Error ? err.message : String(err);
            const errorEvent: ChatStreamEvent = {
                type: 'error',
                message,
            }
            await stream.writeSSE({
                event: 'error',
                data: JSON.stringify(errorEvent),
            })
        });
    });
export default app;