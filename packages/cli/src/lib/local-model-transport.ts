import {
    type ModelRef,
    type ModeType,
    type ToolContracts,
} from "@more-more-code/shared";
import {
    assertRehydratedCheckpointEquivalent,
    ContextManager,
    resolveBranchSummaryTokenBudget,
    type BranchSummaryNavigationAnalysis,
    type ContextCompactionTrigger,
    type ContextCompactor,
    type CompactionPlan,
    type ContextProjection,
    type ContextRecord,
    type CompactionCheckpointV2,
    type ManualContextCompactionEligibility,
    type ModelContextProfile,
    type RequiredContextAnchor,
    type RuntimeModelStepCost,
    type RuntimePricingSnapshot,
    type RuntimeUsageInputTokens,
    type RuntimeUsageOutputTokens,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";
import type { ChatStreamChunk, LocalModelSendInput } from "./chat-stream";
import {
    createSemanticContextCompactor,
    type BranchSummaryContextPayload,
    type ContextCompactionFallbackReason,
    type ContextCompactionPayload,
    type ContextCompactionReducerPhase,
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
    compileNativeModelMessages,
    compileNativeTools,
    validateChatMessages,
} from "./native-message-compiler";
import {
    generateProviderText,
    streamProvider,
} from "./native-provider-executor";
import type {
    NativeModelMessage,
    NativeModelRequest,
    ProviderExecutionOptions,
} from "./provider-native-protocol";
import type { ProviderUsage } from "./provider-usage";
import {
    reduceBranchSummary,
    type BranchSummaryReductionOutcome,
} from "./branch-summary-reducer";
import { aggregateProviderUsage, normalizeProviderUsage } from "./provider-usage";
import { calculateModelStepCost, resolvePricingRevision } from "./cost-engine";

export type ContextCompactionEvent = {
    summary: Message;
    checkpointV2: CompactionCheckpointV2;
    compactionPlanId: string;
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
    }
    | {
        phase:
            | "compaction-starting"
            | "compaction-reducing"
            | "compaction-validating"
            | "compaction-fallback"
            | "compaction-applying"
            | "compaction-rebased"
            | "compaction-aborted"
            | "compaction-failed";
        operationId: string;
        operation: "model-step" | "manual-compaction";
        mode: ModeType;
        model: ModelRef;
        compactionPlanId: string;
        compactionTrigger: ContextCompactionTrigger;
        inputTokensBefore?: number;
        inputTokensAfter?: number;
    };

function reducerPhaseToLifecyclePhase(phase: ContextCompactionReducerPhase) {
    switch (phase) {
        case "planned": return "compaction-starting" as const;
        case "reducing": return "compaction-reducing" as const;
        case "validating": return "compaction-validating" as const;
        case "fallback": return "compaction-fallback" as const;
    }
}

export type PersistedContextCheckpoint = {
    summary: Message;
    checkpointV2?: CompactionCheckpointV2;
    compactionPlanId?: string;
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
    streamProvider?: typeof streamProvider;
    generateProviderText?: typeof generateProviderText;
};

export type LocalModelTransportOptions = {
    onMessageSnapshot?: (messages: Message[]) => void;
    onContextCompaction?: (
        event: ContextCompactionEvent,
    ) => PersistedContextCheckpoint | null | Promise<PersistedContextCheckpoint | null>;
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
    fallbackReason?: ContextCompactionFallbackReason;
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
    let interactionIndex = -1;
    let cycleIndex = 0;
    let assistantSeenInInteraction = false;
    const cycleKeys: string[] = [];
    const anchorsForMessage = (message: Message): RequiredContextAnchor[] => {
        const anchors: RequiredContextAnchor[] = [];
        for (const part of message.parts) {
            if (!(part.type.startsWith("tool-") || part.type === "dynamic-tool")) continue;
            const toolPart = part as unknown as Record<string, unknown>;
            const state = toolPart.state;
            if (state !== "output-error" && state !== "output-denied") continue;
            const toolCallId = typeof toolPart.toolCallId === "string" ? toolPart.toolCallId : "unknown";
            const errorText = typeof toolPart.errorText === "string"
                ? toolPart.errorText
                : state === "output-denied" ? "Tool execution denied" : "Tool execution failed";
            anchors.push({
                id: `tool-failure:${message.id}:${toolCallId}`,
                priority: "P0",
                kind: "failure",
                text: `${toolCallId}: ${errorText}`,
                sourceRecordIds: [message.id],
            });
        }
        return anchors;
    };

    for (const message of activeMessages) {
        if (message.role === "user") {
            interactionIndex += 1;
            cycleIndex = 0;
            assistantSeenInInteraction = false;
        } else if (message.role === "assistant") {
            if (interactionIndex < 0) interactionIndex = 0;
            if (assistantSeenInInteraction) cycleIndex += 1;
            assistantSeenInInteraction = true;
        } else if (interactionIndex < 0) {
            interactionIndex = 0;
        }
        cycleKeys.push(`interaction:${Math.max(interactionIndex, 0)}:cycle:${cycleIndex}`);
    }

    const messageRecords = activeMessages.map((message, index): ContextRecord<ContextCompactionPayload> => {
        const requiredAnchors = anchorsForMessage(message);
        return {
            id: message.id,
            kind: "history",
            payload: message,
            estimatedTokens: profile.tokenCounter.countPayload(message),
            groupId: cycleKeys[index] ?? `interaction:0:cycle:${index}`,
            splitGroupId: `message:${message.id}`,
            category: "historical-conversation",
            stability: "history",
            ...(requiredAnchors.length > 0 ? { requiredAnchors } : {}),
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
            splitGroupId: `branch-summary:${summary.entryId}`,
            category: "historical-conversation",
            stability: "history",
            requiredAnchors: [{
                id: `branch-summary:${summary.entryId}`,
                priority: "P1",
                kind: "source-excerpt",
                text: summary.summary,
                sourceRecordIds: [summary.entryId],
            }],
        };
    };

    const historyRecords: ContextRecord<ContextCompactionPayload>[] = [];
    for (const summary of branchByAnchor.get(null) ?? []) {
        historyRecords.push(createBranchRecord(summary));
    }
    messageRecords.forEach((record, index) => {
        historyRecords.push(record);
        for (const summary of branchByAnchor.get(activeMessages[index]!.id) ?? []) {
            historyRecords.push(createBranchRecord(summary));
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
            ...(checkpoint.checkpointV2 ? { checkpointV2: structuredClone(checkpoint.checkpointV2) } : {}),
        },
        ...historyRecords,
    ];
}

function activeMessagesAfterCheckpoint(
    messages: readonly Message[],
    checkpoint: PersistedContextCheckpoint | null,
) {
    if (!checkpoint) return structuredClone(messages) as Message[];
    const compactedIds = new Set([
        ...(checkpoint.compactedRecordIds ?? []),
        ...(checkpoint.compactedMessageIds ?? []),
    ]);
    return messages
        .filter((message) => !compactedIds.has(message.id))
        .map((message) => structuredClone(message));
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
        // Compacted Tool Results are represented by the checkpoint and must
        // not continue contributing to active Tool working-set pressure.
        messages: activeMessagesAfterCheckpoint(input.messages, input.checkpoint),
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
    let compactionPlan: CompactionPlan | null = null;
    const trackingCompactor: ContextCompactor<ContextCompactionPayload> = {
        async compact(compactionInput) {
            compactedSource = compactionInput.records;
            compactionPlan = compactionInput.plan;
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
        ...(input.profile.retainRecentMinTokens != null
            ? { retainRecentMinTokens: input.profile.retainRecentMinTokens }
            : {}),
        ...(input.profile.retainRecentRatio != null
            ? { retainRecentRatio: input.profile.retainRecentRatio }
            : {}),
        ...(input.profile.allowSplitCompactionGroup != null
            ? { allowSplitGroup: input.profile.allowSplitCompactionGroup }
            : {}),
        ...(toolWorkingSet.stats.overBudget
            ? {
                toolPressureReliefTokens: Math.max(
                    1,
                    toolWorkingSet.stats.projectedTokens - toolWorkingSet.stats.budgetTokens,
                ),
            }
            : {}),
        policyVersion: "context-compaction-v2",
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
            compactionPlan: compactionPlan as CompactionPlan | null,
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
        toolWorkingSet.stats.overBudget ? "tool-pressure" : null,
    );

    return {
        projection,
        compactedSource,
        generatedSummaryId,
        compactionPlan: compactionPlan as CompactionPlan | null,
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
        messages: activeMessagesAfterCheckpoint(input.messages, input.checkpoint),
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

function projectPersistedContext(input: {
    messages: Message[];
    systemPrompt: string;
    profile: ModelContextProfile;
    checkpoint: PersistedContextCheckpoint;
    branchSummaries?: readonly BranchSummaryContextAnchor[];
    resolveToolResultSourceEntryId?: (toolCallId: string) => string | undefined;
}) {
    const safetyMarginTokens = input.profile.safetyMarginTokens
        + input.profile.tokenCounter.countText(input.systemPrompt);
    const inputBudgetTokens = Math.max(
        0,
        input.profile.contextWindowTokens
            - input.profile.reservedOutputTokens
            - safetyMarginTokens,
    );
    const toolWorkingSet = projectToolResultWorkingSet({
        messages: activeMessagesAfterCheckpoint(input.messages, input.checkpoint),
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
    return { projection, toolResultPruning: toolWorkingSet.stats };
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

function compileProjectedModelMessages(
    records: readonly ContextRecord<ContextCompactionPayload>[],
) {
    const output: NativeModelMessage[] = [];
    let messageBuffer: Message[] = [];
    const flush = () => {
        if (messageBuffer.length === 0) return;
        output.push(...compileNativeModelMessages(messageBuffer));
        messageBuffer = [];
    };

    for (const record of records) {
        if (!isBranchSummaryPayload(record.payload)) {
            messageBuffer.push(record.payload);
            continue;
        }

        flush();
        output.push({
            role: "system",
            content: [{
                type: "text",
                text: `Transferred branch knowledge (Session Entry ${record.payload.entryId}):\n${record.payload.summary}`,
            }],
        });
    }
    flush();
    return output;
}

/** Executes one model step locally; context projection is owned by the CLI/Harness boundary. */
export class LocalModelTransport {
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
                const result = await (this.options.dependencies?.generateProviderText
                    ?? generateProviderText)(resolvedModel, {
                    system: instructions,
                    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                    tools: [],
                    maxOutputTokens,
                }, { signal: input.abortSignal });
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
        const validatedMessages = validateChatMessages(input.messages, tools);
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
        const compactionLifecycle: { plan: CompactionPlan | null } = { plan: null };
        const contextCompactor = createSemanticContextCompactor({
            profile: contextProfile,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                const resolvedModel = await (this.options.dependencies?.resolveChatModel
                    ?? resolveChatModel)(input.model, environment);
                const result = await (this.options.dependencies?.generateProviderText
                    ?? generateProviderText)(resolvedModel, {
                    system: instructions,
                    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                    tools: [],
                    maxOutputTokens,
                }, { signal: input.abortSignal });
                return result.text;
            },
            onFallback(reason) {
                fallbackReason = reason;
            },
            onPhase: async (phase, plan) => {
                compactionLifecycle.plan = plan;
                input.abortSignal?.throwIfAborted();
                await this.options.onContextEvent?.({
                    phase: reducerPhaseToLifecyclePhase(phase),
                    operationId,
                    operation: "manual-compaction",
                    mode: input.mode,
                    model: input.model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                });
            },
        });
        let projected: Awaited<ReturnType<typeof projectMessages>>;
        try {
            projected = await projectMessages({
                messages: validatedMessages,
                systemPrompt,
                profile: contextProfile,
                checkpoint,
                compactor: contextCompactor,
                branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
                manual: true,
                resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
            });
        } catch (error) {
            if (compactionLifecycle.plan) {
                const plan = compactionLifecycle.plan;
                await this.options.onContextEvent?.({
                    phase: "compaction-failed",
                    operationId,
                    operation: "manual-compaction",
                    mode: input.mode,
                    model: input.model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                });
            }
            throw error;
        }
        if (compactionLifecycle.plan && !projected.projection.compaction) {
            const plan = compactionLifecycle.plan;
            await this.options.onContextEvent?.({
                phase: "compaction-aborted",
                operationId,
                operation: "manual-compaction",
                mode: input.mode,
                model: input.model,
                compactionPlanId: plan.planId,
                compactionTrigger: plan.trigger,
                inputTokensBefore: plan.inputTokensBefore,
            });
        }
        if (projected.manualResult?.status === "compacted") {
            const plan = projected.compactionPlan;
            if (!plan) throw new Error("Manual compaction is missing its accepted plan");
            await this.options.onContextEvent?.({
                phase: "compaction-applying",
                operationId,
                operation: "manual-compaction",
                mode: input.mode,
                model: input.model,
                compactionPlanId: plan.planId,
                compactionTrigger: plan.trigger,
                inputTokensBefore: plan.inputTokensBefore,
            });
            try {
                const acceptedCheckpoint = await this.emitContextCompaction({
                    projection: projected.projection,
                    compactedSource: projected.compactedSource,
                    generatedSummaryId: projected.generatedSummaryId,
                    compactionPlan: plan,
                    checkpoint,
                });
                if (!acceptedCheckpoint) {
                    throw new Error("Manual compaction did not produce a durable checkpoint");
                }
                const rehydrated = projectPersistedContext({
                    messages: validatedMessages,
                    systemPrompt,
                    profile: contextProfile,
                    checkpoint: acceptedCheckpoint,
                    branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
                    resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
                });
                if (rehydrated.projection.truncated || rehydrated.projection.overBudget) {
                    throw new Error("Persisted manual compaction checkpoint does not reconstruct a safe context");
                }
                await this.options.onContextEvent?.({
                    phase: "compaction-rebased",
                    operationId,
                    operation: "manual-compaction",
                    mode: input.mode,
                    model: input.model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                    inputTokensAfter: rehydrated.projection.estimatedInputTokens,
                });
            } catch (error) {
                await this.options.onContextEvent?.({
                    phase: "compaction-failed",
                    operationId,
                    operation: "manual-compaction",
                    mode: input.mode,
                    model: input.model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                });
                throw error;
            }
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

    async sendMessages({ messages, abortSignal }: LocalModelSendInput): Promise<ReadableStream<ChatStreamChunk>> {
        const operationId = crypto.randomUUID();
        const { mode, model } = resolveExecutionConfig(messages);
        const environment = getAgentEnvironment();
        const tools = environment.tools.getModelTools(mode) as ToolContracts;
        const resolvedModel = await (this.options.dependencies?.resolveChatModel
            ?? resolveChatModel)(model, environment);
        const contextProfile = (this.options.dependencies?.resolveModelContextProfile
            ?? resolveModelContextProfile)(model, resolvedModel.provider);
        const startedAt = Date.now();

        const validatedMessages = validateChatMessages(messages, tools);
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
        const auxiliaryProviderUsages: ProviderUsage[] = [];
        const compactionLifecycle: { plan: CompactionPlan | null } = { plan: null };
        const contextCompactor = createSemanticContextCompactor({
            profile: contextProfile,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                const result = await (this.options.dependencies?.generateProviderText
                    ?? generateProviderText)(resolvedModel, {
                    system: instructions,
                    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                    tools: [],
                    maxOutputTokens,
                }, { signal: abortSignal });
                if (result.usage) auxiliaryProviderUsages.push(result.usage);
                return result.text;
            },
            onPhase: async (phase, plan) => {
                compactionLifecycle.plan = plan;
                abortSignal?.throwIfAborted();
                await this.options.onContextEvent?.({
                    phase: reducerPhaseToLifecyclePhase(phase),
                    operationId,
                    operation: "model-step",
                    mode,
                    model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                });
            },
        });
        await this.options.onContextEvent?.({
            phase: "started",
            operationId,
            operation: "model-step",
            mode,
            model,
        });
        let projected: Awaited<ReturnType<typeof projectMessages>>;
        try {
            projected = await projectMessages({
                messages: validatedMessages,
                systemPrompt,
                profile: contextProfile,
                checkpoint,
                compactor: contextCompactor,
                branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
                resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
            });
        } catch (error) {
            if (compactionLifecycle.plan) {
                const plan = compactionLifecycle.plan;
                await this.options.onContextEvent?.({
                    phase: "compaction-failed",
                    operationId,
                    operation: "model-step",
                    mode,
                    model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                });
            }
            throw error;
        }
        const {
            projection,
            compactedSource,
            generatedSummaryId,
            compactionPlan,
            toolResultPruning,
            inputTokensBefore,
        } = projected;
        if (compactionLifecycle.plan && !projection.compaction) {
            const plan = compactionLifecycle.plan;
            await this.options.onContextEvent?.({
                phase: "compaction-aborted",
                operationId,
                operation: "model-step",
                mode,
                model,
                compactionPlanId: plan.planId,
                compactionTrigger: plan.trigger,
                inputTokensBefore: plan.inputTokensBefore,
            });
        }
        this.emitMessageSnapshot(validatedMessages);
        // A generated checkpoint changes the durable Session Tree. It must be
        // committed before this projection is allowed to cross the provider
        // boundary, otherwise a crash/restart can issue a request from state
        // the local authority has never accepted.
        let providerProjection = projection;
        if (projection.compaction) {
            const plan = compactionPlan;
            if (!plan) throw new Error("Automatic compaction is missing its accepted plan");
            await this.options.onContextEvent?.({
                phase: "compaction-applying",
                operationId,
                operation: "model-step",
                mode,
                model,
                compactionPlanId: plan.planId,
                compactionTrigger: plan.trigger,
                inputTokensBefore: plan.inputTokensBefore,
            });
            try {
                const acceptedCheckpoint = await this.emitContextCompaction({
                    projection,
                    compactedSource,
                    generatedSummaryId,
                    compactionPlan: plan,
                    checkpoint,
                });
                if (!acceptedCheckpoint) {
                    throw new Error("Automatic compaction did not produce a durable checkpoint");
                }
                const rehydrated = projectPersistedContext({
                    messages: validatedMessages,
                    systemPrompt,
                    profile: contextProfile,
                    checkpoint: acceptedCheckpoint,
                    branchSummaries: this.options.getBranchSummaryContext?.() ?? [],
                    resolveToolResultSourceEntryId: this.options.getToolResultSourceEntryId,
                });
                if (rehydrated.projection.truncated || rehydrated.projection.overBudget) {
                    throw new Error("Persisted compaction checkpoint does not reconstruct a safe Provider context");
                }
                providerProjection = rehydrated.projection;
                await this.options.onContextEvent?.({
                    phase: "compaction-rebased",
                    operationId,
                    operation: "model-step",
                    mode,
                    model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                    inputTokensAfter: rehydrated.projection.estimatedInputTokens,
                });
            } catch (error) {
                await this.options.onContextEvent?.({
                    phase: "compaction-failed",
                    operationId,
                    operation: "model-step",
                    mode,
                    model,
                    compactionPlanId: plan.planId,
                    compactionTrigger: plan.trigger,
                    inputTokensBefore: plan.inputTokensBefore,
                });
                throw error;
            }
        }
        const modelMessages = compileProjectedModelMessages(providerProjection.records);
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

        if (providerRequest.protocol !== resolvedModel.protocol) {
            throw new Error(
                `Provider adapter protocol mismatch: compiled ${providerRequest.protocol}, resolved ${resolvedModel.protocol}`,
            );
        }

        const nativeRequest: NativeModelRequest = {
            system: systemPrompt,
            messages: modelMessages,
            tools: compileNativeTools(tools),
            prefixIdentity,
            cacheRetention: "short",
        };
        const providerRequestStartedAt = Date.now();
        const executeStream = this.options.dependencies?.streamProvider ?? streamProvider;
        const assistantMessageId = crypto.randomUUID();
        const executionOptions: ProviderExecutionOptions = { signal: abortSignal };

        return new ReadableStream<ChatStreamChunk>({
            start: (controller) => {
                controller.enqueue({ type: "start", messageId: assistantMessageId, metadata: { mode, model } });
                void (async () => {
                    let completedUsage: ProviderUsage | undefined;
                    let finishSeen = false;
                    try {
                        for await (const event of executeStream(resolvedModel, nativeRequest, executionOptions)) {
                            if (event.type === "usage") {
                                completedUsage = { ...completedUsage, ...event.usage };
                                continue;
                            }
                            if (event.type === "finish") {
                                finishSeen = true;
                                continue;
                            }
                            if (event.type === "text-delta") {
                                controller.enqueue({ type: "text-delta", text: event.text });
                            } else if (event.type === "reasoning-delta") {
                                controller.enqueue({ type: "reasoning-delta", text: event.text });
                            } else if (event.type === "part-metadata") {
                                controller.enqueue({
                                    type: "part-metadata",
                                    target: event.target,
                                    providerMetadata: structuredClone(event.providerMetadata),
                                });
                            } else if (event.type === "tool-call") {
                                controller.enqueue({
                                    type: "tool-call",
                                    toolCallId: event.toolCallId,
                                    toolName: event.toolName,
                                    input: event.input,
                                    ...(event.providerMetadata
                                        ? { providerMetadata: structuredClone(event.providerMetadata) }
                                        : {}),
                                });
                            }
                        }
                        if (!finishSeen) throw new Error("Provider stream ended without a finish event");

                        const telemetry = createProviderCacheTelemetry({
                            resolvedModel,
                            usage: completedUsage,
                            prefixIdentity,
                        });
                        this.lastProviderTelemetry = telemetry;
                        this.options.onProviderTelemetry?.(structuredClone(telemetry));

                        const billableUsage = aggregateProviderUsage([
                            ...auxiliaryProviderUsages,
                            ...(completedUsage ? [completedUsage] : []),
                        ]);
                        if (billableUsage) {
                            try {
                                const normalized = normalizeProviderUsage(billableUsage);
                                if (normalized.inputTokens || normalized.outputTokens) {
                                    const pricing = resolvePricingRevision({
                                        providerId: resolvedModel.providerId,
                                        providerKind: resolvedModel.provider,
                                        modelId: resolvedModel.modelId,
                                        at: providerRequestStartedAt,
                                    });
                                    const cost = pricing ? calculateModelStepCost(normalized, pricing) : null;
                                    await this.options.onModelUsage?.({
                                        providerId: resolvedModel.providerId,
                                        providerKind: resolvedModel.provider,
                                        modelId: resolvedModel.modelId,
                                        ...normalized,
                                        ...(pricing ? { pricing } : {}),
                                        ...(cost ? { cost } : {}),
                                    });
                                }
                            } catch (error) {
                                try {
                                    this.options.onModelUsageError?.(
                                        error instanceof Error ? error : new Error(String(error)),
                                    );
                                } catch {
                                    // Post-completion diagnostic observers cannot invalidate Provider completion.
                                }
                            }
                        }

                        controller.enqueue({
                            type: "finish",
                            metadata: { mode, model, durationMs: Date.now() - startedAt },
                            ...(completedUsage ? { usage: completedUsage } : {}),
                        });
                        controller.close();
                    } catch (error) {
                        controller.error(error);
                    }
                })();
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
        compactionPlan: CompactionPlan | null;
        checkpoint: PersistedContextCheckpoint | null;
    }): Promise<PersistedContextCheckpoint | null> {
        const summaryRecord = input.generatedSummaryId
            ? input.projection.records.find((record) => record.id === input.generatedSummaryId)
            : undefined;
        if (!summaryRecord || input.compactedSource.length === 0 || !input.projection.compaction) {
            return null;
        }
        if (isBranchSummaryPayload(summaryRecord.payload)) return null;
        if (!summaryRecord.checkpointV2 || !input.compactionPlan) {
            throw new Error("Compaction candidate is missing Checkpoint V2 plan metadata");
        }
        if (!this.options.onContextCompaction) {
            throw new Error("Compaction requires a durable Session checkpoint authority before Provider execution");
        }

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
        const compactionEvent: ContextCompactionEvent = {
            summary: structuredClone(summaryRecord.payload),
            checkpointV2: structuredClone(summaryRecord.checkpointV2),
            compactionPlanId: input.compactionPlan.planId,
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
        };
        const accepted = await this.options.onContextCompaction(compactionEvent);
        if (!accepted?.checkpointV2) {
            throw new Error("Durable Session authority did not return Checkpoint V2 after commit");
        }
        if (accepted.compactionPlanId !== input.compactionPlan.planId) {
            throw new Error("Persisted compaction plan identity mismatch");
        }
        assertRehydratedCheckpointEquivalent(summaryRecord.checkpointV2, accepted.checkpointV2);
        const sameIds = (left: readonly string[] | undefined, right: readonly string[]) => (
            (left ?? []).length === right.length
            && (left ?? []).every((id, index) => id === right[index])
        );
        if (
            !sameIds(accepted.compactedRecordIds, compactionEvent.compactedRecordIds)
            || !sameIds(accepted.compactedMessageIds, compactionEvent.compactedMessageIds)
            || !sameIds(accepted.retainedTailRecordIds, compactionEvent.retainedTailRecordIds)
            || !sameIds(accepted.retainedTailMessageIds, compactionEvent.retainedTailMessageIds)
        ) {
            throw new Error("Persisted compaction membership mismatch");
        }
        const acceptedSummaryText = accepted.summary.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
        if (acceptedSummaryText !== accepted.checkpointV2.renderedSummary) {
            throw new Error("Persisted compaction summary does not match Checkpoint V2 rendering");
        }
        return structuredClone(accepted);
    }

    private emitMessageSnapshot(messages: Message[]) {
        this.options.onMessageSnapshot?.(structuredClone(messages));
    }
}
