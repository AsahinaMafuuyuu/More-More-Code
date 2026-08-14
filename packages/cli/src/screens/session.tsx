// 主要用于已经创建的会话，显示会话的消息列表，并提供输入框用于发送新消息
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import type { InferResponseType } from "hono/client";
import { SessionShell } from "../components/session-shell";
import { useKeyboard } from "@opentui/react";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import {
  findSupportedChatModel,
  type ModeType,
  type SupportedChatModelId,
} from "@more-more-code/shared";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../hooks/use-chat";
import type { SessionTreeCommandApi } from "../components/command-menu/types";
import {
  projectSessionTreeMessages,
  type SessionEntry,
  type SessionRuntimeState,
} from "@more-more-code/harness";
import { useKeyboardLayer } from "../providers/keyboard-layer";

type SessionData = InferResponseType<(typeof apiClient.sessions)[":id"]["$get"], 200>; // 获取SessionData的类型

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>((val) => {
    return val !== null && typeof val === "object" && "id" in val; //  验证session对象是否包含id属性
  }),
  initialPrompt: z.object({
    message: z.string(),
    mode: z.custom<ModeType>(),
    model: z.custom<SupportedChatModelId>(),
  })
})



function getMessageText(msg: Message) {
  return msg.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getSessionEntryPreview(entry: SessionEntry<Message>) {
  switch (entry.type) {
    case "session_start":
      return "Session start";
    case "user_message":
    case "assistant_message":
    case "custom_message":
    case "message_update":
      return getMessageText(entry.message).trim() || entry.messageId;
    case "tool_call":
      return `${entry.toolName}(${entry.toolCallId.slice(0, 8)})`;
    case "tool_result":
      return `${entry.toolName ?? "tool"} result ${entry.toolCallId.slice(0, 8)}`;
    case "error":
      return entry.message;
    case "model_change":
      return `Model → ${entry.model}`;
    case "mode_change":
      return `Mode → ${entry.mode}`;
    case "config_change":
      return `Config changed: ${entry.key}`;
    case "compaction":
      return "Context compaction";
    case "branch_summary":
      return "Branch summary";
    case "custom":
      return entry.customType;
  }
}

function ChatMessage({ msg }: { msg: Message }) {
  if (msg.role === "user") { // 如果是用户消息
    return <UserMessage message={getMessageText(msg)} mode={msg.metadata?.mode ?? "BUILD"} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      mode={msg.metadata?.mode ?? "BUILD"}
      durationMs={msg.metadata?.durationMs}
      streaming={false}
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
    model: SupportedChatModelId;
  }
}) {
  const { mode, model, setMode, setModel } = usePromptConfig(); // 获取当前的模式和模型
  const { isTopLayer } = useKeyboardLayer(); // 获取键盘层状态
  const {
    messages,
    status,
    submit,
    steer,
    followUp,
    abort,
    interrupt,
    error,
    run,
    busy,
    sessionTree,
    jumpToNode,
    jumpToParent,
    jumpToRoot,
    recordPromptSelection,
    compact,
  } = useChat(session.id, session.messages); // 使用自定义hook管理消息状态与会话树
  const runActive = run?.status === "running";
  const settling = busy && !runActive;

  const restorePromptRuntime = useCallback((runtime: SessionRuntimeState) => {
    if (runtime.mode === "BUILD" || runtime.mode === "PLAN") {
      setMode(runtime.mode);
    }
    if (runtime.model && findSupportedChatModel(runtime.model)) {
      setModel(runtime.model as SupportedChatModelId);
    }
  }, [setMode, setModel]);

  const sessionTreeCommands = useMemo<SessionTreeCommandApi>(() => {
    const childrenByParent = new Map<string | null, typeof sessionTree.entries>();
    for (const entry of sessionTree.entries) {
      const children = childrenByParent.get(entry.parentId) ?? [];
      children.push(entry);
      childrenByParent.set(entry.parentId, children);
    }

    const ordered: Array<{ entry: (typeof sessionTree.entries)[number]; depth: number }> = [];
    const visit = (entryId: string, depth: number) => {
      const entry = sessionTree.entries.find((candidate) => candidate.id === entryId);
      if (!entry) return;
      ordered.push({ entry, depth });
      for (const child of childrenByParent.get(entry.id) ?? []) {
        visit(child.id, depth + 1);
      }
    };
    visit(sessionTree.rootEntryId, 0);

    return {
      rootEntryId: sessionTree.rootEntryId,
      activeEntryId: sessionTree.activeEntryId,
      entries: ordered.map(({ entry, depth }) => ({
        id: entry.id,
        parentId: entry.parentId,
        type: entry.type,
        depth,
        createdAt: entry.createdAt,
        messageCount: projectSessionTreeMessages(sessionTree, entry.id).length,
        preview: getSessionEntryPreview(entry),
        active: entry.id === sessionTree.activeEntryId,
      })),
      jump: (entryId) => {
        restorePromptRuntime(jumpToNode(entryId));
      },
      jumpParent: () => {
        const runtime = jumpToParent();
        if (!runtime) return false;
        restorePromptRuntime(runtime);
        return true;
      },
      jumpRoot: () => {
        restorePromptRuntime(jumpToRoot());
      },
    };
  }, [
    sessionTree,
    jumpToNode,
    jumpToParent,
    jumpToRoot,
    restorePromptRuntime,
  ]);

  const hasSubmittedInitialPromptRef = useRef(false); // 用于标记是否已经提交了初始提示

  useEffect(() => {
    return () => { // 组件卸载时取消订阅
      void abort();
    }
  }, [abort]);

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
    });
}, [initialPrompt, submit]);

  return (
    <SessionShell
      onSubmit={(text) => {
        if (runActive) {
          steer({ userText: text, mode, model });
          return;
        }

        void submit({
          userText: text,
          mode,
          model,
        })
      }}
      onFollowUp={(text) => {
        if (runActive) {
          followUp({ userText: text, mode, model });
          return;
        }

        void submit({
          userText: text,
          mode,
          model,
        })
      }}
      inputDisabled={settling}
      loading={busy || status === "submitted" || status === "streaming"}
      interruptible={runActive || status === "streaming" || status === "submitted"}
      sessionTree={sessionTreeCommands}
      onModeChange={(nextMode) => {
        recordPromptSelection({ mode: nextMode, model });
      }}
      onModelChange={(nextModel) => {
        recordPromptSelection({ mode, model: nextModel });
      }}
      onCompact={() => compact({ mode, model })}
    >
      {/* 渲染消息 */}
      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} />
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

  const [session, setSession] = useState<SessionData | null>(prefetched?.session ?? null); // 创建session状态
  useEffect(() => {
    if (prefetched?.session) return;
    setSession(null); // 如果没有预取数据，设置session为null
    if (!id) return; // 如果没有id，返回
    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[':id'].$get({
          param: { id },
        });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolvedSession = await res.json()
        setSession(resolvedSession); // 如果响应ok，则设置session为响应数据
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Failed to fetch session",
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
      key={session.id}
      session={session}
      initialPrompt={prefetched?.initialPrompt}
    />
  );
}