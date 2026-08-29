import { describe, expect, test } from "bun:test";
import { LocalChatRuntime } from "../src/lib/local-chat-runtime";
import type { Message } from "../src/lib/chat-types";
import type { LocalModelSendInput } from "../src/lib/chat-stream";
import { createAgentUserMessage } from "../src/lib/agent-chat-message";

const transport = {
    async sendMessages(_input: LocalModelSendInput) {
        return new ReadableStream({ start(controller) { controller.close(); } });
    },
};

describe("agent chat submission", () => {
    test("creates a new user message with a harness-owned id", async () => {
        const chat = new LocalChatRuntime({ id: "session-1", messages: [], transport });
        const request = createAgentUserMessage({
            id: "run-input-1",
            text: "hello",
            mode: "BUILD",
            model: { providerId: "openai", modelId: "gpt-5.6-sol" },
        });

        await expect(chat.sendMessage(request)).resolves.toBeUndefined();
        expect(chat.getMessages()[0]?.id).toBe("run-input-1");
        expect(chat.getMessages()[0]?.role).toBe("user");
    });

    test("can continue the current conversation without creating another user message", async () => {
        const messages: Message[] = [
            { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
            { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "working" }] },
        ];
        const chat = new LocalChatRuntime({ id: "session-1", messages, transport });

        await expect(chat.sendMessage()).resolves.toBeUndefined();
        expect(chat.getMessages()).toHaveLength(2);
        expect(chat.getMessages().at(-1)?.id).toBe("assistant-1");
    });
});
