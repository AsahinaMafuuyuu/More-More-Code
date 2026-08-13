import {
    convertToModelMessages,
    streamText,
    toUIMessageStream,
    validateUIMessages,
    type ChatTransport,
    type LanguageModelUsage,
} from "ai";
import {
    type ModeType,
    type SupportedChatModelId,
    type ToolContracts,
} from "@more-more-code/shared";
import {
    ContextManager,
    type ContextRecord,
    type ModelContextProfile,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";
import { resolveChatModel } from "./models";
import { resolveModelContextProfile } from "./model-context-profile";
import {
    buildSystemPrompt,
    getPromptPrefixSources,
    SYSTEM_PROMPT_VERSION,
} from "./system-prompt";
import { getAgentEnvironment } from "./agent-environment";
import { createPromptPrefixIdentity } from "./cache-identity";
import {
    compileProviderRequest,
    createProviderCacheTelemetry,
    type ProviderCacheTelemetry,
} from "./provider-runtime";

export type ContextCompactionEvent = {
    summary: Message;
    tokensBefore: number;
    compactedMessageIds: string[];
    retainedTailMessageIds: string[];
};

export type PersistedContextCheckpoint = {
    summary: Message;
    compactedMessageIds?: string[];
    retainedTailMessageIds?: string[];
};

type LocalModelTransportOptions = {
    onMessageSnapshot?: (messages: Message[]) => void;
    onContextCompaction?: (event: ContextCompactionEvent) => void;
    getContextCheckpoint?: () => PersistedContextCheckpoint | null;
    onProviderTelemetry?: (telemetry: ProviderCacheTelemetry) => void;
};

function getMessageText(message: Message) {
    return message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}

function truncateSummaryValue(value: unknown, maxChars = 600) {
    if (value === undefined) return "";
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized.length <= maxChars
        ? serialized
        : `${serialized.slice(0, maxChars)}…`;
}

function summarizeNonTextParts(message: Message) {
    const details: string[] = [];

    for (const part of message.parts) {
        if (part.type === "text") continue;
        const record = part as unknown as Record<string, unknown>;
        const isToolPart = part.type.startsWith("tool-") || part.type === "dynamic-tool";
        if (!isToolPart) {
            details.push(`[${part.type}]`);
            continue;
        }

        const toolName = part.type.startsWith("tool-")
            ? part.type.slice("tool-".length)
            : typeof record.toolName === "string"
                ? record.toolName
                : "dynamic-tool";
        const state = typeof record.state === "string" ? record.state : "unknown";
        const input = truncateSummaryValue(record.input);
        const output = truncateSummaryValue(record.output);
        const error = truncateSummaryValue(record.errorText);
        const payload = [
            input ? `input=${input}` : "",
            output ? `output=${output}` : "",
            error ? `error=${error}` : "",
        ].filter(Boolean).join(" ");

        details.push(`[tool ${toolName} state=${state}${payload ? ` ${payload}` : ""}]`);
    }

    return details.join("\n");
}

function buildContextRecords(
    messages: Message[],
    profile: ModelContextProfile,
    checkpoint: PersistedContextCheckpoint | null,
) {
    const compactedIds = new Set(checkpoint?.compactedMessageIds ?? []);
    const activeMessages = messages.filter((message) => !compactedIds.has(message.id));
    let turnIndex = -1;
    const turns: number[] = [];

    for (const message of activeMessages) {
        if (message.role === "user") turnIndex += 1;
        turns.push(Math.max(turnIndex, 0));
    }

    const lastTurn = Math.max(0, ...turns);
    const firstRequiredTurn = Math.max(0, lastTurn - profile.retainedTailTurns + 1);
    const historyRecords = activeMessages.map((message, index): ContextRecord<Message> => {
        const turn = turns[index] ?? 0;
        const retained = turn >= firstRequiredTurn;
        return {
            id: message.id,
            kind: "history",
            payload: message,
            estimatedTokens: profile.tokenCounter.countPayload(message),
            groupId: `turn:${turn}`,
            required: retained,
            category: retained ? "retained-turn" : "historical-conversation",
            stability: retained ? "retained" : "history",
        };
    });

    if (!checkpoint) return historyRecords;
    return [
        {
            id: checkpoint.summary.id,
            kind: "summary" as const,
            payload: checkpoint.summary,
            estimatedTokens: profile.tokenCounter.countPayload(checkpoint.summary),
            required: true,
            groupId: "compacted-prefix",
            category: "compaction-checkpoint" as const,
            stability: "checkpoint" as const,
        },
        ...historyRecords,
    ];
}

function fitTextToTokens(text: string, profile: ModelContextProfile, targetTokens: number) {
    if (profile.tokenCounter.countText(text) <= targetTokens) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (profile.tokenCounter.countText(text.slice(0, middle)) <= targetTokens) low = middle;
        else high = middle - 1;
    }
    return `${text.slice(0, low).trimEnd()}\n[summary truncated]`;
}

