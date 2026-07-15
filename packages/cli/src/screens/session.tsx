import { useState, useEffect, useMemo } from "react";
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
import prettyMs from "pretty-ms";
import { DEFAULT_CHAT_MODEL_ID, type SupportedChatModelId } from "@more-more-code/shared";
import { useChat } from "../hooks/use-chat";
import type { Message, ClientMessagePart } from "../hooks/use-chat";
import { MessageStatus } from "@more-more-code/database";
import { useKeyboardLayer } from "../providers/keyboard-layer";

type SessionData = InferResponseType<(typeof apiClient.sessions)[":id"]["$get"], 200>; // 获取SessionData的类型

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>((val) => {
    return val !== null && typeof val === "object" && "id" in val; //  验证session对象是否包含id属性
  })
})

function mapDbMessages(dbMessages: SessionData["messages"]): Message[] {
  return dbMessages.map((msg): Message => {
    if (msg.role === "ERROR") {
      return {
        id: msg.id,
        role: "error",
        content: msg.content,

      }
    }

    if (msg.role === "USER") {
      return {
        id: msg.id,
        role: "user",
        content: msg.content,
        mode: msg.mode,
        model: msg.model as SupportedChatModelId,
      }
    }

    return {
      id: msg.id,
      role: "assistant",
      content: msg.content,
      model: msg.model as SupportedChatModelId,
      mode: msg.mode,
      parts: [{ type: "text", text: msg.content }],
      ...(msg.duration !== null ? { duration: prettyMs(msg.duration) } : {}),
      interrupted: msg.status === MessageStatus.INTERRUPTED, // 如果消息状态为INTERRUPTED，则设置interrupted为true
    }
  })
}

function ChatMessage({ msg }: { msg: Message }) {
  if (msg.role === "user") { // 如果是用户消息
    return <UserMessage message={msg.content} />;
  }
  if (msg.role === "error") { // 如果是错误消息
    return <ErrorMessage message={msg.content} />;
  }
  return (
    <BotMessage
      parts={msg.parts}
      model={msg.model}
      mode={msg.mode}
      duration={msg.duration}
      streaming={false}
      interrupted={msg.interrupted}
    />
  ); // 否则是机器人消息
}

function SessionChat({ session }: { session: SessionData }) {
  const [initialMessages] = useState(() => mapDbMessages(session.messages)); // 将数据库消息映射为客户端消息
  const { isTopLayer } = useKeyboardLayer(); // 获取键盘层状态
  const { messages, streaming, submit, abort, interrupt } = useChat(session.id, initialMessages); // 使用自定义hook管理消息状态

  useEffect(() => {
    return () => { // 组件卸载时取消订阅
      return abort();
    }
  }, [abort]);

  useKeyboard((key) => {
    if (key.name === "escape" && isTopLayer("base") && streaming.status === "streaming") {
      key.preventDefault();
      interrupt(); // 如果按下esc键且当前是顶层键盘层且正在流式传输，则中断流式传输 
    }
  })

  return (
    <SessionShell
      onSubmit={(text) => {
        submit({
          userText: text,
          mode: "BUILD",
          model: DEFAULT_CHAT_MODEL_ID
        })
      }}
      loading={streaming.status === "streaming"}
      interruptible={streaming.status === "streaming"} // 如果正在流式传输，则允许中断
    >
      {/* 渲染消息 */}
      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} />
      ))}

      {/*  */}
      {streaming.status === "streaming" && streaming.parts.length > 0 && (
        <BotMessage
          parts={streaming.parts}
          model={streaming.model}
          mode={streaming.mode}
          streaming
        />
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
    return parsed.success ? parsed.data.session : null; // 如果验证成功，返回session数据，否则返回null
  }, [location.state])

  const [session, setSession] = useState(prefetched); // 创建session状态
  useEffect(() => {
    if (prefetched) return;
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
    />
  );
}