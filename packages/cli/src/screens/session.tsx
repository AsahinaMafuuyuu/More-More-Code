// 主要用于已经创建的会话，显示会话的消息列表，并提供输入框用于发送新消息
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { SessionShell } from "../components/session-shell";
import { useKeyboard } from "@opentui/react";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { useDialog } from "../providers/dialog";
import { ApprovalDialogContent } from "../components/dialogs";
import { getLocalSessionAuthority } from "../lib/session-environment";
import {
  type ModelRef,
  type ModeType,
} from "@more-more-code/shared";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../hooks/use-chat";
import type { SessionTreeCommandApi } from "../components/command-menu/types";
import {
  type SessionRuntimeState,
} from "@more-more-code/harness";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { formatRuntimeRecoveryNotice } from "../lib/runtime-recovery";
import { normalizeModelRef } from "../lib/models";
import type { LocalSessionSnapshot } from "@more-more-code/session-store";
import { projectDurableSessionMessages } from "../lib/durable-session-message";
import { projectSessionNavigationTree } from "../lib/session-navigation-projection";

type SessionData = LocalSessionSnapshot<Message>;

const sessionLocationSchema = z.object({
  snapshot: z.custom<SessionData>((val) => {
    return val !== null
      && typeof val === "object"
      && "session" in val
      && "state" in val;
  }),
  initialPrompt: z.object({
    message: z.string(),
    mode: z.custom<ModeType>(),
    model: z.object({
      providerId: z.string().min(1),
      modelId: z.string().min(1),
    }).strict(),
  })
})



