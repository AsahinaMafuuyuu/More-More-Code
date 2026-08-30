import type { ModelRef, ModeType, ToolContracts } from "@more-more-code/shared";
import type { ProviderUsage } from "./provider-usage";

export type ChatMessageMetadata = {
    mode?: ModeType;
    model?: ModelRef | string;
    durationMs?: number;
    usage?: ProviderUsage;
};

export type TextUIPart = {
    type: "text";
    text: string;
    state?: "streaming" | "done";
    providerMetadata?: Record<string, unknown>;
};

export type ReasoningUIPart = {
    type: "reasoning";
    text: string;
    state?: "streaming" | "done";
    providerMetadata?: Record<string, unknown>;
};

export type StepStartUIPart = { type: "step-start" };

type ToolUIState =
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
    | "output-denied";

type ToolUIBase = {
    toolCallId: string;
    state: ToolUIState;
    input?: unknown;
    output?: unknown;
    errorText?: string;
    approval?: unknown;
    providerMetadata?: Record<string, unknown>;
};

export type ToolUIPart =
    | (ToolUIBase & { type: `tool-${string}`; toolName?: string })
    | (ToolUIBase & { type: "dynamic-tool"; toolName: string });

export type MessagePart = TextUIPart | ReasoningUIPart | StepStartUIPart | ToolUIPart;

export type Message = {
    id: string;
    role: "user" | "assistant" | "system";
    parts: MessagePart[];
    metadata?: ChatMessageMetadata;
};

type InferSchemaInput<T> = T extends { inputSchema: { _input: infer Input } } ? Input : never;

export type ChatTools = {
    [Name in keyof ToolContracts]: {
        input: InferSchemaInput<ToolContracts[Name]>;
        output: unknown;
    };
};

export function isToolUIPart(part: MessagePart): part is ToolUIPart {
    return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

export function getToolName(part: ToolUIPart): string {
    return part.type === "dynamic-tool"
        ? part.toolName ?? "unknown"
        : part.type.slice("tool-".length);
}
