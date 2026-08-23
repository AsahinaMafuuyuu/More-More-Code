import { describe, expect, test } from "bun:test";
import { Chat } from "@ai-sdk/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { ModelRef } from "@more-more-code/shared";
import { createAgentUserMessage } from "../src/lib/agent-chat-message";

type TestMessage = UIMessage<{
    mode?: "PLAN" | "BUILD";
    model?: ModelRef | string;
}>;

const transport: ChatTransport<TestMessage> = {
    async sendMessages() {
        return new ReadableStream<UIMessageChunk>({
            start(controller) {
                controller.close();
            },
        });
    },
    async reconnectToStream() {
        return null;
    },
};

describe("agent chat submission", () => {
    test("creates a new user message with a harness-owned id", async () => {
        const chat = new Chat<TestMessage>({
            id: "session-1",
            messages: [],
            transport,
        });

        const request = createAgentUserMessage({
            id: "run-input-1",
            text: "hello",
            mode: "BUILD",
            model: { providerId: "openai", modelId: "gpt-5.6-sol" },
        });

        await expect(chat.sendMessage(request)).resolves.toBeUndefined();

        expect(chat.messages[0]?.id).toBe("run-input-1");
        expect(chat.messages[0]?.role).toBe("user");
    });

    test("can continue the current conversation without creating another user message", async () => {
        const chat = new Chat<TestMessage>({
            id: "session-1",
            messages: [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "hello" }],
                },
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [{ type: "text", text: "working" }],
                },
            ],
            transport,
        });

        await expect(chat.sendMessage()).resolves.toBeUndefined();
        expect(chat.messages).toHaveLength(2);
        expect(chat.messages.at(-1)?.id).toBe("assistant-1");
    });
});
