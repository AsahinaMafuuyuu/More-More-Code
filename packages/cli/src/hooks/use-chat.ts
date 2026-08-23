import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
    getToolName,
    isToolUIPart,
} from "ai";
import {
    modelRefEquals,
    type ModelRef,
    type ModeType,
} from "@more-more-code/shared";
import {
    AgentLoop,
    RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
    RUNTIME_EVENT_SCHEMA_VERSION,
    RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
    appendSessionEntry,
    appendSessionTreeMessages,
    getParentSessionEntry,
    getSessionEntry,
    jumpToSessionEntry,
    projectLatestSessionCompaction,
    projectSessionEntryPath,
    projectSessionRuntimeState,
    projectSessionTreeMessages,
    restoreSessionTree,
    type AgentInteraction,
    type AgentRun,
    type AgentToolCall,
    type RuntimeSession,
    type RuntimeSessionRecoveryReport,
    type SessionEntryInput,
    type SessionEntryMetadata,
    type SessionRuntimeState,
    type SessionTreeState,
} from "@more-more-code/harness";
import { executeNativeTool, resolveNativeToolTimeoutMs } from "../lib/local-tools";
import { getAgentEnvironment } from "../lib/agent-environment";
import { ToolRuntime, type ToolExecutionResult } from "../lib/tool-runtime";
import { createAgentUserMessage } from "../lib/agent-chat-message";
import {
    LocalModelTransport,
    type ContextCompactionEvent,
    type ContextProjectionLifecycleEvent,
} from "../lib/local-model-transport";
import { persistSessionState } from "../lib/session-store";
import type { ChatTools, Message } from "../lib/chat-types";
import {
    executeBranchNavigation,
    resolveBranchNavigationIntent,
    type BranchNavigationDecision,
    type BranchNavigationIntent,
} from "../lib/branch-navigation";
import type { BranchSummaryReductionOutcome } from "../lib/branch-summary-reducer";
import { getRuntimeSession } from "../lib/runtime-environment";
import { createEffectivePermissionPolicy } from "../lib/permission-policy";
import { ProcessSandbox } from "../lib/process-sandbox";
import { InteractiveApprovalBroker } from "../lib/interactive-approval-broker";
import { normalizeModelRef } from "../lib/models";

export type { Message } from "../lib/chat-types";

type PendingModelStep = {
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
};

type PromptSelection = {
    mode: ModeType;
    model: ModelRef;
};

export type SessionNavigationOutcome =
    | {
        status: "decision-required";
        intent: BranchNavigationIntent<Message>;
    }
    | {
        status: "cancelled";
        intent: BranchNavigationIntent<Message>;
    }
    | {
        status: "jumped";
        intent: BranchNavigationIntent<Message>;
        runtime: SessionRuntimeState;
    }
    | {
        status: "carried" | "carry-failed";
        intent: BranchNavigationIntent<Message>;
        runtime: SessionRuntimeState;
        reduction: BranchSummaryReductionOutcome;
    };

function toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

function toolFailureCode(result: ToolExecutionResult) {
    switch (result.status) {
        case "denied":
            return "tool_permission_denied";
        case "approval_required":
            return "tool_approval_required";
        case "timed_out":
            return "tool_execution_timed_out";
        default:
            return "tool_execution_failed";
    }
}

