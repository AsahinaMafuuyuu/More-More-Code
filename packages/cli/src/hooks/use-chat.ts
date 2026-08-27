import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
    getToolName,
    isToolUIPart,
} from "ai";
import {
    type ModelRef,
    type ModeType,
} from "@more-more-code/shared";
import {
    AgentLoop,
    RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
    RUNTIME_EVENT_SCHEMA_VERSION,
    RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
    appendSessionEntry,
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
import {
    LocalModelTransport,
    type ContextCompactionEvent,
    type ContextProjectionLifecycleEvent,
} from "../lib/local-model-transport";
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
import { getLocalSessionAuthority } from "../lib/session-environment";
import { runDurableSessionTurn } from "../lib/durable-session-turn";
import {
    inspectDurableToolCall,
    persistThenExposeToolTerminal,
    type PersistThenExposeToolTerminalInput,
} from "../lib/durable-tool-terminal";
import { appendDurableSessionMessages } from "../lib/durable-session-message";
import { getCliRunLifecycle } from "../lib/run-lifecycle";

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
    const localSessionAuthority = useMemo(() => getLocalSessionAuthority(), []);
    const runLifecycle = useMemo(() => getCliRunLifecycle(), []);
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
    const treeWriteTailRef = useRef<Promise<void>>(Promise.resolve());
    const inFlightWorkRef = useRef(new Set<Promise<unknown>>());
    const pendingModelStepRef = useRef<PendingModelStep | null>(null);
    const branchNavigationBusyRef = useRef(false);
    const activeModelStepMetadataRef = useRef<SessionEntryMetadata>({});
    const contextCompactionHandlerRef = useRef<((event: ContextCompactionEvent) => Promise<void>) | null>(null);
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
                return contextCompactionHandlerRef.current?.(event);
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

    const applyTreeState = useCallback((state: SessionTreeState<Message>) => {
        sessionTreeRef.current = state;
        setSessionTree(state);
    }, []);

    const trackInFlightWork = useCallback(<T,>(work: Promise<T>): Promise<T> => {
        inFlightWorkRef.current.add(work);
        void work.then(
            () => {
                inFlightWorkRef.current.delete(work);
            },
            () => {
                inFlightWorkRef.current.delete(work);
            },
        );
        return work;
    }, []);

    const waitForDurableWork = useCallback(async () => {
        // AgentLoop's idle signal is emitted before its caller performs the
        // final Session Tree sync. Track the outer work promise as well as the
        // serialized tree tail so shutdown cannot close SQLite in that gap.
        while (true) {
            const work = [...inFlightWorkRef.current];
            const treeTail = treeWriteTailRef.current;
            await Promise.all([treeTail, ...work]);
            if (
                treeTail === treeWriteTailRef.current
                && work.every((operation) => !inFlightWorkRef.current.has(operation))
            ) {
                return;
            }
        }
    }, []);

    const queueTreeWrite = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
        const previous = treeWriteTailRef.current;
        let release!: () => void;
        const completion = new Promise<void>((resolve) => {
            release = resolve;
        });
        treeWriteTailRef.current = completion;
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }, []);

    const commitTreeNow = useCallback(async (state: SessionTreeState<Message>) => {
        const snapshot = await localSessionAuthority.commit({ sessionId, state });
        const committedState = restoreSessionTree<Message>(snapshot.state);
        applyTreeState(committedState);
        return committedState;
    }, [applyTreeState, localSessionAuthority, sessionId]);

    const commitTree = useCallback((state: SessionTreeState<Message>) => {
        return queueTreeWrite(() => commitTreeNow(state));
    }, [commitTreeNow, queueTreeWrite]);

    const transitionTree = useCallback((
        transition: (state: SessionTreeState<Message>) => SessionTreeState<Message>,
    ) => queueTreeWrite(async () => {
        const currentTree = sessionTreeRef.current;
        const nextTree = transition(currentTree);
        if (nextTree === currentTree) return currentTree;
        return commitTreeNow(nextTree);
    }), [commitTreeNow, queueTreeWrite]);

    const appendEntry = useCallback(async (input: SessionEntryInput<Message>) => {
        return transitionTree((state) => appendSessionEntry(state, input));
    }, [transitionTree]);

    const syncMessagesToTree = useCallback(async (metadata: SessionEntryMetadata = {}) => {
        await transitionTree((state) => appendDurableSessionMessages(
            state,
            latestMessagesRef.current,
            metadata,
        ));
    }, [transitionTree]);

    const persistToolTerminal = useCallback(async (
        input: Omit<
            PersistThenExposeToolTerminalInput,
            "authority" | "sessionId" | "state" | "onCommitted"
        >,
    ) => queueTreeWrite(() => persistThenExposeToolTerminal({
        ...input,
        authority: localSessionAuthority,
        sessionId,
        // Read after earlier queued semantic transitions settle, otherwise a
        // Tool terminal could fork from a stale pre-tool-call tree.
        state: sessionTreeRef.current,
        onCommitted(committedState) {
            applyTreeState(committedState);
            latestMessagesRef.current = cloneMessages(projectSessionTreeMessages(committedState));
        },
    })), [applyTreeState, localSessionAuthority, queueTreeWrite, sessionId]);

    contextCompactionHandlerRef.current = async (event) => {
        const metadata = activeModelStepMetadataRef.current;
        try {
            // The history sync and its checkpoint form one semantic Session
            // Tree transition. Applying it through one authority commit means
            // neither the UI nor the next provider request can observe a
            // checkpoint whose source history was not persisted with it.
            await transitionTree((state) => appendSessionEntry(
                appendDurableSessionMessages(
                    state,
                    latestMessagesRef.current,
                    metadata,
                ),
                {
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
                },
            ));
        } catch (error) {
            setRuntimeError(toError(error));
            throw error;
        }
    };

    const recordPromptSelection = useCallback((
        selection: PromptSelection,
        metadata: SessionEntryMetadata = {},
    ) => transitionTree((currentTree) => {
        const runtime = projectSessionRuntimeState(currentTree);
        let nextTree = currentTree;

        if (
            runtime.model !== selection.model.modelId
            || runtime.provider !== selection.model.providerId
        ) {
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
        return nextTree;
    }).then(() => undefined), [transitionTree]);

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

    useEffect(() => runLifecycle.register({
        interrupt: interruptRun,
        waitForIdle: () => agentLoop.waitForIdle(),
        waitForPersistence: waitForDurableWork,
    }), [agentLoop, interruptRun, runLifecycle, waitForDurableWork]);

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

    const applyNavigationTreeState = useCallback(async (
        nextTree: SessionTreeState<Message>,
    ): Promise<SessionRuntimeState> => {
        if (agentLoop.isBusy) {
            throw new Error("Cannot jump session entries while the agent runtime is busy");
        }

        const committedTree = await commitTree(nextTree);
        const messages = cloneMessages(projectSessionTreeMessages(committedTree));
        const runtime = projectSessionRuntimeState(committedTree);

        latestMessagesRef.current = messages;
        chat.setMessages(messages);
        return runtime;
    }, [agentLoop, chat, commitTree]);

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
                async onTargetState(nextTree) {
                    runtime = await applyNavigationTreeState(nextTree);
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
                await commitTree(result.state);
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
    }, [agentLoop, applyNavigationTreeState, commitTree, transport]);

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

    const syncChatMessagesFromTree = useCallback((state = sessionTreeRef.current) => {
        const messages = cloneMessages(projectSessionTreeMessages(state));
        latestMessagesRef.current = messages;
        chat.setMessages(messages);
    }, [chat]);

    const runAgentLoop = useCallback(async (input: {
        params: PromptSelection & { userText: string };
        inputMessageId: string;
    }) => {
        runLifecycle.assertCanStartWork();
        let activeExecutionSelection: PromptSelection = {
            mode: input.params.mode,
            model: input.params.model,
        };
        let activeExecutionInputMessageId = input.inputMessageId;

        const completedRun = await agentLoop.run({
            sessionId,
            inputMessageId: input.inputMessageId,
            onStateChange: setRun,
            adapter: {
                async runModelStep({ continuation, interaction, run, turn, step }) {
                    // A Run may have begun immediately before shutdown closed
                    // the global work gate. Re-check at the actual provider
                    // boundary so it cannot issue a new model request then.
                    runLifecycle.assertCanStartWork();
                    const prompt = interaction
                        ? getInteractionPrompt(interaction, activeExecutionSelection)
                        : continuation
                            ? null
                            : {
                                id: input.inputMessageId,
                                text: input.params.userText,
                                mode: input.params.mode,
                                model: input.params.model,
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
                    activeModelStepMetadataRef.current = metadata;

                    try {
                        // Every user intent was already committed by the durable
                        // turn gate. Reproject it here before each model step so
                        // continuing, steering, and restart state share one path.
                        if (prompt) syncChatMessagesFromTree();
                        const responseMessage = await runModelRequest(() => chat.sendMessage());
                        await syncMessagesToTree(metadata);
                        return {
                            toolCalls: getPendingToolCalls(responseMessage),
                        };
                    } catch (error) {
                        await syncMessagesToTree(metadata);
                        const resolved = toError(error);
                        await appendEntry({
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
                    // Same race guard at the external Tool boundary. Terminal
                    // persistence below intentionally remains allowed after a
                    // Tool has already started and shutdown interrupts it.
                    runLifecycle.assertCanStartWork();
                    const metadata = getStepMetadata({
                        runId: run.id,
                        turnId: turn.id,
                        stepId: step.id,
                        inputMessageId: turn.inputMessageId,
                    });
                    const durableToolCall = inspectDurableToolCall(
                        sessionTreeRef.current,
                        toolCall.toolCallId,
                    );
                    if (durableToolCall.status === "terminal") {
                        // A restart/recovery path may encounter the same model
                        // tool call again. Its durable terminal already carries
                        // the corresponding message_update, so restore that
                        // output instead of repeating an external side effect.
                        syncChatMessagesFromTree();
                        return;
                    }
                    if (durableToolCall.status === "pending") {
                        throw new Error(
                            `Cannot automatically repeat incomplete tool call ${toolCall.toolCallId}; it may have produced an external side effect`,
                        );
                    }
                    // Tool Runtime must not execute a Tool until its semantic
                    // request is a durable Session Entry.
                    await appendEntry({
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
                            const errorMessage = toolRuntimeResult.error
                                ?? `Tool ended with status ${toolRuntimeResult.status}`;
                            await persistToolTerminal({
                                toolCallId: toolCall.toolCallId,
                                toolName: toolCall.toolName,
                                presentation: {
                                    state: "output-error",
                                    errorText: errorMessage,
                                },
                                result: {
                                    status: toolRuntimeResult.status,
                                    source: toolRuntimeResult.source,
                                    startedAt: toolRuntimeResult.startedAt,
                                    completedAt: toolRuntimeResult.completedAt,
                                    durationMs: toolRuntimeResult.durationMs,
                                },
                                metadata,
                                ...(toolRuntimeResult.status === "cancelled" ? {} : {
                                    error: {
                                        message: errorMessage,
                                        code: toolFailureCode(toolRuntimeResult),
                                        details: {
                                            toolCallId: toolCall.toolCallId,
                                            toolName: toolCall.toolName,
                                            status: toolRuntimeResult.status,
                                            source: toolRuntimeResult.source,
                                            durationMs: toolRuntimeResult.durationMs,
                                        },
                                    },
                                }),
                                async expose() {
                                    await chat.addToolOutput({
                                        tool: toolCall.toolName as keyof ChatTools,
                                        toolCallId: toolCall.toolCallId,
                                        state: "output-error",
                                        errorText: errorMessage,
                                    });
                                },
                            });
                            return;
                        }
                        const output = toolRuntimeResult.output;

                        await persistToolTerminal({
                            toolCallId: toolCall.toolCallId,
                            toolName: toolCall.toolName,
                            presentation: { state: "output-available", output },
                            result: {
                                status: toolRuntimeResult.status,
                                source: toolRuntimeResult.source,
                                startedAt: toolRuntimeResult.startedAt,
                                completedAt: toolRuntimeResult.completedAt,
                                durationMs: toolRuntimeResult.durationMs,
                            },
                            metadata,
                            async expose() {
                                await chat.addToolOutput({
                                    tool: toolCall.toolName as keyof ChatTools,
                                    toolCallId: toolCall.toolCallId,
                                    output,
                                });
                            },
                        });
                    } catch (error) {
                        const resolved = toError(error);
                        // A ToolRuntime result that reaches this catch failed at
                        // the durable terminal/UI bridge. Never manufacture a
                        // conflicting second terminal, and never allow the
                        // AgentLoop to take its continuation model step.
                        if (toolRuntimeResult) throw resolved;

                        // ToolRuntime itself failed before it returned a
                        // normalized terminal. Persist one recoverable failed
                        // terminal if possible, then fail the Run closed.
                        await persistToolTerminal({
                            toolCallId: toolCall.toolCallId,
                            toolName: toolCall.toolName,
                            presentation: {
                                state: "output-error",
                                errorText: resolved.message,
                            },
                            result: { status: "failed" },
                            metadata,
                            error: {
                                message: resolved.message,
                                code: "tool_execution_failed",
                                details: {
                                    toolCallId: toolCall.toolCallId,
                                    toolName: toolCall.toolName,
                                },
                            },
                            async expose() {
                                await chat.addToolOutput({
                                    tool: toolCall.toolName as keyof ChatTools,
                                    toolCallId: toolCall.toolCallId,
                                    state: "output-error",
                                    errorText: resolved.message,
                                });
                            },
                        });
                        throw resolved;
                    }
                },
                abortModelStep: stopModelStep,
            },
        });

        await syncMessagesToTree({
            runId: completedRun.id,
            inputMessageId: input.inputMessageId,
        });
        if (completedRun.status === "failed" && completedRun.error) {
            await appendEntry({
                type: "error",
                message: completedRun.error,
                code: "run_failed",
                runId: completedRun.id,
                inputMessageId: input.inputMessageId,
            });
        }
        return completedRun;
    }, [
        agentLoop,
        approvalBroker,
        appendEntry,
        chat,
        persistToolTerminal,
        runtimeSession,
        runLifecycle,
        sessionId,
        stopModelStep,
        syncChatMessagesFromTree,
        syncMessagesToTree,
    ]);

    const queueDurableInteraction = useCallback((input: {
        kind: "steering" | "follow-up";
        userText: string;
        mode: ModeType;
        model: ModelRef;
    }) => trackInFlightWork((async () => {
        runLifecycle.assertCanStartWork();
        if (!agentLoop.isRunning) return false;
        const inputMessageId = crypto.randomUUID();
        return queueTreeWrite(() => runDurableSessionTurn({
            authority: localSessionAuthority,
            sessionId,
            // Read this only after preceding semantic transitions have
            // committed, so steering/follow-up cannot overwrite a queued
            // message, branch, or compaction transition.
            state: sessionTreeRef.current,
            userText: input.userText,
            selection: { mode: input.mode, model: input.model },
            inputMessageId,
            runAgent: async ({ state, inputMessageId: durableInputMessageId }) => {
                applyTreeState(state);
                const metadata = {
                    mode: input.mode,
                    model: input.model,
                };
                return input.kind === "steering"
                    ? agentLoop.steer({
                        text: input.userText,
                        inputMessageId: durableInputMessageId,
                        metadata,
                    })
                    : agentLoop.followUp({
                        text: input.userText,
                        inputMessageId: durableInputMessageId,
                        metadata,
                    });
            },
        }));
    })()), [
        agentLoop,
        applyTreeState,
        localSessionAuthority,
        queueTreeWrite,
        runLifecycle,
        sessionId,
        trackInFlightWork,
    ]);

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
        compact: (params: PromptSelection) => trackInFlightWork((async () => {
            runLifecycle.assertCanStartWork();
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
        })()),
        submit: (params: {
            userText: string;
            mode: ModeType;
            model: ModelRef;
        }) => trackInFlightWork((async () => {
            runLifecycle.assertCanStartWork();
            setBusy(true);
            try {
                // Let already-visible local transitions finish before taking
                // the fresh durable user-intent snapshot.
                await treeWriteTailRef.current;
                return await runDurableSessionTurn({
                    authority: localSessionAuthority,
                    sessionId,
                    state: sessionTreeRef.current,
                    userText: params.userText,
                    selection: { mode: params.mode, model: params.model },
                    runAgent: async ({ state, inputMessageId }) => {
                        applyTreeState(state);
                        syncChatMessagesFromTree(state);
                        await runtimeSession.ready();
                        return runAgentLoop({
                            params,
                            inputMessageId,
                        });
                    },
                });
            } catch (error) {
                const resolved = toError(error);
                setRuntimeError(resolved);
                throw resolved;
            } finally {
                setBusy(false);
            }
        })()),
        steer: (params: {
            userText: string;
            mode: ModeType;
            model: ModelRef;
        }) => queueDurableInteraction({ kind: "steering", ...params }),
        followUp: (params: {
            userText: string;
            mode: ModeType;
            model: ModelRef;
        }) => queueDurableInteraction({ kind: "follow-up", ...params }),
        abort: interruptRun,
        interrupt: interruptRun,
        waitForIdle: () => agentLoop.waitForIdle(),
        getEntry: (entryId: string) => getSessionEntry(sessionTreeRef.current, entryId),
        getNode: (nodeId: string) => getSessionEntry(sessionTreeRef.current, nodeId),
    };
}
