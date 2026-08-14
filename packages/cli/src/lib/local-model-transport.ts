import {
    convertToModelMessages,
    generateText,
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
    type ContextCompactionTrigger,
    type ContextCompactor,
    type ContextProjection,
    type ContextRecord,
    type ManualContextCompactionEligibility,
    type ModelContextProfile,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";
import { createSemanticContextCompactor } from "./context-compactor";
import {
    projectToolResultWorkingSet,
    type ToolResultPruningStats,
} from "./tool-result-pruning";
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
    /** Tokens represented by the replacement checkpoint source. */
    tokensBefore: number;
    trigger: ContextCompactionTrigger;
    inputTokensBefore: number;
    inputTokensAfter: number;
    inputBudgetTokens: number;
    targetInputTokens: number;
    targetSummaryTokens: number;
    compactedThroughMessageId?: string;
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
    getToolResultSourceEntryId?: (toolCallId: string) => string | undefined;
    onProviderTelemetry?: (telemetry: ProviderCacheTelemetry) => void;
};

export type ManualContextCompactionOutcome = {
    status: "compacted" | "noop";
    reason?:
        | "nothing-compactable"
        | "insufficient-history"
        | "recent-compaction"
        | "insufficient-gain"
        | "compactor-unavailable";
    eligibility: ManualContextCompactionEligibility;
    fallbackUsed: boolean;
    fallbackReason?: "small-budget" | "empty-output" | "oversized-output" | "reducer-error";
    inputTokensBefore: number;
    inputTokensAfter: number;
    inputBudgetTokens: number;
    toolResultPruning: ToolResultPruningStats;
};

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

