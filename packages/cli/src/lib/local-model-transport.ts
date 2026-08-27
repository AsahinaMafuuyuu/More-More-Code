import {
    convertToModelMessages,
    generateText,
    streamText,
    toUIMessageStream,
    validateUIMessages,
    type ChatTransport,
    type LanguageModelUsage,
    type ModelMessage,
} from "ai";
import {
    type ModelRef,
    type ModeType,
    type ToolContracts,
} from "@more-more-code/shared";
import {
    ContextManager,
    resolveBranchSummaryTokenBudget,
    type BranchSummaryNavigationAnalysis,
    type ContextCompactionTrigger,
    type ContextCompactor,
    type ContextProjection,
    type ContextRecord,
    type ManualContextCompactionEligibility,
    type ModelContextProfile,
    type RuntimeModelStepCost,
    type RuntimePricingSnapshot,
    type RuntimeUsageInputTokens,
    type RuntimeUsageOutputTokens,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";
import {
    createSemanticContextCompactor,
    type BranchSummaryContextPayload,
    type ContextCompactionPayload,
} from "./context-compactor";
import {
    projectToolResultWorkingSet,
    type ToolResultPruningStats,
} from "./tool-result-pruning";
import {
    normalizeModelRef,
    resolveChatModel,
    resolveConfiguredProvider,
    type ResolvedModel,
} from "./models";
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
import {
    reduceBranchSummary,
    type BranchSummaryReductionOutcome,
} from "./branch-summary-reducer";
import { normalizeProviderUsage } from "./provider-usage";
import { calculateModelStepCost, resolvePricingRevision } from "./cost-engine";

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
    compactedThroughRecordId?: string;
    compactedThroughMessageId?: string;
    compactedMessageIds: string[];
    retainedTailMessageIds: string[];
    compactedRecordIds: string[];
    retainedTailRecordIds: string[];
};

export type ContextProjectionLifecycleEvent =
    | {
        phase: "started";
        operationId: string;
        operation: "model-step" | "manual-compaction";
        mode: ModeType;
        model: ModelRef;
    }
    | {
        phase: "completed";
        operationId: string;
        operation: "model-step" | "manual-compaction";
        mode: ModeType;
        model: ModelRef;
        inputTokensBefore: number;
        inputTokensAfter: number;
        inputBudgetTokens: number;
        toolResultTokensBefore: number;
        toolResultTokensAfter: number;
        prunedToolResultCount: number;
        overBudget: boolean;
        compactionTrigger?: ContextCompactionTrigger;
    };

export type PersistedContextCheckpoint = {
    summary: Message;
    compactedMessageIds?: string[];
    retainedTailMessageIds?: string[];
    compactedRecordIds?: string[];
    retainedTailRecordIds?: string[];
};

export type BranchSummaryContextAnchor = {
    entryId: string;
    summary: string;
    afterMessageId: string | null;
};

export type ModelUsageCompletionEvent = {
    providerId: string;
    providerKind: ResolvedModel["provider"];
    modelId: string;
    inputTokens?: RuntimeUsageInputTokens;
    outputTokens?: RuntimeUsageOutputTokens;
    pricing?: RuntimePricingSnapshot;
    cost?: RuntimeModelStepCost;
};

export type CurrentContextUsage = {
    estimatedInputTokens: number;
    contextWindowTokens: number;
    inputBudgetTokens: number;
    reservedOutputTokens: number;
    safetyMarginTokens: number;
    utilizationRatio: number;
    tokenCounterId: string;
    tokenCountQuality: "estimated" | "exact";
};

/**
 * Narrow collaborator overrides used by transport integration tests. Production
 * callers leave this unset and retain the normal local Provider Runtime.
 */
type LocalModelTransportDependencies = {
    resolveChatModel?: typeof resolveChatModel;
    resolveModelContextProfile?: typeof resolveModelContextProfile;
};