function createLocalToolRuntime(
    runtimeSession: RuntimeSession,
    approvalBroker: InteractiveApprovalBroker,
) {
    const environment = getAgentEnvironment();
    const processSandbox = new ProcessSandbox(environment.config.resolved.sandbox);
    return {
        workspaceRoot: environment.config.paths.workspaceRoot,
        runtime: new ToolRuntime({
            registry: environment.tools,
            permissionPolicy: createEffectivePermissionPolicy(environment.config.resolved),
            approvalBroker,
            executors: [{
                source: "native",
                execute(toolName, input, context) {
                    return executeNativeTool(toolName, input, {
                        workspaceRoot: context.workspaceRoot,
                        signal: context.signal,
                        processSandbox,
                    });
                },
                resolveTimeoutMs(toolName, input) {
                    return resolveNativeToolTimeoutMs(toolName, input);
                },
            }],
            async observer(event) {
                const correlation = {
                    runId: event.context.runId,
                    turnId: event.context.turnId,
                    stepId: event.context.stepId,
                    toolCallId: event.context.toolCallId,
                };
                if (event.type === "tool_requested") {
                    await runtimeSession.record({
                        type: "tool",
                        payload: {
                            schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
                            kind: "tool.lifecycle",
                            phase: "requested",
                            toolName: event.toolName,
                            source: event.source,
                            ...correlation,
                        },
                    });
                    return;
                }
                if (event.type === "permission_requested") {
                    await runtimeSession.record({
                        type: "security",
                        payload: {
                            schemaVersion: RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
                            kind: "permission.lifecycle",
                            phase: "requested",
                            capability: event.capability,
                            resourceKind: event.resourceKind,
                            scope: event.scope,
                            ...correlation,
                        },
                    });
                    return;
                }
                if (event.type === "permission_decided") {
                    await runtimeSession.record({
                        type: "security",
                        payload: {
                            schemaVersion: RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
                            kind: "permission.lifecycle",
                            phase: "decided",
                            capability: event.capability,
                            resourceKind: event.resourceKind,
                            scope: event.scope,
                            decision: event.decision,
                            policy: event.policy,
                            ...correlation,
                        },
                    });
                    return;
                }
                if (event.type === "approval_requested") {
                    await runtimeSession.record({
                        type: "security",
                        payload: {
                            schemaVersion: RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
                            kind: "approval.lifecycle",
                            phase: "requested",
                            approvalId: event.approvalId,
                            requirements: event.requirements,
                            ...correlation,
                        },
                    });
                    return;
                }
                if (event.type === "approval_resolved") {
                    await runtimeSession.record({
                        type: "security",
                        payload: {
                            schemaVersion: RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
                            kind: "approval.lifecycle",
                            phase: "resolved",
                            approvalId: event.approvalId,
                            requirements: event.requirements,
                            decision: event.decision,
                            ...correlation,
                        },
                    });
                    return;
                }
                if (event.type === "approval_cancelled" || event.type === "approval_timed_out") {
                    await runtimeSession.record({
                        type: "security",
                        payload: {
                            schemaVersion: RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
                            kind: "approval.lifecycle",
                            phase: event.type === "approval_cancelled" ? "cancelled" : "timed_out",
                            approvalId: event.approvalId,
                            requirements: event.requirements,
                            ...correlation,
                        },
                    });
                    return;
                }
                await runtimeSession.record({
                    type: "tool",
                    payload: {
                        schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
                        kind: "tool.lifecycle",
                        phase: "completed",
                        toolName: event.result.toolName,
                        source: event.result.source,
                        status: event.result.status,
                        durationMs: event.result.durationMs,
                        ...correlation,
                    },
                });
            },
        }),
    };
}

function getPendingToolCalls(message: Message): AgentToolCall[] {
    const toolCalls: AgentToolCall[] = [];

    for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "input-available") continue;

        toolCalls.push({
            toolCallId: part.toolCallId,
            toolName: getToolName(part),
            input: part.input,
        });
    }

    return toolCalls;
}

function cloneMessages(messages: readonly Message[]) {
    return structuredClone(messages) as Message[];
}

function branchSummaryText(summary: unknown) {
    if (typeof summary === "string") return summary.trim();
    if (summary && typeof summary === "object" && "parts" in summary) {
        const parts = (summary as { parts?: unknown }).parts;
        if (Array.isArray(parts)) {
            const text = parts
                .filter((part): part is { type: "text"; text: string } =>
                    Boolean(part)
                    && typeof part === "object"
                    && (part as { type?: unknown }).type === "text"
                    && typeof (part as { text?: unknown }).text === "string")
                .map((part) => part.text)
                .join("\n")
                .trim();
            if (text) return text;
        }
    }
    try {
        return JSON.stringify(summary).trim();
    } catch {
        return String(summary).trim();
    }
}