export async function projectMessages(input: {
    messages: Message[];
    systemPrompt: string;
    profile: ModelContextProfile;
    checkpoint: PersistedContextCheckpoint | null;
    compactor: ContextCompactor<Message>;
    manual?: boolean;
    resolveToolResultSourceEntryId?: (toolCallId: string) => string | undefined;
}) {
    const manager = new ContextManager<Message>();
    const budget = {
        contextWindowTokens: input.profile.contextWindowTokens,
        reservedOutputTokens: input.profile.reservedOutputTokens,
        safetyMarginTokens:
            input.profile.safetyMarginTokens + input.profile.tokenCounter.countText(input.systemPrompt),
    };
    const effectiveInputBudgetTokens = Math.max(
        0,
        budget.contextWindowTokens - budget.reservedOutputTokens - budget.safetyMarginTokens,
    );
    const toolWorkingSet = projectToolResultWorkingSet({
        messages: input.messages,
        profile: input.profile,
        inputBudgetTokens: effectiveInputBudgetTokens,
        resolveSourceEntryId: input.resolveToolResultSourceEntryId,
    });
    const records = buildContextRecords(toolWorkingSet.messages, input.profile, input.checkpoint);
    const inputTokensBefore = records.reduce((total, record) => total + record.estimatedTokens, 0);
    let compactedSource: readonly ContextRecord<Message>[] = [];
    let generatedSummaryId: string | null = null;
    const trackingCompactor: ContextCompactor<Message> = {
        async compact(compactionInput) {
            compactedSource = compactionInput.records;
            const summary = await input.compactor.compact(compactionInput);
            generatedSummaryId = summary?.id ?? null;
            return summary;
        },
    };
    const policy = {
        maxSummaryTokens: input.profile.maxSummaryTokens,
        ...(input.profile.compactionSoftLimitRatio != null
            ? { softLimitRatio: input.profile.compactionSoftLimitRatio }
            : {}),
        ...(input.profile.compactionHardLimitRatio != null
            ? { hardLimitRatio: input.profile.compactionHardLimitRatio }
            : {}),
        ...(input.profile.postCompactionTargetRatio != null
            ? { targetUtilizationRatio: input.profile.postCompactionTargetRatio }
            : {}),
    };

    if (input.manual) {
        const manualResult = await manager.compactManually(
            records,
            budget,
            trackingCompactor,
            policy,
            {
                previousRetainedRecordIds: input.checkpoint?.retainedTailMessageIds ?? [],
            },
        );
        return {
            projection: manualResult.projection,
            compactedSource,
            generatedSummaryId,
            toolResultPruning: toolWorkingSet.stats,
            manualResult,
            inputTokensBefore,
        };
    }

    const projection = await manager.projectWithCompaction(
        records,
        budget,
        trackingCompactor,
        policy,
    );

    return {
        projection,
        compactedSource,
        generatedSummaryId,
        toolResultPruning: toolWorkingSet.stats,
        manualResult: null,
        inputTokensBefore,
    };
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

    async compactContext(input: {
        messages: Message[];
        mode: ModeType;
        model: SupportedChatModelId;
        abortSignal?: AbortSignal;
    }): Promise<ManualContextCompactionOutcome> {
        const environment = getAgentEnvironment();
        const tools = environment.tools.getModelTools(input.mode) as ToolContracts;
        const resolvedModel = resolveChatModel(input.model);
        const contextProfile = resolveModelContextProfile(input.model);
        const validatedMessages = await validateUIMessages<Message>({
            messages: input.messages,
            tools,
        });
        const systemPrompt = buildSystemPrompt({ mode: input.mode, environment });
        const checkpoint = this.options.getContextCheckpoint?.() ?? null;
        let fallbackReason: ManualContextCompactionOutcome["fallbackReason"];
        const contextCompactor = createSemanticContextCompactor({
            profile: contextProfile,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                const result = await generateText({
                    model: resolvedModel.model,
                    system: instructions,
                    prompt,
                    maxOutputTokens,
                    providerOptions: resolvedModel.providerOptions,
                    abortSignal: input.abortSignal,
                });
                return result.text;
            },
            onFallback(reason) {
                fallbackReason = reason;
            },
        });
        const projected = await projectMessages({
            messages: validatedMessages,
            systemPrompt,
            profile: contextProfile,
            checkpoint,
            compactor: contextCompactor,
            manual: true,
            resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
        });
        if (projected.manualResult?.status === "compacted") {
            this.emitContextCompaction({
                projection: projected.projection,
                compactedSource: projected.compactedSource,
                generatedSummaryId: projected.generatedSummaryId,
                checkpoint,
            });
        }

        if (!projected.manualResult) {
            throw new Error("Manual context compaction did not return an eligibility result");
        }

        return {
            status: projected.manualResult.status,
            ...(projected.manualResult.status === "noop"
                ? { reason: projected.manualResult.reason }
                : {}),
            eligibility: projected.manualResult.eligibility,
            fallbackUsed: fallbackReason != null,
            ...(fallbackReason ? { fallbackReason } : {}),
            inputTokensBefore: projected.inputTokensBefore,
            inputTokensAfter: projected.projection.estimatedInputTokens,
            inputBudgetTokens: projected.projection.inputBudgetTokens,
            toolResultPruning: projected.toolResultPruning,
        };
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
        const contextCompactor = createSemanticContextCompactor({
            profile: contextProfile,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                const result = await generateText({
                    model: resolvedModel.model,
                    system: instructions,
                    prompt,
                    maxOutputTokens,
                    providerOptions: resolvedModel.providerOptions,
                    abortSignal,
                });
                return result.text;
            },
        });
        const { projection, compactedSource, generatedSummaryId } = await projectMessages({
            messages: validatedMessages,
            systemPrompt,
            profile: contextProfile,
            checkpoint,
            compactor: contextCompactor,
            resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
        });
        const projectedMessages = projection.records.map((record) => record.payload);
        const modelMessages = await convertToModelMessages(projectedMessages, { tools });

        this.emitMessageSnapshot(validatedMessages);
        this.emitContextCompaction({
            projection,
            compactedSource,
            generatedSummaryId,
            checkpoint,
        });

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

    private emitContextCompaction(input: {
        projection: ContextProjection<Message>;
        compactedSource: readonly ContextRecord<Message>[];
        generatedSummaryId: string | null;
        checkpoint: PersistedContextCheckpoint | null;
    }) {
        const summaryRecord = input.generatedSummaryId
            ? input.projection.records.find((record) => record.id === input.generatedSummaryId)
            : undefined;
        if (!summaryRecord || input.compactedSource.length === 0 || !input.projection.compaction) {
            return false;
        }

        const compaction = input.projection.compaction;
        this.options.onContextCompaction?.({
            summary: structuredClone(summaryRecord.payload),
            tokensBefore: input.compactedSource.reduce(
                (total, record) => total + record.estimatedTokens,
                0,
            ),
            trigger: compaction.trigger,
            inputTokensBefore: compaction.inputTokensBefore,
            inputTokensAfter: compaction.inputTokensAfter,
            inputBudgetTokens: compaction.inputBudgetTokens,
            targetInputTokens: compaction.targetInputTokens,
            targetSummaryTokens: compaction.targetSummaryTokens,
            ...(compaction.compactedThroughRecordId
                ? { compactedThroughMessageId: compaction.compactedThroughRecordId }
                : {}),
            compactedMessageIds: [
                ...(input.checkpoint?.compactedMessageIds ?? []),
                ...compaction.compactedRecordIds,
            ].filter((id, index, ids) => ids.indexOf(id) === index),
            retainedTailMessageIds: input.projection.records
                .filter((record) => record.kind === "history")
                .map((record) => record.id),
        });
        return true;
    }

    private emitMessageSnapshot(messages: Message[]) {
        this.options.onMessageSnapshot?.(structuredClone(messages));
    }
}
