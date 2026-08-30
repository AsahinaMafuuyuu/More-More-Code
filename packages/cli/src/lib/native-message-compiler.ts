import { z } from "zod";
import type { ToolContracts } from "@more-more-code/shared";
import {
    getToolName,
    isToolUIPart,
    type Message,
} from "./chat-types";
import type {
    NativeModelMessage,
    NativeToolDefinition,
} from "./provider-native-protocol";

function serializeToolOutput(value: unknown): unknown {
    if (value === undefined) return null;
    return structuredClone(value);
}

export function compileNativeModelMessages(messages: readonly Message[]): NativeModelMessage[] {
    const output: NativeModelMessage[] = [];
    const emittedCalls = new Set<string>();
    const emittedResults = new Set<string>();

    for (const message of messages) {
        const content: NativeModelMessage["content"] = [];
        const terminalResults: NativeModelMessage["content"] = [];

        for (const part of message.parts) {
            if (part.type === "step-start") continue;
            if (part.type === "text") {
                if (part.text) content.push({
                    type: "text",
                    text: part.text,
                    ...(part.providerMetadata ? { providerMetadata: structuredClone(part.providerMetadata) } : {}),
                });
                continue;
            }
            if (part.type === "reasoning") {
                if (part.text) content.push({
                    type: "reasoning",
                    text: part.text,
                    ...(part.providerMetadata ? { providerMetadata: structuredClone(part.providerMetadata) } : {}),
                });
                continue;
            }
            if (!isToolUIPart(part)) continue;

            const toolName = getToolName(part);
            if (!emittedCalls.has(part.toolCallId)) {
                content.push({
                    type: "tool-call",
                    toolCallId: part.toolCallId,
                    toolName,
                    input: structuredClone(part.input ?? {}),
                    ...(part.providerMetadata ? { providerMetadata: structuredClone(part.providerMetadata) } : {}),
                });
                emittedCalls.add(part.toolCallId);
            }
            if (
                (part.state === "output-available" || part.state === "output-error" || part.state === "output-denied")
                && !emittedResults.has(part.toolCallId)
            ) {
                const isError = part.state === "output-error" || part.state === "output-denied";
                terminalResults.push({
                    type: "tool-result",
                    toolCallId: part.toolCallId,
                    toolName,
                    output: isError
                        ? { error: part.errorText ?? (part.state === "output-denied" ? "Tool execution denied" : "Tool execution failed") }
                        : serializeToolOutput(part.output),
                    ...(isError ? { isError: true } : {}),
                });
                emittedResults.add(part.toolCallId);
            }
        }

        if (content.length > 0) {
            output.push({
                role: message.role,
                content,
            });
        }
        if (terminalResults.length > 0) {
            output.push({ role: "tool", content: terminalResults });
        }
    }

    return output;
}

export function compileNativeTools(tools: ToolContracts): NativeToolDefinition[] {
    return Object.entries(tools)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, contract]) => ({
            name,
            description: contract.description,
            inputSchema: z.toJSONSchema(contract.inputSchema as z.ZodType) as Record<string, unknown>,
        }));
}

export function validateChatMessages(messages: readonly Message[], tools: ToolContracts): Message[] {
    const toolNames = new Set(Object.keys(tools));
    for (const message of messages) {
        if (!message.id?.trim()) throw new Error("Chat message requires a non-empty id");
        if (!Array.isArray(message.parts)) throw new Error(`Chat message '${message.id}' has invalid parts`);
        for (const part of message.parts) {
            if (!isToolUIPart(part)) continue;
            const toolName = getToolName(part);
            if (!toolNames.has(toolName)) {
                throw new Error(`Chat message '${message.id}' references unknown tool '${toolName}'`);
            }
            if (!part.toolCallId?.trim()) {
                throw new Error(`Chat message '${message.id}' contains a tool part without toolCallId`);
            }
        }
    }
    return structuredClone(messages) as Message[];
}
