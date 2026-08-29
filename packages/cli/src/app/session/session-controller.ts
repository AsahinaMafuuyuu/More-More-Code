import { getToolName, isToolUIPart } from "../../lib/chat-types";
import {
  AgentLoop,
  RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
  RUNTIME_EVENT_SCHEMA_VERSION,
  RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
  appendSessionEntry,
  getParentSessionEntry,
  getSessionEntry,
  projectLatestSessionCompaction,
  projectSessionEntryPath,
  projectSessionRuntimeState,
  restoreSessionTree,
  type AgentInteraction,
  type AgentRun,
  type AgentToolCall,
  type ApprovalRequest,
  type RuntimeSession,
  type RuntimeSessionRecoveryReport,
  type SessionEntryInput,
  type SessionEntryMetadata,
  type SessionRuntimeState,
  type SessionTreeState,
  type SessionUsageSummary,
} from "@more-more-code/harness";
import type { ModelRef, ModeType } from "@more-more-code/shared";
import type { LocalSessionAuthority } from "../../lib/local-session-authority";
import { getLocalSessionAuthority } from "../../lib/session-environment";
import { getRuntimeSession } from "../../lib/runtime-environment";
import {
  getAgentEnvironment,
  subscribeAgentEnvironment,
  type AgentEnvironment,
} from "../../lib/agent-environment";
import { getCliRunLifecycle, type CliRunLifecycle } from "../../lib/run-lifecycle";
import { InteractiveApprovalBroker } from "../../lib/interactive-approval-broker";
import {
  LocalModelTransport,
  type ContextCompactionEvent,
  type ContextProjectionLifecycleEvent,
  type CurrentContextUsage,
  type ManualContextCompactionOutcome,
  type PersistedContextCheckpoint,
} from "../../lib/local-model-transport";
import { executeNativeTool, resolveNativeToolTimeoutMs } from "../../lib/local-tools";
import { ToolRuntime, type ToolExecutionResult } from "../../lib/tool-runtime";
import { createEffectivePermissionPolicy } from "../../lib/permission-policy";
import { ProcessSandbox } from "../../lib/process-sandbox";
import { normalizeModelRef } from "../../lib/models";
import {
  executeBranchNavigation,
  resolveBranchNavigationIntent,
  type BranchNavigationDecision,
  type BranchNavigationIntent,
} from "../../lib/branch-navigation";
import type { BranchSummaryReductionOutcome } from "../../lib/branch-summary-reducer";
import { runDurableSessionTurn } from "../../lib/durable-session-turn";
import { buildDurableSessionTurnState } from "../../lib/durable-session-turn";
import {
  inspectDurableToolCall,
  persistThenExposeToolTerminal,
  type PersistThenExposeToolTerminalInput,
} from "../../lib/durable-tool-terminal";
import {
  appendFinalizedDurableAssistantStep,
  projectDurableSessionMessages,
} from "../../lib/durable-session-message";
import { createRuntimeUsagePayload } from "../../lib/provider-usage";
import {
  reduceAgentActivityProgress,
  type AgentActivityProgressState,
} from "../../lib/agent-activity-projection";
import type { ChatTools, Message } from "../../lib/chat-types";

type PendingModelStep = {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
};

