import { z } from "zod";

// z.record(keySchema, valueSchema) 用来校验 Record<K, V> 这种键值对象
export const toolCallArgsSchema = z.record(z.string(), z.json());

// 这里用了 z.discriminatedUnion("type", [...])，也就是根据对象里的 type 字段判断当前对象属于哪一种结构
/**
 * 合法示例如下：
 * {
        type: "tool-call",
        id: "call_001",
        name: "searchWeb",
        args: {
            query: "Zod discriminatedUnion"
        },
        result: "搜索结果..."
    }
 * 
 * 
 */
export const messagePartSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("reasoning"),
        text: z.string(),
    }),
    z.object({
        type: z.literal("tool-call"),
        id: z.string(),
        name: z.string(),
        args: toolCallArgsSchema,
        result: z.string().optional(),
    }),
    z.object({
        type: z.literal("text"),
        text: z.string(),
    })
]);

export const messagePartsSchema = z.array(messagePartSchema);

// 从 Zod schema 自动推导 TypeScript 类型。
export type MessagePart = z.infer<typeof messagePartSchema>;

// 它定义的是：聊天流式输出过程中的事件协议。
// 也就是说，messagePartSchema 更像是“最终保存下来的消息结构”，而 chatStreamEventSchema 更像是“传输过程中的增量事件”。
export const chatStreamEventSchema = z.discriminatedUnion("type", [
    // text-delta 表示普通文本增量。
    // 例如模型不是一次性返回完整内容，而是流式返回：
    /**
     * { type: "text-delta", text: "你" }
        { type: "text-delta", text: "好" }
        { type: "text-delta", text: "，" }
        { type: "text-delta", text: "我是 ChatGPT。" }
     * 
     */
    z.object({
        type: z.literal("text-delta"),
        text: z.string(),
    }),

    // reasoning-delta 表示推理增量。
    // 例如模型会根据输入内容进行推理，并返回推理结果：
    /**
     * { type: "reasoning-delta", text: "正在思考..." }
    */
    z.object({
        type: z.literal("reasoning-delta"),
        text: z.string(),
    }),

    // tool-call 描述模型调用的工具。
    // 例如模型会调用一个工具，并返回工具调用结果：
    /**
     * { type: "tool-call", toolCallId: "call_001", toolName: "searchWeb", args: { query: "Zod discriminatedUnion" } }
     * { type: "tool-result", toolCallId: "call_001", result: "搜索结果..." }
    */
    z.object({
        type: z.literal("tool-call"),
        toolCallId: z.string(),
        toolName: z.string(),
        args: toolCallArgsSchema,
    }),

    // tool-result 描述工具调用结果。
    // 例如模型会调用一个工具，并返回工具调用结果：
    /**
     * {
            type: "tool-result",
            toolCallId: "call_001",
            result: "今天上海天气晴，28°C。"
        }
     */
    z.object({
        type: z.literal("tool-result"),
        toolCallId: z.string(),
        result: z.string(),
    }),

    // done 表示完成。
    // 例如模型会返回一个完成的消息：
    /**
     * { type: "done", messageId: "msg_001", duration: 1234 }
    */
    z.object({
        type: z.literal("done"),
        messageId: z.string(),
        duration: z.number(),
    }),

    // error 表示流式过程中发生错误。
    // 例如模型会返回一个错误消息：
    /**
     * {
            type: "error",
            message: "Tool execution failed"
        }
    */
    z.object({
        type: z.literal('error'),
        message: z.string(),
    })
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;