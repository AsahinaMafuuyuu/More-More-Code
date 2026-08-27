import type {
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
  ApprovalUiView,
  ComposerRuntimeView,
  ConversationView,
  RecoveryUiView,
  SessionStatusView,
} from "../store/session-ui-store";

export type ChatPresentationStatus = "submitted" | "streaming" | "ready" | "error";

export function projectConversationView(input: {
  messages: readonly Message[];
  toolUses: Readonly<Record<string, ToolUseView>>;
  error?: Error | null;
  runError?: string | null;
}): ConversationView {
  return {
    messages: input.messages,
    toolUses: input.toolUses,
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
    submitMode: runActive ? "steer" : "submit",
    followUpAvailable: runActive,
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