function getMessageText(msg: Message) {
  return msg.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function ChatMessage({
  msg,
  toolUses,
}: {
  msg: Message;
  toolUses: Readonly<Record<string, import("../lib/tool-use-projection").ToolUseView>>;
}) {
  if (msg.role === "user") { // 如果是用户消息
    return <UserMessage message={getMessageText(msg)} mode={msg.metadata?.mode ?? "BUILD"} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={typeof msg.metadata?.model === "string"
        ? msg.metadata.model
        : msg.metadata?.model
          ? `${msg.metadata.model.providerId}/${msg.metadata.model.modelId}`
          : "unknown"}
      mode={msg.metadata?.mode ?? "BUILD"}
      durationMs={msg.metadata?.durationMs}
      streaming={false}
      toolUses={toolUses}
    />
  );
}

function SessionChat({
  session,
  initialPrompt
}: {
  session: SessionData,
  initialPrompt?: {
    message: string;
    mode: ModeType;
    model: ModelRef;
  }
}) {
  const { mode, model, setMode, setModel } = usePromptConfig(); // 获取当前的模式和模型
  const { isTopLayer } = useKeyboardLayer(); // 获取键盘层状态
  const toast = useToast();
  const { open: openDialog, close: closeDialog } = useDialog();
  const {
    messages,
    status,
    submit,
    steer,
    followUp,
    interrupt,
    error,
    run,
    activity,
    toolUses,
    busy,
    runtimeRecovery,
    observability,
    pendingApproval,
    resolveApproval,
    cancelApproval,
    sessionTree,
    inspectNavigation,
    navigateToNode,
    recordPromptSelection,
    compact,
  } = useChat(session.session.id, session.state); // 使用自定义hook管理本地会话树
  const runActive = run?.status === "running";
  const settling = busy && !runActive;
  const reportedRecoveryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runtimeRecovery) return;
    const recoveryKey = `${runtimeRecovery.sessionId}:${runtimeRecovery.recoveredEventOffset}`;
    if (reportedRecoveryKeyRef.current === recoveryKey) return;

    const message = formatRuntimeRecoveryNotice(runtimeRecovery);
    if (!message) return;

    reportedRecoveryKeyRef.current = recoveryKey;
    toast.show({
      variant: "info",
      duration: 8000,
      message,
    });
  }, [runtimeRecovery, toast]);

  useEffect(() => {
    if (!pendingApproval) return;

    const approvalId = pendingApproval.approvalId;
    openDialog({
      title: "Tool approval required",
      children: (
        <ApprovalDialogContent
          request={pendingApproval}
          onResolve={(decision) => {
            resolveApproval(approvalId, decision);
          }}
          onCancel={() => {
            cancelApproval(approvalId);
          }}
        />
      ),
    });

    return () => {
      closeDialog();
    };
  }, [pendingApproval, resolveApproval, cancelApproval, openDialog, closeDialog]);

  const restorePromptRuntime = useCallback((runtime: SessionRuntimeState) => {
    if (runtime.mode === "BUILD" || runtime.mode === "PLAN") {
      setMode(runtime.mode);
    }
    if (runtime.model) {
      try {
        setModel(normalizeModelRef(runtime.model, runtime.provider));
      } catch {
        // Legacy unknown model IDs cannot be restored without provider metadata.
      }
    }
  }, [setMode, setModel]);

  const sessionTreeCommands = useMemo<SessionTreeCommandApi>(() => {
    const navigation = projectSessionNavigationTree(sessionTree);

    return {
      rootEntryId: sessionTree.rootEntryId,
      activeEntryId: sessionTree.activeEntryId,
      parentEntryId: sessionTree.entries.find((entry) => entry.id === sessionTree.activeEntryId)?.parentId ?? null,
      entries: navigation.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        type: node.type,
        depth: node.depth,
        createdAt: node.createdAt,
        messageCount: projectDurableSessionMessages(
          sessionTree,
          node.navigationTargetEntryId,
        ).length,
        preview: node.preview,
        navigationTargetEntryId: node.navigationTargetEntryId,
        selectable: node.selectable,
        active: node.active,
      })),
      inspectJump: (entryId) => {
        const intent = inspectNavigation(entryId);
        return {
          action: intent.action,
          policy: intent.policy,
          sourceTipEntryId: intent.analysis.sourceTipEntryId,
          targetEntryId: intent.analysis.targetEntryId,
          commonAncestorEntryId: intent.analysis.commonAncestorEntryId,
          coveredEntryIds: [...intent.analysis.coveredEntryIds],
        };
      },
      jump: async (entryId, decision) => {
        const result = await navigateToNode({
          entryId,
          selection: { mode, model },
          ...(decision ? { decision } : {}),
        });
        if ("runtime" in result) restorePromptRuntime(result.runtime);
        return {
          status: result.status,
          ...((result.status === "carried" || result.status === "carry-failed")
            ? {
                fallbackUsed: result.reduction.fallbackUsed,
                ...(result.reduction.fallbackReason
                  ? { fallbackReason: result.reduction.fallbackReason }
                  : {}),
              }
            : {}),
        };
      },
    };
  }, [
    sessionTree,
    inspectNavigation,
    navigateToNode,
    restorePromptRuntime,
    mode,
    model,
  ]);

  const hasSubmittedInitialPromptRef = useRef(false); // 用于标记是否已经提交了初始提示

  useKeyboard((key) => {
    if (
      key.name === "escape" &&
      isTopLayer("base") &&
      (runActive || status === "streaming" || status === "submitted")
    ) {
      key.preventDefault();
      interrupt();
    }
  })

  useEffect(() => {
    if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;

    hasSubmittedInitialPromptRef.current = true;

    void submit({
        userText: initialPrompt.message,
        mode: initialPrompt.mode,
        model: initialPrompt.model,
    }).catch((error) => {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
}, [initialPrompt, submit, toast]);

  return (
    <SessionShell
      onSubmit={(text) => {
        if (runActive) {
          void steer({ userText: text, mode, model }).catch((error) => {
            toast.show({
              variant: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
          return;
        }

        void submit({
          userText: text,
          mode,
          model,
        }).catch((error) => {
          toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }}
      onFollowUp={(text) => {
        if (runActive) {
          void followUp({ userText: text, mode, model }).catch((error) => {
            toast.show({
              variant: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
          return;
        }

        void submit({
          userText: text,
          mode,
          model,
        }).catch((error) => {
          toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }}
      inputDisabled={settling}
      loading={busy || status === "submitted" || status === "streaming"}
      activity={activity}
      observability={observability}
      interruptible={runActive || status === "streaming" || status === "submitted"}
      sessionTree={sessionTreeCommands}
      onModeChange={(nextMode) => {
        return recordPromptSelection({ mode: nextMode, model });
      }}
      onModelChange={(nextModel) => {
        return recordPromptSelection({ mode, model: nextModel });
      }}
      onCompact={() => compact({ mode, model })}
    >
      {/* 渲染消息 */}
      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} toolUses={toolUses} />
      ))}

      {/*  */}
      {error && <ErrorMessage message={error.message} />}
      {!error && run?.status === "failed" && run.error && (
        <ErrorMessage message={run.error} />
      )}
    </SessionShell>
  )
}
export function Session() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  // 预取session数据，如果location.state中有session数据，则使用它，否则为null
  const prefetched = useMemo(() => {
    const parsed = sessionLocationSchema.safeParse(location.state); // 验证location.state是否符合sessionLocationSchema的结构
    return parsed.success ? parsed.data : null; // 如果验证成功，返回session数据，否则返回null
  }, [location.state])

  const [session, setSession] = useState<SessionData | null>(prefetched?.snapshot ?? null); // 创建session状态
  useEffect(() => {
    if (prefetched?.snapshot) return;
    setSession(null); // 如果没有预取数据，设置session为null
    if (!id) return; // 如果没有id，返回
    let ignore = false;
    const fetchSession = async () => {
      try {
        const resolvedSession = await getLocalSessionAuthority().open(id);
        if (ignore) return;
        if (!resolvedSession) throw new Error(`Local session ${id} was not found`);
        setSession(resolvedSession); // 如果响应ok，则设置session为响应数据
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message: error instanceof Error
            ? `Unable to open local session: ${error.message}`
            : "Unable to open local session",
        });

        navigate("/", { replace: true }); // 如果获取会话失败，导航回主页
      }
    }

    fetchSession(); // 获取会话数据
    return () => { ignore = true };
  }, [id, navigate, toast, prefetched]);

  if (!session) {
    return (
      <SessionShell
        onSubmit={() => { }}
        inputDisabled
      />
    );
  }

  return (
    <SessionChat
      key={session.session.id}
      session={session}
      initialPrompt={prefetched?.initialPrompt}
    />
  );
}
