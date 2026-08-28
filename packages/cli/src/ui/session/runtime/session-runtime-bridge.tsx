import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import type { Message } from "../../../lib/chat-types";
import { createSessionObservability } from "../../../lib/session-observability";
import { projectAgentActivity } from "../../../lib/agent-activity-projection";
import { projectToolUses } from "../../../lib/tool-use-projection";
import { usePromptConfig } from "../../../providers/prompt-config";
import type { SessionController } from "../../../app/session/session-controller";
import type { SessionUiStore } from "../store/session-ui-store";
import { resolveTuiRenderProfile } from "../../../tui/render-profile";
import { createSessionUiCommitScheduler } from "./session-ui-commit-scheduler";
import {
  projectApprovalUiView,
  projectComposerRuntimeView,
  projectConversationView,
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
    commitHz: resolveTuiRenderProfile("normal").projectionCommitHz,
  }), [store]);
  const controllerState = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const chat = useAiChat<Message>({
    id: controller.sessionId,
    messages: controller.getInitialMessages(),
    transport: controller.transport,
    onFinish({ message, isAbort, isDisconnect, isError }) {
      controller.completeModelStep({ message, isAbort, isDisconnect, isError });
    },
    onError(error) {
      controller.failModelStep(error);
    },
  });

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
      void controller.dispose();
      store.destroy();
    };
  }, [commitScheduler, controller, store]);

  const observability = useMemo(() => createSessionObservability({
    context: controllerState.contextUsage,
    usage: controllerState.sessionUsage,
    usagePersistenceIncomplete: controllerState.usagePersistenceIncomplete,
  }), [
    controllerState.contextUsage,
    controllerState.sessionUsage,
    controllerState.usagePersistenceIncomplete,
  ]);

  const activity = useMemo(() => projectAgentActivity(controllerState.run, {
    progressByStep: controllerState.activityProgressByStep,
  }), [controllerState.run, controllerState.activityProgressByStep]);

  const toolUses = useMemo(() => projectToolUses({
    messages: chat.messages,
    sessionTree: controllerState.sessionTree,
    activity,
    pendingApprovals: controllerState.pendingApprovals,
  }), [activity, chat.messages, controllerState.pendingApprovals, controllerState.sessionTree]);

  const conversation = useMemo(() => projectConversationView({
    messages: chat.messages,
    toolUses,
    error: controllerState.runtimeError ?? chat.error,
    runError: controllerState.run?.status === "failed"
      ? controllerState.run.error ?? null
      : null,
  }), [chat.error, chat.messages, controllerState.run, controllerState.runtimeError, toolUses]);

  const status = useMemo(() => projectSessionStatusView({
    mode,
    model,
    observability,
  }), [mode, model, observability]);

  const composerRuntime = useMemo(() => projectComposerRuntimeView({
    busy: controllerState.busy,
    runStatus: controllerState.run?.status ?? null,
    chatStatus: chat.status as ChatPresentationStatus,
  }), [chat.status, controllerState.busy, controllerState.run?.status]);

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
      approval,
      recovery,
    });
  }, [approval, commitScheduler, composerRuntime, recovery]);

  return null;
}
