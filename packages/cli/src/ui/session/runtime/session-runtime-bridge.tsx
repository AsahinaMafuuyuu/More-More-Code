import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Message } from "../../../lib/chat-types";
import { LocalChatRuntime } from "../../../lib/local-chat-runtime";
import { createSessionObservability } from "../../../lib/session-observability";
import { projectAgentActivity } from "../../../lib/agent-activity-projection";
import {
  createCanonicalToolUseIndex,
  projectToolUsesFromIndex,
} from "../../../lib/tool-use-projection";
import { projectTranscriptWindow } from "../../../lib/transcript-window";
import { usePromptConfig } from "../../../providers/prompt-config";
import type { SessionController } from "../../../app/session/session-controller";
import type { SessionUiStore } from "../store/session-ui-store";
import { resolveTuiRenderProfileFromEnvironment } from "../../../tui/render-profile";
import { createSessionUiCommitScheduler } from "./session-ui-commit-scheduler";
import {
  projectApprovalUiView,
  projectActiveRuntimeView,
  projectComposerRuntimeView,
  projectConversationView,
  projectInteractionQueueView,
  projectRecoveryUiView,
  projectSessionStatusView,
  type ChatPresentationStatus,
} from "../projections/session-ui-projections";

export function SessionRuntimeBridge({
  controller,
  store,
}: {
  controller: SessionController;
  store: SessionUiStore;
}) {
  const { mode, model } = usePromptConfig();
  const commitScheduler = useMemo(() => createSessionUiCommitScheduler({
    store,
    commitHz: resolveTuiRenderProfileFromEnvironment().projectionCommitHz,
  }), [store]);
  const controllerState = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const chat = useMemo(() => new LocalChatRuntime({
    id: controller.sessionId,
    messages: controller.getInitialMessages(),
    transport: controller.transport,
    onFinish(input) {
      controller.completeModelStep(input);
    },
    onError(error) {
      controller.failModelStep(error);
    },
  }), [controller]);
  const chatSnapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot);

  controller.bindChatBridge({
    setMessages(messages) {
      chat.setMessages(messages);
    },
    sendMessage() {
      return chat.sendMessage();
    },
    addToolOutput(input) {
      return chat.addToolOutput(input as Parameters<typeof chat.addToolOutput>[0]);
    },
    stop() {
      chat.stop();
    },
  });

  useEffect(() => {
    void controller.attach().catch(() => {
      // Attach failures are represented by the controller error projection.
    });
    return () => {
      commitScheduler.dispose();
      chat.dispose();
      void controller.dispose();
      store.destroy();
    };
  }, [chat, commitScheduler, controller, store]);

  const observability = useMemo(() => createSessionObservability({
    context: controllerState.contextUsage,
    usage: controllerState.sessionUsage,
    usagePersistenceIncomplete: controllerState.usagePersistenceIncomplete,
    latestProviderCacheHitRate: controllerState.latestProviderCacheHitRate,
  }), [
    controllerState.contextUsage,
    controllerState.sessionUsage,
    controllerState.usagePersistenceIncomplete,
    controllerState.latestProviderCacheHitRate,
  ]);

  const activity = useMemo(() => projectAgentActivity(controllerState.run, {
    progressByStep: controllerState.activityProgressByStep,
  }), [controllerState.run, controllerState.activityProgressByStep]);

  const transcriptWindow = useMemo(() => projectTranscriptWindow({
    count: chatSnapshot.messageCount,
    getMessage: (index) => chat.getMessageAt(index),
  }), [chat, chatSnapshot.messageCount, chatSnapshot.messageRevision]);

  const canonicalToolUses = useMemo(
    () => createCanonicalToolUseIndex(controllerState.sessionTree),
    [controllerState.sessionTree],
  );

  const toolUses = useMemo(() => projectToolUsesFromIndex({
    messages: transcriptWindow.messages,
    canonical: canonicalToolUses,
    activity,
    pendingApprovals: controllerState.pendingApprovals,
  }), [activity, canonicalToolUses, controllerState.pendingApprovals, transcriptWindow.messages]);

  const conversation = useMemo(() => projectConversationView({
    messages: transcriptWindow.messages,
    hiddenMessageCount: transcriptWindow.hiddenMessageCount,
    toolUses,
    run: controllerState.run,
    error: controllerState.runtimeError ?? chatSnapshot.error,
    runError: controllerState.run?.status === "failed"
      ? controllerState.run.error ?? null
      : null,
  }), [chatSnapshot.error, controllerState.run, controllerState.runtimeError, toolUses, transcriptWindow]);

  const status = useMemo(() => projectSessionStatusView({
    mode,
    model,
    observability,
  }), [mode, model, observability]);

  const composerRuntime = useMemo(() => projectComposerRuntimeView({
    busy: controllerState.busy,
    runStatus: controllerState.run?.status ?? null,
    chatStatus: chatSnapshot.status as ChatPresentationStatus,
  }), [chatSnapshot.status, controllerState.busy, controllerState.run?.status]);

  const interactionQueue = useMemo(() => projectInteractionQueueView({
    pending: controllerState.pendingInteractions,
    outcomes: controllerState.pendingInteractionOutcomes,
  }), [controllerState.pendingInteractionOutcomes, controllerState.pendingInteractions]);

  const activeRuntime = useMemo(() => projectActiveRuntimeView({
    busy: controllerState.busy,
    run: controllerState.run,
    chatStatus: chatSnapshot.status as ChatPresentationStatus,
    messages: transcriptWindow.messages,
    toolUses,
    contextCompactionActivity: controllerState.contextCompactionActivity,
  }), [
    chatSnapshot.status,
    controllerState.busy,
    controllerState.contextCompactionActivity,
    controllerState.run,
    toolUses,
    transcriptWindow.messages,
  ]);

  const approval = useMemo(
    () => projectApprovalUiView(controllerState.pendingApprovals[0]),
    [controllerState.pendingApprovals],
  );
  const recovery = useMemo(
    () => projectRecoveryUiView(controllerState.runtimeRecovery),
    [controllerState.runtimeRecovery],
  );

  useEffect(() => {
    commitScheduler.enqueuePresentation({
      conversation,
      activity,
      status,
    });
  }, [activity, commitScheduler, conversation, status]);

  useEffect(() => {
    commitScheduler.commitImmediate({
      composerRuntime,
      interactionQueue,
      activeRuntime,
      approval,
      recovery,
    });
  }, [activeRuntime, approval, commitScheduler, composerRuntime, interactionQueue, recovery]);

  return null;
}
