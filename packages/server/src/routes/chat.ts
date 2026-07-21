import { Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamText as aiStreamText, stepCountIs } from "ai";
import { db } from "@more-more-code/database/client";
import { Mode, MessageStatus } from "@more-more-code/database/enums";
import { type ChatStreamEvent, type MessagePart, toolCallArgsSchema, messagePartsSchema } from "@more-more-code/shared";
import type { Prisma } from "@more-more-code/database";
import { createTools } from "../tools";
import { buildSystemPrompt } from "../system-prompt";
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

// 流式响应的参数
type StreamParams = {
    sessionId: string;
    model: string;
    cwd: string | null; // 当前的工作目录
    history: {
        role: "user" | "assistant";
        content: string;
    }[];
    mode: Mode;
    abortController: AbortController;
}

// 根据ai的response列表，来进行对应的渲染，比如渲染tool-call等等
async function streamAIResponse(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    params: StreamParams,
) {
    const { sessionId, model, cwd, history, mode, abortController } = params;
    const startTime = Date.now();
    const tools = cwd ? createTools(cwd, mode) : undefined; // 如果没有cwd，那么就不提供工具
    const parts: MessagePart[] = []; // 包含reasoning、tool-call 以及text等
    const resolvedModel = resolveChatModel(model);

    // 持久化中断消息
    const persistInterruptedMessage = async () => {

        const fullText = parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("");

        if (fullText.length === 0 && parts.length === 0) {
            return;
        }
        
        const elapsedMs = Date.now() - startTime;
        const validatedParts: Prisma.InputJsonValue | undefined = parts
            .length > 0 ?
            messagePartsSchema.parse(parts) :
            undefined;


        await db.message.create({
            data: {
                sessionId,
                role: "ASSISTANT",
                content: fullText,
                status: MessageStatus.INTERRUPTED,
                mode,
                parts: validatedParts,
                model,
                duration: Math.round(elapsedMs / 1000),
            }
        })
    }

    try {
        const result = aiStreamText({
            model: resolvedModel.model,
            system: buildSystemPrompt({cwd, mode}), // 构建系统提示词
            messages: history,
            tools,
            stopWhen: tools? stepCountIs(50) : undefined, // 如果有工具，那么就限制50步 
            abortSignal: abortController.signal,
            providerOptions: resolvedModel.providerOptions,
        })

        // 根据ai中的响应进行渲染
        for await (const part of result.fullStream) {
            if (stream.aborted) break;

            // 需要渲染reasoning
            // 如果前一个也是reasoning，那么就合并
            if (part.type === 'reasoning-delta') {
                const last = parts[parts.length - 1];
                if (last && last.type === 'reasoning') {
                    last.text += part.text;
                } else {
                    parts.push({
                        type: 'reasoning',
                        text: part.text,
                    })
                }
                const event: ChatStreamEvent = {
                    type: 'reasoning-delta',
                    text: part.text,
                }
                //    写入流式响应
                // 发送事件
                await stream.writeSSE({
                    event: 'reasoning-delta',
                    data: JSON.stringify(event),
                })
            }

            if (part.type === 'text-delta') {
                const last = parts[parts.length - 1];
                if (last && last.type === 'text') {
                    last.text += part.text;
                }
                else {
                    parts.push({
                        type: 'text',
                        text: part.text,
                    })
                }
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

            // 工具调用
            if (part.type === 'tool-call') {
                const args = toolCallArgsSchema.parse(part.input); // 校验

                // 由于是工具调用，直接进行工具的调用即可
                parts.push({
                    type: 'tool-call',
                    id: part.toolCallId,
                    name: part.toolName,
                    args
                })
                const event: ChatStreamEvent = {
                    type: 'tool-call',
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    args,
                }

                await stream.writeSSE({
                    event: 'tool-call',
                    data: JSON.stringify(event),
                })

                // 发送事件
                await stream.writeSSE({
                    event: 'text-delta',
                    data: JSON.stringify(event),
                })
            }

            if (part.type === 'tool-result') {
                const resultStr = typeof part.output === 'string' ?
                    part.output : JSON.stringify(part.output);

                // 找到对应的tool-call
                const tcPart = parts.find((p): p is Extract<MessagePart, { type: 'tool-call' }> =>
                    p.type === 'tool-call' && p.id === part.toolCallId)

                // 找到以后添加上结果即可
                if (tcPart) {
                    tcPart.result = resultStr;
                }

                const event: ChatStreamEvent = {
                    type: 'tool-result',
                    toolCallId: part.toolCallId,
                    result: resultStr,
                }

                await stream.writeSSE({
                    event: 'tool-result',
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

        // 获取完整文本
        const fullText = parts
        .filter((p) => p.type === "text")  
        .map((p) => p.text)
        .join("");

        // 创建parts
        const validatedParts: Prisma.InputJsonValue | undefined = parts
            .length > 0 ?
            messagePartsSchema.parse(parts) :
            undefined;

        // 将响应保存到数据库中
        const assistantMessage = await db.message.create({
            data: {
                sessionId,
                role: "ASSISTANT",
                content: fullText,
                parts: validatedParts,
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
                            cwd: session.cwd, // 使用会话的工作目录
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
                cwd: session.cwd, // 使用会话的工作目录
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