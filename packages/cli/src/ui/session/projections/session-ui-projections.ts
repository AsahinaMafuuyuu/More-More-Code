import type {
  AgentRun,
  AgentRunStatus,
  ApprovalRequest,
  RuntimeSessionRecoveryReport,
} from "@more-more-code/harness";
import type { ModelRef, ModeType } from "@more-more-code/shared";
import type { Message } from "../../../lib/chat-types";
import type { ToolUseView } from "../../../lib/tool-use-projection";
import {
  formatStatusBarObservability,
  type SessionObservability,
} from "../../../lib/session-observability";
import { formatRuntimeRecoveryNotice } from "../../../lib/runtime-recovery";
import type {
  ActiveRuntimeView,
  ApprovalUiView,
  ComposerRuntimeView,
  ConversationView,
  InteractionQueueView,
  RecoveryUiView,
  SessionStatusView,
} from "../store/session-ui-store";
import type { AgentInteraction } from "@more-more-code/harness";
import { isToolUIPart } from "../../../lib/chat-types";

export type ChatPresentationStatus = "submitted" | "streaming" | "ready" | "error";

export function projectConversationView(input: {
  messages: readonly Message[];
  hiddenMessageCount?: number;
  toolUses: Readonly<Record<string, ToolUseView>>;
  run?: AgentRun | null;
  error?: Error | null;
  runError?: string | null;
}): ConversationView {
  const initialTurn = input.run?.turns.find((turn) => turn.cause === "initial")
    ?? input.run?.turns[0];
  return {
    messages: input.messages,
    hiddenMessageCount: input.hiddenMessageCount ?? 0,
    toolUses: input.toolUses,
    currentRun: input.run
      ? {
          ...(initialTurn?.inputMessageId ? { inputMessageId: initialTurn.inputMessageId } : {}),
          status: input.run.status,
          ...(input.run.endedAt !== undefined
            ? { durationMs: Math.max(0, input.run.endedAt - input.run.startedAt) }
            : {}),
        }
      : null,
    errorMessage: input.error?.message ?? null,
    runErrorMessage: input.error ? null : input.runError ?? null,
  };
}

export function projectComposerRuntimeView(input: {
  busy: boolean;
  runStatus: AgentRunStatus | null;
  chatStatus: ChatPresentationStatus;
}): ComposerRuntimeView {
  const runActive = input.runStatus === "running";
  const transportActive = input.chatStatus === "submitted" || input.chatStatus === "streaming";
  const settling = input.busy && !runActive;
  return {
    disabled: settling,
    runActive,
    canInterrupt: runActive || transportActive,
    followUpAvailable: runActive,
  };
}

export function projectInteractionQueueView(input: {
  pending: readonly AgentInteraction[];
  outcomes: readonly Readonly<{
    interaction: AgentInteraction;
    reason: "run-interrupted" | "run-failed";
  }>[];
}): InteractionQueueView {
  return {
    pending: input.pending.map((interaction) => ({
      id: interaction.id,
      kind: interaction.kind,
      text: interaction.text,
      createdAt: interaction.createdAt,
    })),
    outcomes: input.outcomes.map(({ interaction, reason }) => ({
      id: interaction.id,
      kind: interaction.kind,
      text: interaction.text,
      reason,
    })),
  };
}

const ACTIVE_TOOL_STATUSES = new Set(["requested", "running", "approval_waiting"]);
const COMPLETED_TOOL_STATUSES = new Set(["completed"]);

function formatTokenCount(tokens: number) {
  if (tokens < 1_000) return String(Math.round(tokens));
  return `${(tokens / 1_000).toFixed(1)}k`;
}

export function formatActiveRuntimeLabel(runtime: ActiveRuntimeView) {
  if (runtime.phase === "compaction" && runtime.compaction) {
    const activity = runtime.compaction;
    if (activity.phase === "compaction-starting") return "Context compaction starting…";
    if (activity.phase === "compaction-reducing") return "Summarizing older context…";
    if (activity.phase === "compaction-validating") return "Validating checkpoint…";
    if (activity.phase === "compaction-fallback") return "Using deterministic checkpoint fallback…";
    if (activity.phase === "compaction-applying") return "Applying checkpoint…";
    if (activity.phase === "compaction-rebased") {
      return activity.inputTokensBefore !== undefined && activity.inputTokensAfter !== undefined
        ? `Context compacted · ${formatTokenCount(activity.inputTokensBefore)} → ${formatTokenCount(activity.inputTokensAfter)}`
        : "Context compacted";
    }
    if (activity.phase === "compaction-aborted") return "Context compaction aborted";
    return "Context compaction failed";
  }
  if (runtime.phase === "tools" && runtime.tools) {
    const failed = runtime.tools.failed > 0 ? ` · ${runtime.tools.failed} failed` : "";
    return `Tools · ${runtime.tools.active} active · ${runtime.tools.completed}/${runtime.tools.total} done${failed}`;
  }
  if (runtime.phase === "responding") return "Responding";
  if (runtime.phase === "settling") return "Settling";
  if (runtime.phase === "thinking") return "Thinking";
  return "Idle";
}