export type LocalModelTransportOptions = {
    onMessageSnapshot?: (messages: Message[]) => void;
    onContextCompaction?: (event: ContextCompactionEvent) => void | Promise<void>;
    getContextCheckpoint?: () => PersistedContextCheckpoint | null;
    getToolResultSourceEntryId?: (toolCallId: string) => string | undefined;
    getBranchSummaryContext?: () => BranchSummaryContextAnchor[];
    onProviderTelemetry?: (telemetry: ProviderCacheTelemetry) => void;
    onModelUsage?: (event: ModelUsageCompletionEvent) => void | Promise<void>;
    onModelUsageError?: (error: Error) => void;
    onContextEvent?: (event: ContextProjectionLifecycleEvent) => void | Promise<void>;
    /** @internal Injectable only to make provider ordering deterministic in tests. */
    dependencies?: LocalModelTransportDependencies;
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
    branchSummaries: readonly BranchSummaryContextAnchor[] = [],
) {
    const compactedIds = new Set([
        ...(checkpoint?.compactedRecordIds ?? []),
        ...(checkpoint?.compactedMessageIds ?? []),
    ]);
    const activeMessages = messages.filter((message) => !compactedIds.has(message.id));
    const activeBranchSummaries = branchSummaries.filter((summary) => !compactedIds.has(summary.entryId));
    let turnIndex = -1;
    const turns: number[] = [];

    for (const message of activeMessages) {
        if (message.role === "user") turnIndex += 1;
        turns.push(Math.max(turnIndex, 0));
    }

    const lastTurn = Math.max(0, ...turns);
    const firstRequiredTurn = Math.max(0, lastTurn - profile.retainedTailTurns + 1);
    const messageRecords = activeMessages.map((message, index): ContextRecord<ContextCompactionPayload> => {
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

    const activeMessageIds = new Set(activeMessages.map((message) => message.id));
    const branchByAnchor = new Map<string | null, BranchSummaryContextAnchor[]>();
    for (const summary of activeBranchSummaries) {
        const anchor = summary.afterMessageId && activeMessageIds.has(summary.afterMessageId)
            ? summary.afterMessageId
            : null;
        const values = branchByAnchor.get(anchor) ?? [];
        values.push(summary);
        branchByAnchor.set(anchor, values);
    }

    const createBranchRecord = (
        summary: BranchSummaryContextAnchor,
        retained: boolean,
    ): ContextRecord<ContextCompactionPayload> => {
        const payload: BranchSummaryContextPayload = {
            type: "branch-summary",
            entryId: summary.entryId,
            summary: summary.summary,
        };
        return {
            id: summary.entryId,
            kind: "history",
            payload,
            estimatedTokens: profile.tokenCounter.countText(summary.summary),
            groupId: `branch-summary:${summary.entryId}`,
            required: retained,
            category: retained ? "retained-turn" : "historical-conversation",
            stability: retained ? "retained" : "history",
        };
    };

    const historyRecords: ContextRecord<ContextCompactionPayload>[] = [];
    for (const summary of branchByAnchor.get(null) ?? []) {
        historyRecords.push(createBranchRecord(summary, activeMessages.length === 0));
    }
    messageRecords.forEach((record, index) => {
        historyRecords.push(record);
        const turn = turns[index] ?? 0;
        const retained = turn >= firstRequiredTurn;
        for (const summary of branchByAnchor.get(activeMessages[index]!.id) ?? []) {
            historyRecords.push(createBranchRecord(summary, retained));
        }
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
    compactor: ContextCompactor<ContextCompactionPayload>;
    branchSummaries?: readonly BranchSummaryContextAnchor[];
    manual?: boolean;
    resolveToolResultSourceEntryId?: (toolCallId: string) => string | undefined;
}) {
    const manager = new ContextManager<ContextCompactionPayload>();
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
    const records = buildContextRecords(
        toolWorkingSet.messages,
        input.profile,
        input.checkpoint,
        input.branchSummaries,
    );
    const inputTokensBefore = records.reduce((total, record) => total + record.estimatedTokens, 0);
    let compactedSource: readonly ContextRecord<ContextCompactionPayload>[] = [];
    let generatedSummaryId: string | null = null;
    const trackingCompactor: ContextCompactor<ContextCompactionPayload> = {
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
                previousRetainedRecordIds:
                    input.checkpoint?.retainedTailRecordIds
                    ?? input.checkpoint?.retainedTailMessageIds
                    ?? [],
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

/**
 * Read-only current Context projection. It shares canonical record building,
 * Tool Result pruning, checkpoint semantics, model budget, and TokenCounter
 * with a Model Step but never invokes a Provider or persists a checkpoint.
 */
export function projectCurrentContextUsage(input: {
    messages: Message[];
    systemPrompt: string;
    profile: ModelContextProfile;
    checkpoint: PersistedContextCheckpoint | null;
    branchSummaries?: readonly BranchSummaryContextAnchor[];
    resolveToolResultSourceEntryId?: (toolCallId: string) => string | undefined;
}): CurrentContextUsage {
    const systemPromptTokens = input.profile.tokenCounter.countText(input.systemPrompt);
    const safetyMarginTokens = input.profile.safetyMarginTokens + systemPromptTokens;
    const inputBudgetTokens = Math.max(
        0,
        input.profile.contextWindowTokens
            - input.profile.reservedOutputTokens
            - safetyMarginTokens,
    );
    const toolWorkingSet = projectToolResultWorkingSet({
        messages: input.messages,
        profile: input.profile,
        inputBudgetTokens,
        resolveSourceEntryId: input.resolveToolResultSourceEntryId,
    });
    const records = buildContextRecords(
        toolWorkingSet.messages,
        input.profile,
        input.checkpoint,
        input.branchSummaries,
    );
    const projection = new ContextManager<ContextCompactionPayload>().project(records, {
        contextWindowTokens: input.profile.contextWindowTokens,
        reservedOutputTokens: input.profile.reservedOutputTokens,
        safetyMarginTokens,
    });

    return {
        estimatedInputTokens: projection.estimatedInputTokens,
        contextWindowTokens: input.profile.contextWindowTokens,
        inputBudgetTokens: projection.inputBudgetTokens,
        reservedOutputTokens: input.profile.reservedOutputTokens,
        safetyMarginTokens,
        utilizationRatio: input.profile.contextWindowTokens === 0
            ? 0
            : projection.estimatedInputTokens / input.profile.contextWindowTokens,
        tokenCounterId: input.profile.tokenCounter.id,
        tokenCountQuality: input.profile.tokenCounter.accuracy,
    };
}

function resolveExecutionConfig(messages: Message[]): {
    mode: ModeType;
    model: ModelRef;
} {
    const metadata = messages.findLast(
        (message) => message.metadata?.mode && message.metadata?.model,
    )?.metadata;

    if (!metadata?.mode || !metadata.model) {
        throw new Error("Missing mode/model metadata for local model execution");
    }

    return {
        mode: metadata.mode,
        model: normalizeModelRef(metadata.model as ModelRef | string),
    };
}

function isBranchSummaryPayload(
    payload: ContextCompactionPayload,
): payload is BranchSummaryContextPayload {
    return payload
        && typeof payload === "object"
        && "type" in payload
        && payload.type === "branch-summary";
}

async function compileProjectedModelMessages(
    records: readonly ContextRecord<ContextCompactionPayload>[],
    tools: ToolContracts,
) {
    const output: ModelMessage[] = [];
    let messageBuffer: Message[] = [];
    const flush = async () => {
        if (messageBuffer.length === 0) return;
        output.push(...await convertToModelMessages(messageBuffer, { tools }));
        messageBuffer = [];
    };

    for (const record of records) {
        if (!isBranchSummaryPayload(record.payload)) {
            messageBuffer.push(record.payload);
            continue;
        }

        await flush();
        output.push({
            role: "system",
            content: `Transferred branch knowledge (Session Entry ${record.payload.entryId}):\n${record.payload.summary}`,
        });
    }
    await flush();
    return output;
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

    inspectCurrentContext(input: {
        messages: Message[];
        mode: ModeType;
        model: ModelRef;
    }): CurrentContextUsage {
        const environment = getAgentEnvironment();
        const provider = resolveConfiguredProvider(input.model, environment);
        const contextProfile = (this.options.dependencies?.resolveModelContextProfile
            ?? resolveModelContextProfile)(input.model, provider.kind);
        const systemPrompt = buildSystemPrompt({ mode: input.mode, environment });
        return projectCurrentContextUsage({
            messages: input.messages,
            systemPrompt,
            profile: contextProfile,
            checkpoint: this.options.getContextCheckpoint?.() ?? null,
            branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
            resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
        });
    }

    async summarizeBranch(input: {
        analysis: BranchSummaryNavigationAnalysis<Message>;
        mode: ModeType;
        model: ModelRef;
        abortSignal?: AbortSignal;
    }): Promise<BranchSummaryReductionOutcome> {
        const environment = getAgentEnvironment();
        const provider = resolveConfiguredProvider(input.model, environment);
        const contextProfile = (this.options.dependencies?.resolveModelContextProfile
            ?? resolveModelContextProfile)(input.model, provider.kind);
        const systemPrompt = buildSystemPrompt({ mode: input.mode, environment });
        const effectiveInputBudgetTokens = Math.max(
            0,
            contextProfile.contextWindowTokens
                - contextProfile.reservedOutputTokens
                - contextProfile.safetyMarginTokens
                - contextProfile.tokenCounter.countText(systemPrompt),
        );
        const targetTokens = resolveBranchSummaryTokenBudget(effectiveInputBudgetTokens);

        return reduceBranchSummary({
            analysis: input.analysis,
            profile: contextProfile,
            effectiveInputBudgetTokens,
            targetTokens,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                const resolvedModel = await (this.options.dependencies?.resolveChatModel
                    ?? resolveChatModel)(input.model, environment);
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
        });
    }

    async compactContext(input: {
        messages: Message[];
        mode: ModeType;
        model: ModelRef;
        abortSignal?: AbortSignal;
    }): Promise<ManualContextCompactionOutcome> {
        const operationId = crypto.randomUUID();
        const environment = getAgentEnvironment();
        const tools = environment.tools.getModelTools(input.mode) as ToolContracts;
        const provider = resolveConfiguredProvider(input.model, environment);
        const contextProfile = (this.options.dependencies?.resolveModelContextProfile
            ?? resolveModelContextProfile)(input.model, provider.kind);
        const validatedMessages = await validateUIMessages<Message>({
            messages: input.messages,
            tools,
        });
        const systemPrompt = buildSystemPrompt({ mode: input.mode, environment });
        const checkpoint = this.options.getContextCheckpoint?.() ?? null;
        await this.options.onContextEvent?.({
            phase: "started",
            operationId,
            operation: "manual-compaction",
            mode: input.mode,
            model: input.model,
        });
        let fallbackReason: ManualContextCompactionOutcome["fallbackReason"];
        const contextCompactor = createSemanticContextCompactor({
            profile: contextProfile,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                const resolvedModel = await (this.options.dependencies?.resolveChatModel
                    ?? resolveChatModel)(input.model, environment);
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
            branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
            manual: true,
            resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
        });
        if (projected.manualResult?.status === "compacted") {
            await this.emitContextCompaction({
                projection: projected.projection,
                compactedSource: projected.compactedSource,
                generatedSummaryId: projected.generatedSummaryId,
                checkpoint,
            });
        }

        if (!projected.manualResult) {
            throw new Error("Manual context compaction did not return an eligibility result");
        }

        await this.options.onContextEvent?.({
            phase: "completed",
            operationId,
            operation: "manual-compaction",
            mode: input.mode,
            model: input.model,
            inputTokensBefore: projected.inputTokensBefore,
            inputTokensAfter: projected.projection.estimatedInputTokens,
            inputBudgetTokens: projected.projection.inputBudgetTokens,
            toolResultTokensBefore: projected.toolResultPruning.originalTokens,
            toolResultTokensAfter: projected.toolResultPruning.projectedTokens,
            prunedToolResultCount: projected.toolResultPruning.prunedResults,
            overBudget: projected.toolResultPruning.overBudget,
            ...(projected.projection.compaction
                ? { compactionTrigger: projected.projection.compaction.trigger }
                : {}),
        });

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
        const operationId = crypto.randomUUID();
        const { mode, model } = resolveExecutionConfig(messages);
        const environment = getAgentEnvironment();
        const tools = environment.tools.getModelTools(mode) as ToolContracts;
        const resolvedModel = await (this.options.dependencies?.resolveChatModel
            ?? resolveChatModel)(model, environment);
        const contextProfile = (this.options.dependencies?.resolveModelContextProfile
            ?? resolveModelContextProfile)(model, resolvedModel.provider);
        const startedAt = Date.now();

        const validatedMessages = await validateUIMessages<Message>({
            messages,
            tools,
        });
        const systemPrompt = buildSystemPrompt({ mode, environment });
        const prefixSources = getPromptPrefixSources(environment);
        const prefixIdentity = createPromptPrefixIdentity({
            provider: resolvedModel.providerId,
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
        await this.options.onContextEvent?.({
            phase: "started",
            operationId,
            operation: "model-step",
            mode,
            model,
        });
        const {
            projection,
            compactedSource,
            generatedSummaryId,
            toolResultPruning,
            inputTokensBefore,
        } = await projectMessages({
            messages: validatedMessages,
            systemPrompt,
            profile: contextProfile,
            checkpoint,
            compactor: contextCompactor,
            branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
            resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
        });
        const modelMessages = await compileProjectedModelMessages(projection.records, tools);

        this.emitMessageSnapshot(validatedMessages);
        // A generated checkpoint changes the durable Session Tree. It must be
        // committed before this projection is allowed to cross the provider
        // boundary, otherwise a crash/restart can issue a request from state
        // the local authority has never accepted.
        await this.emitContextCompaction({
            projection,
            compactedSource,
            generatedSummaryId,
            checkpoint,
        });
        await this.options.onContextEvent?.({
            phase: "completed",
            operationId,
            operation: "model-step",
            mode,
            model,
            inputTokensBefore,
            inputTokensAfter: projection.estimatedInputTokens,
            inputBudgetTokens: projection.inputBudgetTokens,
            toolResultTokensBefore: toolResultPruning.originalTokens,
            toolResultTokensAfter: toolResultPruning.projectedTokens,
            prunedToolResultCount: toolResultPruning.prunedResults,
            overBudget: toolResultPruning.overBudget,
            ...(projection.compaction ? { compactionTrigger: projection.compaction.trigger } : {}),
        });

        let completedUsage: LanguageModelUsage | undefined;
        const providerRequestStartedAt = Date.now();
        const result = streamText({
            model: resolvedModel.model,
            system: systemPrompt,
            messages: modelMessages,
            tools,
            providerOptions: providerRequest.providerOptions,
            abortSignal,
            onFinish: async (event) => {
                completedUsage = event.totalUsage;
                const telemetry = createProviderCacheTelemetry({
                    resolvedModel,
                    usage: completedUsage,
                    prefixIdentity,
                });
                this.lastProviderTelemetry = telemetry;
                this.options.onProviderTelemetry?.(structuredClone(telemetry));

                try {
                    const normalized = normalizeProviderUsage(completedUsage);
                    if (!normalized.inputTokens && !normalized.outputTokens) return;
                    const pricing = resolvePricingRevision({
                        providerId: resolvedModel.providerId,
                        providerKind: resolvedModel.provider,
                        modelId: resolvedModel.modelId,
                        at: providerRequestStartedAt,
                    });
                    const cost = pricing
                        ? calculateModelStepCost(normalized, pricing)
                        : null;
                    await this.options.onModelUsage?.({
                        providerId: resolvedModel.providerId,
                        providerKind: resolvedModel.provider,
                        modelId: resolvedModel.modelId,
                        ...normalized,
                        ...(pricing ? { pricing } : {}),
                        ...(cost ? { cost } : {}),
                    });
                } catch (error) {
                    // Provider completion already occurred. Accounting must not
                    // turn into a request retry or discard a valid response.
                    try {
                        this.options.onModelUsageError?.(
                            error instanceof Error ? error : new Error(String(error)),
                        );
                    } catch {
                        // Diagnostic consumers are post-side-effect observers too.
                    }
                }
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

    private async emitContextCompaction(input: {
        projection: ContextProjection<ContextCompactionPayload>;
        compactedSource: readonly ContextRecord<ContextCompactionPayload>[];
        generatedSummaryId: string | null;
        checkpoint: PersistedContextCheckpoint | null;
    }) {
        const summaryRecord = input.generatedSummaryId
            ? input.projection.records.find((record) => record.id === input.generatedSummaryId)
            : undefined;
        if (!summaryRecord || input.compactedSource.length === 0 || !input.projection.compaction) {
            return false;
        }
        if (isBranchSummaryPayload(summaryRecord.payload)) return false;

        const compaction = input.projection.compaction;
        const compactedRecordIds = [
            ...(input.checkpoint?.compactedRecordIds ?? input.checkpoint?.compactedMessageIds ?? []),
            ...compaction.compactedRecordIds,
        ].filter((id, index, ids) => ids.indexOf(id) === index);
        const compactedPayloadById = new Map(
            input.compactedSource.map((record) => [record.id, record.payload]),
        );
        const compactedMessageIds = [
            ...(input.checkpoint?.compactedMessageIds ?? []),
            ...compaction.compactedRecordIds.filter((id) => {
                const payload = compactedPayloadById.get(id);
                return payload !== undefined && !isBranchSummaryPayload(payload);
            }),
        ].filter((id, index, ids) => ids.indexOf(id) === index);
        const retainedHistory = input.projection.records.filter((record) => record.kind === "history");
        await this.options.onContextCompaction?.({
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
                ? { compactedThroughRecordId: compaction.compactedThroughRecordId }
                : {}),
            ...(compaction.compactedThroughRecordId
                && compactedPayloadById.get(compaction.compactedThroughRecordId)
                && !isBranchSummaryPayload(compactedPayloadById.get(compaction.compactedThroughRecordId)!)
                ? { compactedThroughMessageId: compaction.compactedThroughRecordId }
                : {}),
            compactedMessageIds,
            compactedRecordIds,
            retainedTailMessageIds: retainedHistory
                .filter((record) => !isBranchSummaryPayload(record.payload))
                .map((record) => record.id),
            retainedTailRecordIds: retainedHistory.map((record) => record.id),
        });
        return true;
    }

    private emitMessageSnapshot(messages: Message[]) {
        this.options.onMessageSnapshot?.(structuredClone(messages));
    }
}