function createDeterministicCompactor(profile: ModelContextProfile): {
    compact(input: {
        records: readonly ContextRecord<Message>[];
        targetTokens: number;
    }): ContextRecord<Message> | null;
} {
    return {
        compact({ records, targetTokens }) {
            if (records.length === 0 || targetTokens < 32) return null;

            const lines = records.map((record) => {
                const message = record.payload;
                const text = getMessageText(message).trim();
                const nonText = summarizeNonTextParts(message);
                const body = [text, nonText].filter(Boolean).join("\n") || "[empty message]";
                return `${message.role.toUpperCase()}: ${body}`;
            });
            const header = "[Compacted earlier conversation; preserve facts, decisions and tool chronology when present]";
            const summaryText = fitTextToTokens(
                `${header}\n${lines.join("\n")}`,
                profile,
                Math.max(1, targetTokens - 8),
            );
            const summaryMessage: Message = {
                id: `context-summary:${records[0]!.id}:${records.at(-1)!.id}`,
                role: "assistant",
                parts: [{ type: "text", text: summaryText }],
            };
            const estimatedTokens = profile.tokenCounter.countPayload(summaryMessage);
            if (estimatedTokens > targetTokens) return null;

            return {
                id: summaryMessage.id,
                kind: "summary" as const,
                payload: summaryMessage,
                estimatedTokens,
                groupId: "compacted-prefix",
            };
        },
    };
}

async function projectMessages(
    messages: Message[],
    systemPrompt: string,
    profile: ModelContextProfile,
    checkpoint: PersistedContextCheckpoint | null,
) {
    const manager = new ContextManager<Message>();
    const records = buildContextRecords(messages, profile, checkpoint);
    const deterministicCompactor = createDeterministicCompactor(profile);
    let compactedSource: readonly ContextRecord<Message>[] = [];
    let generatedSummaryId: string | null = null;

    const projection = await manager.projectWithCompaction(
        records,
        {
            contextWindowTokens: profile.contextWindowTokens,
            reservedOutputTokens: profile.reservedOutputTokens,
            safetyMarginTokens:
                profile.safetyMarginTokens + profile.tokenCounter.countText(systemPrompt),
        },
        {
            compact(input) {
                compactedSource = input.records;
                const summary = deterministicCompactor.compact(input);
                generatedSummaryId = summary?.id ?? null;
                return summary;
            },
        },
        { maxSummaryTokens: profile.maxSummaryTokens },
    );

    return { projection, compactedSource, generatedSummaryId };
}

function resolveExecutionConfig(messages: Message[]): {
    mode: ModeType;
    model: SupportedChatModelId;
} {
    const metadata = messages.findLast(
        (message) => message.metadata?.mode && message.metadata?.model,
    )?.metadata;

    if (!metadata?.mode || !metadata.model) {
        throw new Error("Missing mode/model metadata for local model execution");
    }

    return {
        mode: metadata.mode,
        model: metadata.model as SupportedChatModelId,
    };
}

/** Executes one model step locally; context projection is owned by the CLI/Harness boundary. */
export class LocalModelTransport implements ChatTransport<Message> {
    private lastProviderTelemetry: ProviderCacheTelemetry | null = null;

    constructor(private readonly options: LocalModelTransportOptions = {}) {}