export function projectActiveRuntimeView(input: {
  busy: boolean;
  run?: AgentRun | null;
  chatStatus: ChatPresentationStatus;
  messages: readonly Message[];
  toolUses: Readonly<Record<string, ToolUseView>>;
  contextCompactionActivity?: Readonly<{
    operationId: string;
    compactionPlanId: string;
    phase:
      | "compaction-starting"
      | "compaction-reducing"
      | "compaction-validating"
      | "compaction-fallback"
      | "compaction-applying"
      | "compaction-rebased"
      | "compaction-aborted"
      | "compaction-failed";
    startedAt: number;
    inputTokensBefore?: number;
    inputTokensAfter?: number;
  }> | null;
}): ActiveRuntimeView {
  const compaction = input.contextCompactionActivity ?? null;
  const terminalCompaction = compaction?.phase === "compaction-rebased"
    || compaction?.phase === "compaction-aborted"
    || compaction?.phase === "compaction-failed";
  if (compaction && (!terminalCompaction || (input.busy && input.chatStatus !== "streaming"))) {
    return {
      phase: "compaction",
      runId: input.run?.id ?? null,
      startedAt: compaction.startedAt,
      tools: null,
      compaction: {
        planId: compaction.compactionPlanId,
        phase: compaction.phase,
        ...(compaction.inputTokensBefore !== undefined
          ? { inputTokensBefore: compaction.inputTokensBefore }
          : {}),
        ...(compaction.inputTokensAfter !== undefined
          ? { inputTokensAfter: compaction.inputTokensAfter }
          : {}),
      },
    };
  }

  const runActive = input.run?.status === "running";
  if (!runActive) {
    return {
      phase: input.busy ? "settling" : "idle",
      runId: input.run?.id ?? null,
      startedAt: input.run?.startedAt ?? null,
      tools: null,
      compaction: null,
    };
  }

  const latestAssistant = input.messages.findLast((message) => message.role === "assistant");
  const toolParts = latestAssistant?.parts.filter(isToolUIPart) ?? [];
  const toolViews = toolParts
    .map((part) => input.toolUses[part.toolCallId])
    .filter((view): view is ToolUseView => Boolean(view));
  const tools = toolParts.length > 0
    ? {
        total: toolParts.length,
        active: toolViews.filter((view) => ACTIVE_TOOL_STATUSES.has(view.status)).length,
        completed: toolViews.filter((view) => COMPLETED_TOOL_STATUSES.has(view.status)).length,
        failed: toolViews.filter((view) => (
          !ACTIVE_TOOL_STATUSES.has(view.status)
          && !COMPLETED_TOOL_STATUSES.has(view.status)
        )).length,
      }
    : null;

  if (tools && tools.active > 0) {
    return {
      phase: "tools",
      runId: input.run!.id,
      startedAt: input.run!.startedAt,
      tools,
      compaction: null,
    };
  }

  const streamingText = latestAssistant?.parts.some(
    (part) => part.type === "text" && part.state === "streaming" && part.text.length > 0,
  ) ?? false;
  const phase = input.chatStatus === "streaming" && streamingText
    ? "responding"
    : "thinking";
  return {
    phase,
    runId: input.run!.id,
    startedAt: input.run!.startedAt,
    tools,
    compaction: null,
  };
}

export function projectSessionStatusView(input: {
  mode: ModeType;
  model: ModelRef;
  observability: SessionObservability;
}): SessionStatusView {
  const metrics = formatStatusBarObservability(input.observability);
  return {
    mode: input.mode,
    modelLabel: `${input.model.providerId}/${input.model.modelId}`,
    contextLabel: metrics.context,
    contextUtilizationRatio: metrics.contextUtilizationRatio,
    costLabel: metrics.cost,
    cacheLabel: metrics.cache,
  };
}

export function projectApprovalUiView(
  request: ApprovalRequest | null | undefined,
): ApprovalUiView | null {
  return request ?? null;
}

export function projectRecoveryUiView(
  report: RuntimeSessionRecoveryReport | null | undefined,
): RecoveryUiView | null {
  if (!report) return null;
  const message = formatRuntimeRecoveryNotice(report);
  if (!message) return null;
  return {
    key: `${report.sessionId}:${report.recoveredEventOffset}`,
    message,
  };
}
