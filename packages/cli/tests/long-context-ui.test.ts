import { describe, expect, test } from "bun:test";
import { LocalChatRuntime } from "../src/lib/local-chat-runtime";
import type { LocalModelSendInput } from "../src/lib/chat-stream";
import type { Message } from "../src/lib/chat-types";
import {
  DEFAULT_TRANSCRIPT_ROUND_BOUNDARY_ALLOWANCE,
  DEFAULT_TRANSCRIPT_WINDOW_MESSAGES,
  projectTranscriptWindow,
} from "../src/lib/transcript-window";
import { createToolUseSummary } from "../src/lib/tool-use-view-model";
import { createCollapsedReasoningPreview } from "../src/components/messages/bot-message";
import { createCollapsedMessageTextPreview } from "../src/components/messages/message-text-disclosure";

function textMessage(index: number, role: Message["role"] = "assistant"): Message {
  return {
    id: `message-${index}`,
    role,
    // ~3.8M ASCII chars across 10k messages: roughly a one-million-token-class
    // transcript for common code/text tokenizers without requiring a Provider.
    parts: [{ type: "text", text: `${index}:` + "x".repeat(384) }],
  };
}

describe("long-context UI bounded-work invariants", () => {
  test("streaming deltas preserve sealed history object identity", async () => {
    const history = Array.from({ length: 10_000 }, (_, index) => (
      textMessage(index, index % 12 === 0 ? "user" : "assistant")
    ));
    const transport = {
      async sendMessages(_input: LocalModelSendInput) {
        return new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "start",
              messageId: "assistant-live",
              metadata: {
                mode: "BUILD",
                model: { providerId: "deepseek", modelId: "deepseek-v4-flash" },
              },
            });
            for (let index = 0; index < 400; index += 1) {
              controller.enqueue({ type: "text-delta", text: "delta" });
            }
            controller.enqueue({
              type: "finish",
              metadata: {
                mode: "BUILD",
                model: { providerId: "deepseek", modelId: "deepseek-v4-flash" },
                durationMs: 10,
              },
            });
            controller.close();
          },
        });
      },
    };
    const chat = new LocalChatRuntime({ id: "session-long", messages: history, transport });
    const first = chat.getMessageAt(0);
    const middle = chat.getMessageAt(5_000);
    const beforeRevision = chat.getSnapshot().messageRevision;

    await chat.sendMessage();

    expect(chat.getMessageAt(0)).toBe(first);
    expect(chat.getMessageAt(5_000)).toBe(middle);
    expect(chat.getSnapshot().messageCount).toBe(10_001);
    expect(chat.getSnapshot().messageRevision).toBeGreaterThan(beforeRevision + 400);
    expect(chat.getMessageAt(10_000)?.parts).toContainEqual({
      type: "text",
      text: "delta".repeat(400),
      state: "done",
    });
  });

  test("materialized transcript stays bounded for 10k-message history", () => {
    const messages = Array.from({ length: 10_000 }, (_, index) => (
      textMessage(index, index % 16 === 0 ? "user" : "assistant")
    ));
    const window = projectTranscriptWindow({
      count: messages.length,
      getMessage: (index) => messages[index],
    });

    expect(window.messages.length).toBeLessThanOrEqual(
      DEFAULT_TRANSCRIPT_WINDOW_MESSAGES + DEFAULT_TRANSCRIPT_ROUND_BOUNDARY_ALLOWANCE,
    );
    expect(window.hiddenMessageCount).toBe(window.startIndex);
    expect(window.endIndex).toBe(messages.length);
    expect(window.messages.at(-1)?.id).toBe("message-9999");
    expect(window.messages[0]?.role).toBe("user");
  });

  test("small transcripts are materialized without semantic changes", () => {
    const messages = [
      textMessage(0, "user"),
      textMessage(1, "assistant"),
      textMessage(2, "assistant"),
    ];
    const window = projectTranscriptWindow({
      count: messages.length,
      getMessage: (index) => messages[index],
    });

    expect(window.hiddenMessageCount).toBe(0);
    expect(window.messages).toEqual(messages);
  });

  test("collapsed ToolUse summary never serializes hidden output", () => {
    let serialized = false;
    const output = {
      toJSON() {
        serialized = true;
        throw new Error("hidden output must not be serialized");
      },
    };

    expect(() => createToolUseSummary({
      toolCallId: "call-1",
      toolName: "bash",
      status: "completed",
      input: { command: "echo ok" },
      output,
    }, 100)).not.toThrow();
    expect(serialized).toBe(false);
  });

  test("collapsed reasoning preview is bounded before it reaches OpenTUI", () => {
    const source = "reasoning ".repeat(20_000);
    const preview = createCollapsedReasoningPreview(source);
    expect(preview.length).toBeLessThan(1_000);
    expect(preview.endsWith("…")).toBe(true);
    expect(source.length).toBeGreaterThan(100_000);
  });

  test("one megatext message is bounded independently of transcript windowing", () => {
    const source = `head-${"x".repeat(1_000_000)}-tail`;
    const preview = createCollapsedMessageTextPreview(source);
    expect(preview.length).toBeLessThan(20_000);
    expect(preview.startsWith("head-")).toBe(true);
    expect(preview.endsWith("-tail")).toBe(true);
    expect(preview).toContain("characters hidden");
  });
});