    getLastProviderTelemetry() {
        return this.lastProviderTelemetry
            ? structuredClone(this.lastProviderTelemetry)
            : null;
    }

    async sendMessages({
        messages,
        abortSignal,
    }: Parameters<ChatTransport<Message>["sendMessages"]>[0]) {
        const { mode, model } = resolveExecutionConfig(messages);
        const environment = getAgentEnvironment();
        const tools = environment.tools.getModelTools(mode) as ToolContracts;
        const resolvedModel = resolveChatModel(model);
        const contextProfile = resolveModelContextProfile(model);
        const startedAt = Date.now();

        const validatedMessages = await validateUIMessages<Message>({
            messages,
            tools,
        });
        const systemPrompt = buildSystemPrompt({ mode, environment });
        const prefixSources = getPromptPrefixSources(environment);
        const prefixIdentity = createPromptPrefixIdentity({
            provider: resolvedModel.provider,
            model: resolvedModel.modelId,
            mode,
            systemPromptVersion: SYSTEM_PROMPT_VERSION,
            globalInstructions: prefixSources.globalInstructions,
            projectInstructions: prefixSources.projectInstructions,
            skillCatalog: prefixSources.skillCatalog,
            toolSetSnapshot: environment.tools.getToolSetSnapshot(mode),
        });
        const providerRequest = compileProviderRequest({ resolvedModel, mode, prefixIdentity });
        const checkpoint = this.options.getContextCheckpoint?.() ?? null;
        const { projection, compactedSource, generatedSummaryId } = await projectMessages(
            validatedMessages,
            systemPrompt,
            contextProfile,
            checkpoint,
        );
        const projectedMessages = projection.records.map((record) => record.payload);
        const modelMessages = await convertToModelMessages(projectedMessages, { tools });

        this.emitMessageSnapshot(validatedMessages);
        const summaryRecord = generatedSummaryId
            ? projection.records.find((record) => record.id === generatedSummaryId)
            : undefined;
        if (summaryRecord && compactedSource.length > 0) {
            this.options.onContextCompaction?.({
                summary: structuredClone(summaryRecord.payload),
                tokensBefore: compactedSource.reduce(
                    (total, record) => total + record.estimatedTokens,
                    0,
                ),
                compactedMessageIds: [
                    ...(checkpoint?.compactedMessageIds ?? []),
                    ...compactedSource
                        .filter((record) => record.kind === "history")
                        .map((record) => record.id),
                ].filter((id, index, ids) => ids.indexOf(id) === index),
                retainedTailMessageIds: projection.records
                    .filter((record) => record.kind === "history")
                    .map((record) => record.id),
            });
        }

        let completedUsage: LanguageModelUsage | undefined;
        const result = streamText({
            model: resolvedModel.model,
            system: systemPrompt,
            messages: modelMessages,
            tools,
            providerOptions: providerRequest.providerOptions,
            abortSignal,
            onFinish: (event) => {
                completedUsage = event.totalUsage;
                const telemetry = createProviderCacheTelemetry({
                    resolvedModel,
                    usage: completedUsage,
                    prefixIdentity,
                });
                this.lastProviderTelemetry = telemetry;
                this.options.onProviderTelemetry?.(structuredClone(telemetry));
            },
        });

        return toUIMessageStream<typeof tools, Message>({
            stream: result.stream,
            tools,
            originalMessages: validatedMessages,
            messageMetadata({ part }) {
                if (part.type === "start") return { mode, model };
                if (part.type !== "finish") return undefined;

                return {
                    mode,
                    model,
                    durationMs: Date.now() - startedAt,
                    ...(completedUsage ? { usage: completedUsage } : {}),
                };
            },
            onEnd: ({ messages: completedMessages }) => {
                this.emitMessageSnapshot(completedMessages);
            },
            onError(error) {
                return error instanceof Error ? error.message : String(error);
            },
        });
    }

    async reconnectToStream() {
        return null;
    }

    private emitMessageSnapshot(messages: Message[]) {
        this.options.onMessageSnapshot?.(structuredClone(messages));
    }
}
