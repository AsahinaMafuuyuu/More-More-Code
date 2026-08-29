import { describe, expect, test } from "bun:test";
import { LocalChatRuntime } from "../src/lib/local-chat-runtime";
import type { LocalModelSendInput } from "../src/lib/chat-stream";

describe("LocalChatRuntime", () => {
    test("reduces native stream chunks into one assistant message and attaches tool output", async () => {
        const finished: unknown[] = [];
        const transport = {
            async sendMessages(_input: LocalModelSendInput) {
                return new ReadableStream({
                    start(controller) {
                        controller.enqueue({ type: "start", messageId: "assistant-1", metadata: { mode: "BUILD", model: { providerId: "openai", modelId: "gpt" } } });
                        controller.enqueue({ type: "reasoning-delta", text: "think" });
                        controller.enqueue({
                            type: "part-metadata",
                            target: "reasoning",
                            providerMetadata: { anthropic: { thinkingSignature: "signature-1" } },
                        });
                        controller.enqueue({ type: "text-delta", text: "hello" });
                        controller.enqueue({
                            type: "tool-call",
                            toolCallId: "call-1",
                            toolName: "bash",
                            input: { command: "pwd" },
                            providerMetadata: { google: { thoughtSignature: "tool-signature" } },
                        });
                        controller.enqueue({ type: "finish", metadata: { mode: "BUILD", model: { providerId: "openai", modelId: "gpt" }, durationMs: 12 } });
                        controller.close();
                    },
                });
            },
        };
        const chat = new LocalChatRuntime({
            id: "session",
            messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "go" }] }],
            transport,
            onFinish(input) { finished.push(input); },
        });

        await chat.sendMessage();
        const assistant = chat.getMessages().at(-1)!;
        expect(assistant.id).toBe("assistant-1");
        expect(assistant.parts).toContainEqual({
            type: "reasoning",
            text: "think",
            state: "done",
            providerMetadata: { anthropic: { thinkingSignature: "signature-1" } },
        });
        expect(assistant.parts).toContainEqual({ type: "text", text: "hello", state: "done" });
        expect(assistant.parts).toContainEqual({
            type: "tool-bash",
            toolCallId: "call-1",
            state: "input-available",
            input: { command: "pwd" },
            providerMetadata: { google: { thoughtSignature: "tool-signature" } },
        });
        expect(finished).toHaveLength(1);

        chat.addToolOutput({ tool: "bash", toolCallId: "call-1", output: { stdout: "/tmp" } });
        expect(chat.getMessages().at(-1)?.parts).toContainEqual({
            type: "tool-bash",
            toolCallId: "call-1",
            state: "output-available",
            input: { command: "pwd" },
            output: { stdout: "/tmp" },
            providerMetadata: { google: { thoughtSignature: "tool-signature" } },
        });
    });
});