function getInteractionPrompt(
    interaction: AgentInteraction,
    fallback: PromptSelection,
) {
    const metadataModel = interaction.metadata?.model;
    const model = metadataModel == null
        ? fallback.model
        : normalizeModelRef(metadataModel as ModelRef | string);
    return {
        id: interaction.inputMessageId ?? interaction.id,
        text: interaction.text,
        mode: (interaction.metadata?.mode as ModeType | undefined) ?? fallback.mode,
        model,
    };
}

function getStepMetadata(input: {
    runId: string;
    turnId: string;
    stepId: string;
    inputMessageId?: string;
}): SessionEntryMetadata {
    return {
        runId: input.runId,
        turnId: input.turnId,
        stepId: input.stepId,
        ...(input.inputMessageId ? { inputMessageId: input.inputMessageId } : {}),
    };
}

export function useChat(sessionId: string, persistedSessionState: unknown) {
    const runtimeSession = useMemo(() => getRuntimeSession(sessionId), [sessionId]);
    const approvalBroker = useMemo(() => new InteractiveApprovalBroker(), [sessionId]);
    const agentLoop = useMemo(
        () => new AgentLoop({ eventStore: runtimeSession }),
        [runtimeSession],
    );
    const [run, setRun] = useState<AgentRun | null>(null);
    const [busy, setBusy] = useState(false);
    const [runtimeRecovery, setRuntimeRecovery] = useState<RuntimeSessionRecoveryReport | null>(null);
    const [runtimeError, setRuntimeError] = useState<Error | null>(null);
    const [pendingApprovals, setPendingApprovals] = useState(() => approvalBroker.getPending());
    const [sessionTree, setSessionTree] = useState<SessionTreeState<Message>>(() =>
        restoreSessionTree<Message>(persistedSessionState),
    );
    const sessionTreeRef = useRef(sessionTree);
    const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
    const pendingModelStepRef = useRef<PendingModelStep | null>(null);
    const branchNavigationBusyRef = useRef(false);
    const activeModelStepMetadataRef = useRef<SessionEntryMetadata>({});
    const contextCompactionHandlerRef = useRef<((event: ContextCompactionEvent) => void) | null>(null);
    const latestMessagesRef = useRef<Message[]>(
        cloneMessages(projectSessionTreeMessages(sessionTree)),
    );

    useEffect(() => {
        let active = true;
        setRuntimeRecovery(null);
        setRuntimeError(null);
        void runtimeSession.ready().then((report) => {
            if (active) setRuntimeRecovery(report);
        }).catch((error) => {
            if (active) setRuntimeError(toError(error));
        });
        return () => {
            active = false;
        };
    }, [runtimeSession]);

    useEffect(() => {
        const unsubscribe = approvalBroker.subscribe((pending) => {
            setPendingApprovals([...pending]);
        });
        return () => {
            unsubscribe();
            approvalBroker.cancelAll();
        };
    }, [approvalBroker]);

    const transport = useMemo(() => {
        return new LocalModelTransport({
            onMessageSnapshot(messages) {
                latestMessagesRef.current = cloneMessages(messages);
            },
            onContextCompaction(event) {
                contextCompactionHandlerRef.current?.(event);
            },
            async onContextEvent(event: ContextProjectionLifecycleEvent) {
                const metadata = event.operation === "model-step"
                    ? activeModelStepMetadataRef.current
                    : {};
                await runtimeSession.record({
                    type: "context",
                    payload: {
                        schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
                        kind: "context.projection",
                        phase: event.phase,
                        operationId: event.operationId,
                        operation: event.operation,
                        mode: event.mode,
                        model: `${event.model.providerId}/${event.model.modelId}`,
                        ...(event.phase === "completed" ? {
                            inputTokensBefore: event.inputTokensBefore,
                            inputTokensAfter: event.inputTokensAfter,
                            inputBudgetTokens: event.inputBudgetTokens,
                            toolResultTokensBefore: event.toolResultTokensBefore,
                            toolResultTokensAfter: event.toolResultTokensAfter,
                            prunedToolResultCount: event.prunedToolResultCount,
                            overBudget: event.overBudget,
                            ...(event.compactionTrigger
                                ? { compactionTrigger: event.compactionTrigger }
                                : {}),
                        } : {}),
                        ...(metadata.runId ? { runId: metadata.runId } : {}),
                        ...(metadata.turnId ? { turnId: metadata.turnId } : {}),
                        ...(metadata.stepId ? { stepId: metadata.stepId } : {}),
                    },
                });
            },
            getContextCheckpoint() {
                const checkpoint = projectLatestSessionCompaction(sessionTreeRef.current);
                if (!checkpoint) return null;
                return {
                    summary: structuredClone(checkpoint.summary) as Message,
                    compactedMessageIds: checkpoint.compactedMessageIds,
                    retainedTailMessageIds: checkpoint.retainedTailMessageIds,
                    compactedRecordIds: checkpoint.compactedRecordIds,
                    retainedTailRecordIds: checkpoint.retainedTailRecordIds,
                };
            },
            getBranchSummaryContext() {
                const anchors: Array<{
                    entryId: string;
                    summary: string;
                    afterMessageId: string | null;
                }> = [];
                let lastMessageId: string | null = null;
                for (const entry of projectSessionEntryPath(sessionTreeRef.current)) {
                    if (
                        entry.type === "user_message"
                        || entry.type === "assistant_message"
                        || entry.type === "custom_message"
                        || entry.type === "message_update"
                    ) {
                        lastMessageId = entry.messageId;
                        continue;
                    }
                    if (entry.type !== "branch_summary") continue;
                    const summary = branchSummaryText(entry.summary);
                    if (!summary) continue;
                    anchors.push({
                        entryId: entry.id,
                        summary,
                        afterMessageId: lastMessageId,
                    });
                }
                return anchors;
            },
            getToolResultSourceEntryId(toolCallId) {
                return projectSessionEntryPath(sessionTreeRef.current)
                    .findLast((entry) => entry.type === "tool_result" && entry.toolCallId === toolCallId)
                    ?.id;
            },
        });
    }, [runtimeSession]);

    const chat = useAiChat<Message>({
        id: sessionId,
        messages: latestMessagesRef.current,
        transport,
        onFinish({ message, isAbort, isDisconnect, isError }) {
            const pending = pendingModelStepRef.current;
            if (!pending) return;

            pendingModelStepRef.current = null;

            if (isAbort) {
                pending.reject(new Error("Model step was interrupted"));
                return;
            }

            if (isDisconnect) {
                pending.reject(new Error("Model step disconnected"));
                return;
            }

            if (isError) {
                pending.reject(new Error("Model step failed"));
                return;
            }

            pending.resolve(message);
        },
        onError(error) {
            const pending = pendingModelStepRef.current;
            if (!pending) return;

            pendingModelStepRef.current = null;
            pending.reject(error);
        },
    });

    const persistTreeBestEffort = useCallback((state: SessionTreeState<Message>) => {
        const snapshot = structuredClone(state) as SessionTreeState<Message>;
        persistQueueRef.current = persistQueueRef.current
            .catch(() => undefined)
            .then(() => persistSessionState(sessionId, snapshot))
            .catch((error) => {
                console.error("Failed to sync session entry tree", {
                    sessionId,
                    error,
                });
            });
    }, [sessionId]);

    const applyTreeState = useCallback((state: SessionTreeState<Message>, persist = true) => {
        sessionTreeRef.current = state;
        setSessionTree(state);
        if (persist) persistTreeBestEffort(state);
    }, [persistTreeBestEffort]);

    const appendEntry = useCallback((input: SessionEntryInput<Message>) => {
        const nextTree = appendSessionEntry(sessionTreeRef.current, input);
        applyTreeState(nextTree);
        return nextTree;
    }, [applyTreeState]);

    const syncMessagesToTree = useCallback((metadata: SessionEntryMetadata = {}) => {
        const currentTree = sessionTreeRef.current;
        const nextTree = appendSessionTreeMessages(
            currentTree,
            latestMessagesRef.current,
            metadata,
        );
        if (nextTree !== currentTree) applyTreeState(nextTree);
        return nextTree;
    }, [applyTreeState]);

    contextCompactionHandlerRef.current = (event) => {
        const metadata = activeModelStepMetadataRef.current;
        syncMessagesToTree(metadata);
        appendEntry({
            type: "compaction",
            summary: event.summary,
            tokensBefore: event.tokensBefore,
            trigger: event.trigger,
            inputTokensBefore: event.inputTokensBefore,
            inputTokensAfter: event.inputTokensAfter,
            inputBudgetTokens: event.inputBudgetTokens,
            targetInputTokens: event.targetInputTokens,
            targetSummaryTokens: event.targetSummaryTokens,
            ...(event.compactedThroughRecordId
                ? { compactedThroughRecordId: event.compactedThroughRecordId }
                : {}),
            ...(event.compactedThroughMessageId
                ? { compactedThroughMessageId: event.compactedThroughMessageId }
                : {}),
            compactedMessageIds: event.compactedMessageIds,
            retainedTailMessageIds: event.retainedTailMessageIds,
            compactedRecordIds: event.compactedRecordIds,
            retainedTailRecordIds: event.retainedTailRecordIds,
            ...metadata,
        });
    };

    const recordPromptSelection = useCallback((
        selection: PromptSelection,
        metadata: SessionEntryMetadata = {},
    ) => {
        const currentTree = sessionTreeRef.current;
        const runtime = projectSessionRuntimeState(currentTree);
        let nextTree = currentTree;

        let runtimeModel: ModelRef | null = null;
        if (runtime.model) {
            try {
                runtimeModel = normalizeModelRef(runtime.model, runtime.provider);
            } catch {
                runtimeModel = null;
            }
        }
        if (!modelRefEquals(runtimeModel, selection.model)) {
            nextTree = appendSessionEntry(nextTree, {
                type: "model_change",
                model: selection.model.modelId,
                provider: selection.model.providerId,
                ...metadata,
            });
        }
        if (runtime.mode !== selection.mode) {
            nextTree = appendSessionEntry(nextTree, {
                type: "mode_change",
                mode: selection.mode,
                ...metadata,
            });
        }

        if (nextTree !== currentTree) applyTreeState(nextTree);
        return nextTree;
    }, [applyTreeState]);

    const chatStopRef = useRef(chat.stop);
    chatStopRef.current = chat.stop;

    const stopModelStep = useCallback(() => {
        chatStopRef.current();

        const pending = pendingModelStepRef.current;
        if (!pending) return;

        pendingModelStepRef.current = null;
        pending.reject(new Error("Model step was interrupted"));
    }, []);

    const interruptRun = useCallback(() => {
        if (!agentLoop.interrupt()) {
            stopModelStep();
        }
    }, [agentLoop, stopModelStep]);

    function runModelRequest(request: () => Promise<void>) {
        if (pendingModelStepRef.current) {
            return Promise.reject(new Error("A model step is already pending"));
        }

        return new Promise<Message>((resolve, reject) => {
            const pending: PendingModelStep = { resolve, reject };
            pendingModelStepRef.current = pending;

            void request().catch((error) => {
                if (pendingModelStepRef.current !== pending) return;

                pendingModelStepRef.current = null;
                reject(toError(error));
            });
        });
    }

    const applyNavigationTreeState = useCallback((nextTree: SessionTreeState<Message>): SessionRuntimeState => {
        if (agentLoop.isBusy) {
            throw new Error("Cannot jump session entries while the agent runtime is busy");
        }

        const messages = cloneMessages(projectSessionTreeMessages(nextTree));
        const runtime = projectSessionRuntimeState(nextTree);

        latestMessagesRef.current = messages;
        chat.setMessages(messages);
        applyTreeState(nextTree);
        return runtime;
    }, [agentLoop, applyTreeState, chat]);

    const inspectNavigation = useCallback((entryId: string) => {
        if (agentLoop.isBusy || pendingModelStepRef.current || branchNavigationBusyRef.current) {
            throw new Error("Cannot navigate session entries while the agent runtime is busy");
        }
        return resolveBranchNavigationIntent({
            state: sessionTreeRef.current,
            targetEntryId: entryId,
            policy: getAgentEnvironment().config.resolved.session.branchSummaryOnJump,
        });
    }, [agentLoop]);

    const navigateToEntry = useCallback(async (input: {
        entryId: string;
        selection: PromptSelection;
        decision?: BranchNavigationDecision;
    }): Promise<SessionNavigationOutcome> => {
        if (agentLoop.isBusy || pendingModelStepRef.current) {
            throw new Error("Cannot navigate session entries while the agent runtime is busy");
        }
        if (branchNavigationBusyRef.current) {
            throw new Error("A session navigation operation is already in progress");
        }
        branchNavigationBusyRef.current = true;
        try {
            let runtime: SessionRuntimeState | null = null;
            const result = await executeBranchNavigation<Message, BranchSummaryReductionOutcome>({
                state: sessionTreeRef.current,
                targetEntryId: input.entryId,
                policy: getAgentEnvironment().config.resolved.session.branchSummaryOnJump,
                ...(input.decision ? { decision: input.decision } : {}),
                onTargetState(nextTree) {
                    runtime = applyNavigationTreeState(nextTree);
                },
                async summarize(analysis) {
                    setBusy(true);
                    try {
                        return await transport.summarizeBranch({
                            analysis,
                            mode: input.selection.mode,
                            model: input.selection.model,
                        });
                    } finally {
                        setBusy(false);
                    }
                },
            });

            if (result.status === "decision-required" || result.status === "cancelled") {
                return { status: result.status, intent: result.intent };
            }
            if (!runtime) {
                runtime = projectSessionRuntimeState(result.state);
            }
            if (result.status === "carried") {
                applyTreeState(result.state);
            }
            if (result.status === "jumped") {
                return { status: "jumped", intent: result.intent, runtime };
            }
            if ("reduction" in result) {
                return {
                    status: result.status,
                    intent: result.intent,
                    runtime,
                    reduction: result.reduction,
                };
            }
            throw new Error(`Unhandled branch navigation outcome: ${result.status}`);
        } finally {
            branchNavigationBusyRef.current = false;
        }
    }, [agentLoop, applyNavigationTreeState, applyTreeState, transport]);

    const navigateToParent = useCallback((input: {
        selection: PromptSelection;
        decision?: BranchNavigationDecision;
    }) => {
        const parent = getParentSessionEntry(sessionTreeRef.current);
        if (!parent) return Promise.resolve(null);
        return navigateToEntry({
            entryId: parent.id,
            selection: input.selection,
            ...(input.decision ? { decision: input.decision } : {}),
        });
    }, [navigateToEntry]);

    const navigateToRoot = useCallback((input: {
        selection: PromptSelection;
        decision?: BranchNavigationDecision;
    }) => navigateToEntry({
        entryId: sessionTreeRef.current.rootEntryId,
        selection: input.selection,
        ...(input.decision ? { decision: input.decision } : {}),
    }), [navigateToEntry]);

    const resolveApproval = useCallback((
        approvalId: string,
        decision: "allow" | "deny",
    ) => approvalBroker.resolve(approvalId, decision), [approvalBroker]);

    const cancelApproval = useCallback((approvalId: string) => {
        return approvalBroker.cancel(approvalId, "Approval dialog dismissed");
    }, [approvalBroker]);

    return {
        messages: chat.messages,
        status: chat.status,
        error: runtimeError ?? chat.error,
        run,
        busy,
        runtimeRecovery,
        pendingApproval: pendingApprovals[0] ?? null,
        resolveApproval,
        cancelApproval,
        sessionTree,
        inspectNavigation,
        navigateToEntry,
        navigateToNode: navigateToEntry,
        navigateToParent,
        navigateToRoot,
        recordPromptSelection,
        recordConfigChange: (key: string, value: unknown, previousValue?: unknown) => {
            return appendEntry({
                type: "config_change",
                key,
                value,
                ...(previousValue === undefined ? {} : { previousValue }),
            });
        },
        recordCustomEntry: (customType: string, data: unknown) => {
            return appendEntry({ type: "custom", customType, data });
        },
        compact: async (params: PromptSelection) => {
            if (agentLoop.isBusy || pendingModelStepRef.current) {
                throw new Error("Cannot compact context while the agent runtime is busy");
            }

            setBusy(true);
            try {
                await runtimeSession.ready();
                return await transport.compactContext({
                    messages: cloneMessages(latestMessagesRef.current),
                    mode: params.mode,
                    model: params.model,
                });
            } finally {
                setBusy(false);
            }
        },
        submit: async (params: {
            userText: string;
            mode: ModeType;
            model: ModelRef;
        }) => {
            await runtimeSession.ready();
            const inputMessageId = crypto.randomUUID();
            recordPromptSelection(params);
            setBusy(true);

            try {
                let activeExecutionSelection: PromptSelection = {
                    mode: params.mode,
                    model: params.model,
                };
                let activeExecutionInputMessageId: string = inputMessageId;

                const completedRun = await agentLoop.run({
                    sessionId,
                    inputMessageId,
                    onStateChange: setRun,
                    adapter: {
                        async runModelStep({ continuation, interaction, run, turn, step }) {
                            const prompt = interaction
                                ? getInteractionPrompt(interaction, activeExecutionSelection)
                                : continuation
                                    ? null
                                    : {
                                        id: inputMessageId,
                                        text: params.userText,
                                        mode: params.mode,
                                        model: params.model,
                                    };

                            if (prompt) {
                                activeExecutionSelection = {
                                    mode: prompt.mode,
                                    model: prompt.model,
                                };
                                activeExecutionInputMessageId = prompt.id;
                            }

                            const metadata = getStepMetadata({
                                runId: run.id,
                                turnId: turn.id,
                                stepId: step.id,
                                inputMessageId: activeExecutionInputMessageId,
                            });
                            if (prompt) recordPromptSelection(activeExecutionSelection, metadata);
                            activeModelStepMetadataRef.current = metadata;

                            try {
                                const responseMessage = await runModelRequest(() => {
                                    if (prompt) {
                                        return chat.sendMessage(createAgentUserMessage(prompt));
                                    }

                                    return chat.sendMessage();
                                });

                                syncMessagesToTree(metadata);
                                return {
                                    toolCalls: getPendingToolCalls(responseMessage),
                                };
                            } catch (error) {
                                syncMessagesToTree(metadata);
                                const resolved = toError(error);
                                appendEntry({
                                    type: "error",
                                    message: resolved.message,
                                    code: "model_step_failed",
                                    details: { cause: turn.cause },
                                    ...metadata,
                                });
                                throw resolved;
                            }
                        },
                        async runToolStep(toolCall, { run, turn, step, signal }) {
                            const metadata = getStepMetadata({
                                runId: run.id,
                                turnId: turn.id,
                                stepId: step.id,
                                inputMessageId: turn.inputMessageId,
                            });
                            appendEntry({
                                type: "tool_call",
                                toolCallId: toolCall.toolCallId,
                                toolName: toolCall.toolName,
                                input: toolCall.input,
                                ...metadata,
                            });

                            let toolRuntimeResult: ToolExecutionResult | null = null;
                            try {
                                const { runtime: toolRuntime, workspaceRoot } = createLocalToolRuntime(
                                    runtimeSession,
                                    approvalBroker,
                                );
                                toolRuntimeResult = await toolRuntime.run({
                                    toolName: toolCall.toolName,
                                    input: toolCall.input,
                                    context: {
                                        sessionId,
                                        runId: run.id,
                                        turnId: turn.id,
                                        stepId: step.id,
                                        toolCallId: toolCall.toolCallId,
                                        workspaceRoot,
                                        mode: activeExecutionSelection.mode,
                                        signal,
                                    },
                                });
                                if (toolRuntimeResult.status !== "completed") {
                                    throw new Error(toolRuntimeResult.error ?? `Tool ended with status ${toolRuntimeResult.status}`);
                                }
                                const output = toolRuntimeResult.output;

                                await chat.addToolOutput({
                                    tool: toolCall.toolName as keyof ChatTools,
                                    toolCallId: toolCall.toolCallId,
                                    output,
                                });
                                appendEntry({
                                    type: "tool_result",
                                    toolCallId: toolCall.toolCallId,
                                    toolName: toolCall.toolName,
                                    output,
                                    status: toolRuntimeResult.status,
                                    source: toolRuntimeResult.source,
                                    startedAt: toolRuntimeResult.startedAt,
                                    completedAt: toolRuntimeResult.completedAt,
                                    durationMs: toolRuntimeResult.durationMs,
                                    ...metadata,
                                });
                            } catch (error) {
                                const resolved = toError(error);
                                await chat.addToolOutput({
                                    tool: toolCall.toolName as keyof ChatTools,
                                    toolCallId: toolCall.toolCallId,
                                    state: "output-error",
                                    errorText: resolved.message,
                                });
                                appendEntry({
                                    type: "tool_result",
                                    toolCallId: toolCall.toolCallId,
                                    toolName: toolCall.toolName,
                                    error: resolved.message,
                                    status: toolRuntimeResult?.status ?? "failed",
                                    ...(toolRuntimeResult ? {
                                        source: toolRuntimeResult.source,
                                        startedAt: toolRuntimeResult.startedAt,
                                        completedAt: toolRuntimeResult.completedAt,
                                        durationMs: toolRuntimeResult.durationMs,
                                    } : {}),
                                    ...metadata,
                                });
                                if (toolRuntimeResult?.status !== "cancelled") {
                                    appendEntry({
                                        type: "error",
                                        message: resolved.message,
                                        code: toolRuntimeResult ? toolFailureCode(toolRuntimeResult) : "tool_execution_failed",
                                        details: {
                                            toolCallId: toolCall.toolCallId,
                                            toolName: toolCall.toolName,
                                            ...(toolRuntimeResult ? {
                                                status: toolRuntimeResult.status,
                                                source: toolRuntimeResult.source,
                                                durationMs: toolRuntimeResult.durationMs,
                                            } : {}),
                                        },
                                        ...metadata,
                                    });
                                }
                                // Executor outcomes are normalized by ToolRuntime. A thrown
                                // error before any result therefore means policy/observer/
                                // Runtime Store infrastructure failed; propagate it so
                                // AgentLoop records a failed step/run and cannot continue to
                                // another external side effect.
                                if (!toolRuntimeResult) throw resolved;
                            }
                        },
                        abortModelStep: stopModelStep,
                    },
                });

                syncMessagesToTree({
                    runId: completedRun.id,
                    inputMessageId,
                });
                if (completedRun.status === "failed" && completedRun.error) {
                    appendEntry({
                        type: "error",
                        message: completedRun.error,
                        code: "run_failed",
                        runId: completedRun.id,
                        inputMessageId,
                    });
                }

                return completedRun;
            } finally {
                setBusy(false);
            }
        },
        steer: (params: {
            userText: string;
            mode: ModeType;
            model: ModelRef;
        }) => {
            const queued = agentLoop.steer({
                text: params.userText,
                inputMessageId: crypto.randomUUID(),
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            });
            if (queued) recordPromptSelection(params, {
                runId: agentLoop.currentRun?.id,
            });
            return queued;
        },
        followUp: (params: {
            userText: string;
            mode: ModeType;
            model: ModelRef;
        }) => {
            const queued = agentLoop.followUp({
                text: params.userText,
                inputMessageId: crypto.randomUUID(),
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            });
            if (queued) recordPromptSelection(params, {
                runId: agentLoop.currentRun?.id,
            });
            return queued;
        },
        abort: interruptRun,
        interrupt: interruptRun,
        waitForIdle: () => agentLoop.waitForIdle(),
        getEntry: (entryId: string) => getSessionEntry(sessionTreeRef.current, entryId),
        getNode: (nodeId: string) => getSessionEntry(sessionTreeRef.current, nodeId),
    };
}