export type PromptSelection = {
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

export type SessionChatBridge = {
  setMessages(messages: Message[]): void;
  sendMessage(): Promise<unknown>;
  addToolOutput(input: {
    tool: keyof ChatTools;
    toolCallId: string;
    state?: "output-error";
    errorText?: string;
    output?: unknown;
  }): Promise<unknown> | unknown;
  stop(): void;
};

type ContextCompactionLifecycleEvent = Extract<
  ContextProjectionLifecycleEvent,
  { compactionPlanId: string }
>;

export type ContextCompactionActivityState = Readonly<{
  operationId: string;
  compactionPlanId: string;
  phase: ContextCompactionLifecycleEvent["phase"];
  startedAt: number;
  inputTokensBefore?: number;
  inputTokensAfter?: number;
}>;

export type SessionControllerSnapshot = Readonly<{
  run: AgentRun | null;
  activityProgressByStep: AgentActivityProgressState;
  busy: boolean;
  runtimeRecovery: RuntimeSessionRecoveryReport | null;
  runtimeError: Error | null;
  sessionUsage: SessionUsageSummary;
  latestProviderCacheHitRate: number | null;
  contextUsage: CurrentContextUsage | null;
  contextCompactionActivity: ContextCompactionActivityState | null;
  usagePersistenceIncomplete: boolean;
  pendingApprovals: readonly ApprovalRequest[];
  pendingInteractions: readonly AgentInteraction[];
  pendingInteractionOutcomes: readonly Readonly<{
    interaction: AgentInteraction;
    reason: "run-interrupted" | "run-failed";
  }>[];
  sessionTree: SessionTreeState<Message>;
}>;

type AgentLoopLike = Pick<
  AgentLoop,
  | "isBusy"
  | "isRunning"
  | "pendingInteractions"
  | "interrupt"
  | "waitForIdle"
  | "subscribe"
  | "subscribePendingInteractions"
  | "run"
  | "enqueueSteering"
  | "enqueueFollowUp"
  | "cancelPendingInteraction"
  | "promoteFollowUpToSteering"
>;

type RuntimeSessionLike = Pick<RuntimeSession, "ready" | "record" | "getUsageSummary">;

export type SessionControllerServices = {
  runtimeSession: RuntimeSessionLike;
  localSessionAuthority: LocalSessionAuthority;
  runLifecycle: Pick<CliRunLifecycle, "assertCanStartWork" | "register">;
  approvalBroker: InteractiveApprovalBroker;
  agentLoop: AgentLoopLike;
  getAgentEnvironment: typeof getAgentEnvironment;
  subscribeAgentEnvironment: typeof subscribeAgentEnvironment;
};

export type SessionControllerOptions = {
  sessionId: string;
  persistedSessionState: unknown;
  services?: SessionControllerServices;
};

type SessionControllerListener = () => void;

export class SessionController {
  readonly sessionId: string;
  readonly transport: LocalModelTransport;

  private readonly services: SessionControllerServices;
  private snapshot: SessionControllerSnapshot;
  private readonly listeners = new Set<SessionControllerListener>();
  private readonly unsubscribeTasks: Array<() => void> = [];
  private treeWriteTail: Promise<void> = Promise.resolve();
  private readonly inFlightWork = new Set<Promise<unknown>>();
  private pendingModelStep: PendingModelStep | null = null;
  private branchNavigationBusy = false;
  private activeModelStepMetadata: SessionEntryMetadata = {};
  private latestMessages: Message[];
  private chatBridge: SessionChatBridge | null = null;
  private attached = false;
  private disposed = false;

  constructor(options: SessionControllerOptions) {
    this.sessionId = options.sessionId;
    this.services = options.services ?? createDefaultServices(options.sessionId);
    const sessionTree = restoreSessionTree<Message>(options.persistedSessionState);
    this.latestMessages = cloneMessages(projectDurableSessionMessages(sessionTree));
    this.snapshot = Object.freeze({
      run: null,
      activityProgressByStep: {},
      busy: false,
      runtimeRecovery: null,
      runtimeError: null,
      sessionUsage: this.services.runtimeSession.getUsageSummary(),
      latestProviderCacheHitRate: null,
      contextUsage: null,
      contextCompactionActivity: null,
      usagePersistenceIncomplete: false,
      pendingApprovals: this.services.approvalBroker.getPending(),
      pendingInteractions: this.services.agentLoop.pendingInteractions,
      pendingInteractionOutcomes: [],
      sessionTree,
    });

    this.transport = new LocalModelTransport({
      onMessageSnapshot: (messages) => {
        this.latestMessages = cloneMessages(messages);
      },
      onContextCompaction: (event) => this.persistContextCompaction(event),
      onContextEvent: (event) => this.persistContextEvent(event),
      onModelUsage: async (event) => {
        const metadata = this.activeModelStepMetadata;
        if (!metadata.runId || !metadata.turnId || !metadata.stepId) {
          throw new Error("Completed Model Usage is missing active run/turn/step correlation");
        }
        await this.services.runtimeSession.record({
          type: "usage",
          payload: createRuntimeUsagePayload({
            correlation: {
              runId: metadata.runId,
              turnId: metadata.turnId,
              stepId: metadata.stepId,
            },
            completion: event,
          }),
        });
        this.update({ sessionUsage: this.services.runtimeSession.getUsageSummary() });
      },
      onModelUsageError: () => {
        this.update({ usagePersistenceIncomplete: true });
      },
      onProviderTelemetry: (telemetry) => {
        const hitRate = telemetry.inputTokens !== undefined
          && telemetry.inputTokens > 0
          && telemetry.cachedPromptTokens !== undefined
          ? telemetry.cachedPromptTokens / telemetry.inputTokens
          : null;
        this.update({ latestProviderCacheHitRate: hitRate });
      },
      getContextCheckpoint: () => {
        const checkpoint = projectLatestSessionCompaction(this.snapshot.sessionTree);
        if (!checkpoint) return null;
        return {
          summary: structuredClone(checkpoint.summary) as Message,
          ...(checkpoint.checkpointV2
            ? { checkpointV2: structuredClone(checkpoint.checkpointV2) }
            : {}),
          ...(checkpoint.compactionPlanId ? { compactionPlanId: checkpoint.compactionPlanId } : {}),
          compactedMessageIds: checkpoint.compactedMessageIds,
          retainedTailMessageIds: checkpoint.retainedTailMessageIds,
          compactedRecordIds: checkpoint.compactedRecordIds,
          retainedTailRecordIds: checkpoint.retainedTailRecordIds,
        };
      },
      getBranchSummaryContext: () => {
        const anchors: Array<{
          entryId: string;
          summary: string;
          afterMessageId: string | null;
        }> = [];
        let lastMessageId: string | null = null;
        for (const entry of projectSessionEntryPath(this.snapshot.sessionTree)) {
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
          anchors.push({ entryId: entry.id, summary, afterMessageId: lastMessageId });
        }
        return anchors;
      },
      getToolResultSourceEntryId: (toolCallId) => projectSessionEntryPath(this.snapshot.sessionTree)
        .findLast((entry) => entry.type === "tool_result" && entry.toolCallId === toolCallId)
        ?.id,
    });
  }

  getSnapshot = (): SessionControllerSnapshot => this.snapshot;

  subscribe = (listener: SessionControllerListener): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getInitialMessages = (): Message[] => cloneMessages(this.latestMessages);

  bindChatBridge = (bridge: SessionChatBridge): void => {
    if (this.disposed) return;
    this.chatBridge = bridge;
  };

  async attach(): Promise<void> {
    if (this.disposed) throw new Error("Cannot attach a disposed SessionController");
    if (this.attached) return;
    this.attached = true;

    this.unsubscribeTasks.push(this.services.approvalBroker.subscribe((pending) => {
      this.update({ pendingApprovals: [...pending] });
    }));
    this.unsubscribeTasks.push(this.services.subscribeAgentEnvironment(() => {
      this.recomputeContextUsage();
    }));
    this.unsubscribeTasks.push(this.services.agentLoop.subscribe((event) => {
      this.update({
        activityProgressByStep: reduceAgentActivityProgress(
          this.snapshot.activityProgressByStep,
          event,
        ),
      });
    }));
    this.unsubscribeTasks.push(this.services.agentLoop.subscribePendingInteractions(() => {
      this.update({
        pendingInteractions: this.services.agentLoop.pendingInteractions,
      });
    }));
    this.unsubscribeTasks.push(this.services.runLifecycle.register({
      interrupt: this.interrupt,
      waitForIdle: () => this.services.agentLoop.waitForIdle(),
      waitForPersistence: this.waitForDurableWork,
    }));

    try {
      const report = await this.services.runtimeSession.ready();
      this.update({
        runtimeRecovery: report ?? null,
        sessionUsage: this.services.runtimeSession.getUsageSummary(),
      });
      this.recomputeContextUsage();
    } catch (error) {
      const resolved = toError(error);
      this.update({ runtimeError: resolved });
      throw resolved;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.interrupt();
    this.services.approvalBroker.cancelAll();
    try {
      await this.services.agentLoop.waitForIdle();
      await this.waitForDurableWork();
    } finally {
      this.disposed = true;
      while (this.unsubscribeTasks.length > 0) {
        this.unsubscribeTasks.pop()?.();
      }
      this.chatBridge = null;
      this.listeners.clear();
    }
  }

  completeModelStep = (input: {
    message: Message;
    isAbort: boolean;
    isDisconnect: boolean;
    isError: boolean;
  }): void => {
    const pending = this.pendingModelStep;
    if (!pending) return;
    this.pendingModelStep = null;
    if (input.isAbort) {
      pending.reject(new Error("Model step was interrupted"));
      return;
    }
    if (input.isDisconnect) {
      pending.reject(new Error("Model step disconnected"));
      return;
    }
    if (input.isError) {
      pending.reject(new Error("Model step failed"));
      return;
    }
    pending.resolve(input.message);
  };

  failModelStep = (error: Error): void => {
    const pending = this.pendingModelStep;
    if (!pending) return;
    this.pendingModelStep = null;
    pending.reject(error);
  };

  interrupt = (): void => {
    if (!this.services.agentLoop.interrupt()) {
      this.stopModelStep();
    }
  };

  waitForIdle = (): Promise<void> => this.services.agentLoop.waitForIdle();

  recordPromptSelection = (
    selection: PromptSelection,
    metadata: SessionEntryMetadata = {},
  ): Promise<void> => this.transitionTree((currentTree) => {
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
  }).then(() => undefined);

  changeMode = (mode: ModeType, model: ModelRef): Promise<void> => (
    this.recordPromptSelection({ mode, model })
  );

  changeModel = (model: ModelRef, mode: ModeType): Promise<void> => (
    this.recordPromptSelection({ mode, model })
  );

  recordConfigChange = (key: string, value: unknown, previousValue?: unknown) => this.appendEntry({
    type: "config_change",
    key,
    value,
    ...(previousValue === undefined ? {} : { previousValue }),
  });

  recordCustomEntry = (customType: string, data: unknown) => this.appendEntry({
    type: "custom",
    customType,
    data,
  });

  resolveApproval = (approvalId: string, decision: "allow" | "deny"): boolean => (
    this.services.approvalBroker.resolve(approvalId, decision)
  );

  cancelApproval = (approvalId: string): boolean => (
    this.services.approvalBroker.cancel(approvalId, "Approval dialog dismissed")
  );

  inspectNavigation = (entryId: string) => {
    if (
      this.services.agentLoop.isBusy
      || this.pendingModelStep
      || this.branchNavigationBusy
    ) {
      throw new Error("Cannot navigate session entries while the agent runtime is busy");
    }
    return resolveBranchNavigationIntent({
      state: this.snapshot.sessionTree,
      targetEntryId: entryId,
      policy: this.services.getAgentEnvironment().config.resolved.session.branchSummaryOnJump,
    });
  };

  navigateToEntry = async (input: {
    entryId: string;
    selection: PromptSelection;
    decision?: BranchNavigationDecision;
  }): Promise<SessionNavigationOutcome> => {
    if (this.services.agentLoop.isBusy || this.pendingModelStep) {
      throw new Error("Cannot navigate session entries while the agent runtime is busy");
    }
    if (this.branchNavigationBusy) {
      throw new Error("A session navigation operation is already in progress");
    }
    this.branchNavigationBusy = true;
    try {
      let runtime: SessionRuntimeState | null = null;
      const result = await executeBranchNavigation<Message, BranchSummaryReductionOutcome>({
        state: this.snapshot.sessionTree,
        targetEntryId: input.entryId,
        policy: this.services.getAgentEnvironment().config.resolved.session.branchSummaryOnJump,
        ...(input.decision ? { decision: input.decision } : {}),
        onTargetState: async (nextTree) => {
          runtime = await this.applyNavigationTreeState(nextTree);
        },
        summarize: async (analysis) => {
          this.update({ busy: true });
          try {
            return await this.transport.summarizeBranch({
              analysis,
              mode: input.selection.mode,
              model: input.selection.model,
            });
          } finally {
            this.update({ busy: false });
          }
        },
      });
      if (result.status === "decision-required" || result.status === "cancelled") {
        return { status: result.status, intent: result.intent };
      }
      if (!runtime) runtime = projectSessionRuntimeState(result.state);
      if (result.status === "carried") await this.commitTree(result.state);
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
      this.branchNavigationBusy = false;
    }
  };

  navigateToParent = (input: {
    selection: PromptSelection;
    decision?: BranchNavigationDecision;
  }) => {
    const parent = getParentSessionEntry(this.snapshot.sessionTree);
    if (!parent) return Promise.resolve(null);
    return this.navigateToEntry({
      entryId: parent.id,
      selection: input.selection,
      ...(input.decision ? { decision: input.decision } : {}),
    });
  };

  navigateToRoot = (input: {
    selection: PromptSelection;
    decision?: BranchNavigationDecision;
  }) => this.navigateToEntry({
    entryId: this.snapshot.sessionTree.rootEntryId,
    selection: input.selection,
    ...(input.decision ? { decision: input.decision } : {}),
  });

  compact = (params: PromptSelection): Promise<ManualContextCompactionOutcome> => this.trackInFlightWork((async () => {
    this.services.runLifecycle.assertCanStartWork();
    if (this.services.agentLoop.isBusy || this.pendingModelStep) {
      throw new Error("Cannot compact context while the agent runtime is busy");
    }
    this.update({ busy: true });
    try {
      await this.services.runtimeSession.ready();
      return await this.transport.compactContext({
        messages: cloneMessages(this.latestMessages),
        mode: params.mode,
        model: params.model,
      });
    } finally {
      this.update({ busy: false });
    }
  })());

  submit = (params: PromptSelection & { userText: string }) => this.trackInFlightWork((async () => {
    this.services.runLifecycle.assertCanStartWork();
    this.update({ busy: true, pendingInteractionOutcomes: [] });
    try {
      await this.treeWriteTail;
      return await runDurableSessionTurn({
        authority: this.services.localSessionAuthority,
        sessionId: this.sessionId,
        state: this.snapshot.sessionTree,
        userText: params.userText,
        selection: { mode: params.mode, model: params.model },
        runAgent: async ({ state, inputMessageId }) => {
          this.applyTreeState(state);
          this.syncChatMessagesFromTree(state);
          await this.services.runtimeSession.ready();
          return this.runAgentLoop({ params, inputMessageId });
        },
      });
    } catch (error) {
      const resolved = toError(error);
      this.update({ runtimeError: resolved });
      throw resolved;
    } finally {
      this.update({ busy: false });
    }
  })());

  steer = (params: PromptSelection & { userText: string }) => this.queueDurableInteraction({
    kind: "steering",
    ...params,
  });

  followUp = (params: PromptSelection & { userText: string }) => this.queueDurableInteraction({
    kind: "follow-up",
    ...params,
  });

  cancelPendingInteraction = (interactionId: string): boolean => (
    this.services.agentLoop.cancelPendingInteraction(interactionId)
  );

  promoteFollowUpToSteering = (interactionId: string): boolean => (
    this.services.agentLoop.promoteFollowUpToSteering(interactionId)
  );

  getEntry = (entryId: string) => getSessionEntry(this.snapshot.sessionTree, entryId);
  getNode = this.getEntry;

  private update(patch: Partial<SessionControllerSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    if (this.disposed) return;
    for (const listener of [...this.listeners]) listener();
  }

  private applyTreeState(state: SessionTreeState<Message>): void {
    this.update({ sessionTree: state });
    this.recomputeContextUsage();
  }

  private trackInFlightWork<T>(work: Promise<T>): Promise<T> {
    this.inFlightWork.add(work);
    void work.then(
      () => this.inFlightWork.delete(work),
      () => this.inFlightWork.delete(work),
    );
    return work;
  }

  private waitForDurableWork = async (): Promise<void> => {
    while (true) {
      const work = [...this.inFlightWork];
      const treeTail = this.treeWriteTail;
      await Promise.all([treeTail, ...work]);
      if (
        treeTail === this.treeWriteTail
        && work.every((operation) => !this.inFlightWork.has(operation))
      ) {
        return;
      }
    }
  };

  private async queueTreeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.treeWriteTail;
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.treeWriteTail = completion;
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async commitTreeNow(state: SessionTreeState<Message>): Promise<SessionTreeState<Message>> {
    const snapshot = await this.services.localSessionAuthority.commit({
      sessionId: this.sessionId,
      state,
    });
    const committedState = restoreSessionTree<Message>(snapshot.state);
    this.applyTreeState(committedState);
    return committedState;
  }

  private commitTree(state: SessionTreeState<Message>): Promise<SessionTreeState<Message>> {
    return this.queueTreeWrite(() => this.commitTreeNow(state));
  }

  private transitionTree(
    transition: (state: SessionTreeState<Message>) => SessionTreeState<Message>,
  ): Promise<SessionTreeState<Message>> {
    return this.queueTreeWrite(async () => {
      const currentTree = this.snapshot.sessionTree;
      const nextTree = transition(currentTree);
      if (nextTree === currentTree) return currentTree;
      return this.commitTreeNow(nextTree);
    });
  }

  private appendEntry(input: SessionEntryInput<Message>): Promise<SessionTreeState<Message>> {
    return this.transitionTree((state) => appendSessionEntry(state, input));
  }

  private persistToolTerminal(
    input: Omit<
      PersistThenExposeToolTerminalInput,
      "authority" | "sessionId" | "state" | "onCommitted"
    >,
  ) {
    return this.queueTreeWrite(() => persistThenExposeToolTerminal({
      ...input,
      authority: this.services.localSessionAuthority,
      sessionId: this.sessionId,
      state: this.snapshot.sessionTree,
      onCommitted: (committedState) => {
        this.applyTreeState(committedState);
        this.latestMessages = cloneMessages(projectDurableSessionMessages(committedState));
      },
    }));
  }

  private async persistContextCompaction(event: ContextCompactionEvent): Promise<PersistedContextCheckpoint> {
    const metadata = this.activeModelStepMetadata;
    try {
      await this.transitionTree((state) => {
        const alreadyCommitted = projectSessionEntryPath(state).some((entry) => (
          entry.type === "compaction" && entry.compactionPlanId === event.compactionPlanId
        ));
        if (alreadyCommitted) return state;
        return appendSessionEntry(state, {
          type: "compaction",
          summary: event.summary,
          checkpointV2: structuredClone(event.checkpointV2),
          compactionPlanId: event.compactionPlanId,
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
      });
      const committed = projectSessionEntryPath(this.snapshot.sessionTree).findLast((entry) => (
        entry.type === "compaction" && entry.compactionPlanId === event.compactionPlanId
      ));
      if (!committed || committed.type !== "compaction" || !committed.checkpointV2) {
        throw new Error("Committed Session authority did not rehydrate Checkpoint V2");
      }
      return {
        summary: structuredClone(committed.summary) as Message,
        checkpointV2: structuredClone(committed.checkpointV2),
        compactionPlanId: committed.compactionPlanId,
        compactedMessageIds: committed.compactedMessageIds,
        retainedTailMessageIds: committed.retainedTailMessageIds,
        compactedRecordIds: committed.compactedRecordIds,
        retainedTailRecordIds: committed.retainedTailRecordIds,
      };
    } catch (error) {
      this.update({ runtimeError: toError(error) });
      throw error;
    }
  }

  private async persistContextEvent(event: ContextProjectionLifecycleEvent): Promise<void> {
    const metadata = event.operation === "model-step" ? this.activeModelStepMetadata : {};
    const compactionEvent = "compactionPlanId" in event ? event : null;
    await this.services.runtimeSession.record({
      type: "context",
      payload: {
        schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
        kind: "context.projection",
        phase: event.phase,
        operationId: event.operationId,
        operation: event.operation,
        mode: event.mode,
        model: `${event.model.providerId}/${event.model.modelId}`,
        ...(compactionEvent ? {
          compactionPlanId: compactionEvent.compactionPlanId,
          compactionTrigger: compactionEvent.compactionTrigger,
          ...(compactionEvent.inputTokensBefore !== undefined
            ? { inputTokensBefore: compactionEvent.inputTokensBefore }
            : {}),
          ...(compactionEvent.inputTokensAfter !== undefined
            ? { inputTokensAfter: compactionEvent.inputTokensAfter }
            : {}),
        } : event.phase === "completed" ? {
          inputTokensBefore: event.inputTokensBefore,
          inputTokensAfter: event.inputTokensAfter,
          inputBudgetTokens: event.inputBudgetTokens,
          toolResultTokensBefore: event.toolResultTokensBefore,
          toolResultTokensAfter: event.toolResultTokensAfter,
          prunedToolResultCount: event.prunedToolResultCount,
          overBudget: event.overBudget,
          ...(event.compactionTrigger ? { compactionTrigger: event.compactionTrigger } : {}),
        } : {}),
        ...(metadata.runId ? { runId: metadata.runId } : {}),
        ...(metadata.turnId ? { turnId: metadata.turnId } : {}),
        ...(metadata.stepId ? { stepId: metadata.stepId } : {}),
      },
    });
    if (compactionEvent) {
      const current = this.snapshot.contextCompactionActivity;
      this.update({
        contextCompactionActivity: {
          operationId: compactionEvent.operationId,
          compactionPlanId: compactionEvent.compactionPlanId,
          phase: compactionEvent.phase,
          startedAt:
            current?.operationId === compactionEvent.operationId
              ? current.startedAt
              : Date.now(),
          ...(compactionEvent.inputTokensBefore !== undefined
            ? { inputTokensBefore: compactionEvent.inputTokensBefore }
            : current?.inputTokensBefore !== undefined
              ? { inputTokensBefore: current.inputTokensBefore }
              : {}),
          ...(compactionEvent.inputTokensAfter !== undefined
            ? { inputTokensAfter: compactionEvent.inputTokensAfter }
            : {}),
        },
      });
    } else if (event.phase === "started" && this.snapshot.contextCompactionActivity !== null) {
      this.update({ contextCompactionActivity: null });
    }
  }

  private recomputeContextUsage(): void {
    const runtime = projectSessionRuntimeState(this.snapshot.sessionTree);
    if ((runtime.mode !== "BUILD" && runtime.mode !== "PLAN") || !runtime.model) {
      if (this.snapshot.contextUsage !== null) this.update({ contextUsage: null });
      return;
    }
    try {
      const model = normalizeModelRef(runtime.model, runtime.provider);
      const contextUsage = this.transport.inspectCurrentContext({
        messages: cloneMessages(projectDurableSessionMessages(this.snapshot.sessionTree)),
        mode: runtime.mode,
        model,
      });
      this.update({ contextUsage });
    } catch {
      if (this.snapshot.contextUsage !== null) this.update({ contextUsage: null });
    }
  }

  private stopModelStep(): void {
    this.chatBridge?.stop();
    const pending = this.pendingModelStep;
    if (!pending) return;
    this.pendingModelStep = null;
    pending.reject(new Error("Model step was interrupted"));
  }

  private runModelRequest(request: () => Promise<unknown>): Promise<Message> {
    if (this.pendingModelStep) {
      return Promise.reject(new Error("A model step is already pending"));
    }
    return new Promise<Message>((resolve, reject) => {
      const pending: PendingModelStep = { resolve, reject };
      this.pendingModelStep = pending;
      void request().catch((error) => {
        if (this.pendingModelStep !== pending) return;
        this.pendingModelStep = null;
        reject(toError(error));
      });
    });
  }

  private async applyNavigationTreeState(
    nextTree: SessionTreeState<Message>,
  ): Promise<SessionRuntimeState> {
    if (this.services.agentLoop.isBusy) {
      throw new Error("Cannot jump session entries while the agent runtime is busy");
    }
    const committedTree = await this.commitTree(nextTree);
    const messages = cloneMessages(projectDurableSessionMessages(committedTree));
    const runtime = projectSessionRuntimeState(committedTree);
    this.latestMessages = messages;
    this.requireChatBridge().setMessages(messages);
    return runtime;
  }

  private syncChatMessagesFromTree(state = this.snapshot.sessionTree): void {
    const messages = cloneMessages(projectDurableSessionMessages(state));
    this.latestMessages = messages;
    this.requireChatBridge().setMessages(messages);
  }

  private async runAgentLoop(input: {
    params: PromptSelection & { userText: string };
    inputMessageId: string;
  }) {
    this.services.runLifecycle.assertCanStartWork();
    const runEnvironment = this.services.getAgentEnvironment();
    let activeExecutionSelection: PromptSelection = {
      mode: input.params.mode,
      model: input.params.model,
    };
    let activeExecutionInputMessageId = input.inputMessageId;

    const completedRun = await this.services.agentLoop.run({
      sessionId: this.sessionId,
      inputMessageId: input.inputMessageId,
      toolExecution: runEnvironment.config.resolved.tools.execution,
      onStateChange: (run) => this.update({ run }),
      onPendingInteractionOutcome: (outcome) => {
        const next = [
          ...this.snapshot.pendingInteractionOutcomes,
          {
            interaction: structuredClone(outcome.interaction),
            reason: outcome.reason,
          },
        ].slice(-4);
        this.update({ pendingInteractionOutcomes: next });
      },
      adapter: {
        commitInteraction: async (interaction) => {
          const prompt = getInteractionPrompt(interaction, activeExecutionSelection);
          const next = buildDurableSessionTurnState({
            sessionId: this.sessionId,
            state: this.snapshot.sessionTree,
            userText: prompt.text,
            selection: { mode: prompt.mode, model: prompt.model },
          });
          const committedTree = await this.commitTree(next.state);
          this.latestMessages = cloneMessages(projectDurableSessionMessages(committedTree));
          this.requireChatBridge().setMessages(this.latestMessages);
          return {
            ...interaction,
            inputMessageId: next.inputMessageId,
          };
        },
        runModelStep: async ({ continuation, interaction, run, turn, step }) => {
          this.services.runLifecycle.assertCanStartWork();
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
            activeExecutionSelection = { mode: prompt.mode, model: prompt.model };
            activeExecutionInputMessageId = prompt.id;
          }
          const metadata = getStepMetadata({
            runId: run.id,
            turnId: turn.id,
            stepId: step.id,
            inputMessageId: activeExecutionInputMessageId,
          });
          this.activeModelStepMetadata = metadata;
          try {
            if (prompt) this.syncChatMessagesFromTree();
            const responseMessage = await this.runModelRequest(
              () => this.requireChatBridge().sendMessage(),
            );
            const committedTree = await this.transitionTree((state) => (
              appendFinalizedDurableAssistantStep(state, responseMessage, metadata)
            ));
            const durableMessages = cloneMessages(projectDurableSessionMessages(committedTree));
            this.latestMessages = durableMessages;
            this.requireChatBridge().setMessages(durableMessages);
            return { toolCalls: getPendingToolCalls(responseMessage) };
          } catch (error) {
            const resolved = toError(error);
            await this.appendEntry({
              type: "error",
              message: resolved.message,
              code: "model_step_failed",
              details: { cause: turn.cause },
              ...metadata,
            });
            throw resolved;
          }
        },
        runToolStep: async (toolCall, { run, turn, step, signal }) => {
          this.services.runLifecycle.assertCanStartWork();
          const metadata = getStepMetadata({
            runId: run.id,
            turnId: turn.id,
            stepId: step.id,
            inputMessageId: turn.inputMessageId,
          });
          const durableToolCall = inspectDurableToolCall(
            this.snapshot.sessionTree,
            toolCall.toolCallId,
          );
          if (durableToolCall.status === "terminal") {
            this.syncChatMessagesFromTree();
            return;
          }
          if (durableToolCall.status === "pending") {
            throw new Error(
              `Cannot automatically repeat incomplete tool call ${toolCall.toolCallId}; it may have produced an external side effect`,
            );
          }
          await this.appendEntry({
            type: "tool_call",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            ...metadata,
          });

          let toolRuntimeResult: ToolExecutionResult | null = null;
          try {
            const { runtime: toolRuntime, workspaceRoot } = createLocalToolRuntime(
              this.services.runtimeSession,
              this.services.approvalBroker,
              this.services.getAgentEnvironment(),
            );
            toolRuntimeResult = await toolRuntime.run({
              toolName: toolCall.toolName,
              input: toolCall.input,
              context: {
                sessionId: this.sessionId,
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
              await this.persistToolTerminal({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                presentation: { state: "output-error", errorText: errorMessage },
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
                expose: async () => {
                  await this.requireChatBridge().addToolOutput({
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
            await this.persistToolTerminal({
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
              expose: async () => {
                await this.requireChatBridge().addToolOutput({
                  tool: toolCall.toolName as keyof ChatTools,
                  toolCallId: toolCall.toolCallId,
                  output,
                });
              },
            });
          } catch (error) {
            const resolved = toError(error);
            if (toolRuntimeResult) throw resolved;
            await this.persistToolTerminal({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              presentation: { state: "output-error", errorText: resolved.message },
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
              expose: async () => {
                await this.requireChatBridge().addToolOutput({
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
        getToolExecutionSafety: (toolCall) => (
          runEnvironment.tools.getToolDefinition(
            toolCall.toolName,
            activeExecutionSelection.mode,
          )?.executionSafety ?? { parallelSafe: false, effect: "unknown" }
        ),
        abortModelStep: () => this.stopModelStep(),
      },
    });

    if (completedRun.status === "failed" && completedRun.error) {
      await this.appendEntry({
        type: "error",
        message: completedRun.error,
        code: "run_failed",
        runId: completedRun.id,
        inputMessageId: input.inputMessageId,
      });
    }
    return completedRun;
  }

  private queueDurableInteraction(input: {
    kind: "steering" | "follow-up";
    userText: string;
    mode: ModeType;
    model: ModelRef;
  }) {
    return this.trackInFlightWork((async () => {
      this.services.runLifecycle.assertCanStartWork();
      const metadata = { mode: input.mode, model: input.model };
      const queued = input.kind === "steering"
        ? this.services.agentLoop.enqueueSteering({
            text: input.userText,
            metadata,
          })
        : this.services.agentLoop.enqueueFollowUp({
            text: input.userText,
            metadata,
          });
      if (queued) {
        if (this.snapshot.pendingInteractionOutcomes.length > 0) {
          this.update({ pendingInteractionOutcomes: [] });
        }
        return queued;
      }

      // The old Run may have closed its acceptance gate between the UI read
      // and this authoritative submission. Wait for settlement, then route
      // the exact same text through the normal durable new-Round path.
      await this.services.agentLoop.waitForIdle();
      return this.submit({
        userText: input.userText,
        mode: input.mode,
        model: input.model,
      });
    })());
  }

  private requireChatBridge(): SessionChatBridge {
    if (!this.chatBridge) {
      throw new Error("SessionController chat bridge is not attached");
    }
    return this.chatBridge;
  }
}

function createDefaultServices(sessionId: string): SessionControllerServices {
  const runtimeSession = getRuntimeSession(sessionId);
  const approvalBroker = new InteractiveApprovalBroker();
  return {
    runtimeSession,
    localSessionAuthority: getLocalSessionAuthority(),
    runLifecycle: getCliRunLifecycle(),
    approvalBroker,
    agentLoop: new AgentLoop({ eventStore: runtimeSession }),
    getAgentEnvironment,
    subscribeAgentEnvironment,
  };
}

function createLocalToolRuntime(
  runtimeSession: RuntimeSessionLike,
  approvalBroker: InteractiveApprovalBroker,
  environment: AgentEnvironment,
) {
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

function cloneMessages(messages: readonly Message[]): Message[] {
  return structuredClone(messages) as Message[];
}

function branchSummaryText(summary: unknown): string {
  if (typeof summary === "string") return summary.trim();
  if (summary && typeof summary === "object" && "parts" in summary) {
    const parts = (summary as { parts?: unknown }).parts;
    if (Array.isArray(parts)) {
      const text = parts
        .filter((part): part is { type: "text"; text: string } => Boolean(part)
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

function toolFailureCode(result: ToolExecutionResult): string {
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
