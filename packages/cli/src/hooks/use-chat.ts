import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import { createSessionObservability } from "../lib/session-observability";
import { projectAgentActivity } from "../lib/agent-activity-projection";
import { projectToolUses } from "../lib/tool-use-projection";
import type { ChatTools, Message } from "../lib/chat-types";
import { SessionController } from "../app/session/session-controller";

export type { Message } from "../lib/chat-types";

/**
 * React/AI-SDK bridge for one SessionController.
 *
 * Application coordination belongs to SessionController; this hook only binds
 * the AI SDK React transport and adapts controller snapshots for the existing
 * UI during the staged architecture migration.
 */
export function useChat(sessionId: string, persistedSessionState: unknown) {
    const controller = useMemo(() => new SessionController({
        sessionId,
        persistedSessionState,
    }), [sessionId, persistedSessionState]);

    const chat = useAiChat<Message>({
        id: sessionId,
        messages: controller.getInitialMessages(),
        transport: controller.transport,
        onFinish({ message, isAbort, isDisconnect, isError }) {
            controller.completeModelStep({
                message,
                isAbort,
                isDisconnect,
                isError,
            });
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
            // Runtime attach failure is already published through the
            // controller snapshot and rendered by the Session surface.
        });
        return () => {
            void controller.dispose();
        };
    }, [controller]);

    const state = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
    );

    const observability = useMemo(() => createSessionObservability({
        context: state.contextUsage,
        usage: state.sessionUsage,
        usagePersistenceIncomplete: state.usagePersistenceIncomplete,
    }), [state.contextUsage, state.sessionUsage, state.usagePersistenceIncomplete]);

    const activity = useMemo(() => projectAgentActivity(state.run, {
        progressByStep: state.activityProgressByStep,
    }), [state.run, state.activityProgressByStep]);

    const toolUses = useMemo(() => projectToolUses({
        messages: chat.messages,
        sessionTree: state.sessionTree,
        activity,
        pendingApprovals: state.pendingApprovals,
    }), [activity, chat.messages, state.pendingApprovals, state.sessionTree]);

    return {
        messages: chat.messages,
        status: chat.status,
        error: state.runtimeError ?? chat.error,
        run: state.run,
        activity,
        toolUses,
        busy: state.busy,
        runtimeRecovery: state.runtimeRecovery,
        observability,
        pendingApproval: state.pendingApprovals[0] ?? null,
        resolveApproval: controller.resolveApproval,
        cancelApproval: controller.cancelApproval,
        sessionTree: state.sessionTree,
        inspectNavigation: controller.inspectNavigation,
        navigateToEntry: controller.navigateToEntry,
        navigateToNode: controller.navigateToEntry,
        navigateToParent: controller.navigateToParent,
        navigateToRoot: controller.navigateToRoot,
        recordPromptSelection: controller.recordPromptSelection,
        recordConfigChange: controller.recordConfigChange,
        recordCustomEntry: controller.recordCustomEntry,
        compact: controller.compact,
        submit: controller.submit,
        steer: controller.steer,
        followUp: controller.followUp,
        abort: controller.interrupt,
        interrupt: controller.interrupt,
        waitForIdle: controller.waitForIdle,
        getEntry: controller.getEntry,
        getNode: controller.getNode,
        controller,
    };
}

export type SessionChatBridgeToolInput = Parameters<
    ReturnType<typeof useAiChat<Message>>["addToolOutput"]
>[0] & { tool: keyof ChatTools };
