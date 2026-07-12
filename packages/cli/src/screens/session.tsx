import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import type { InferResponseType } from "hono/client";
import { SessionShell } from "../components/session-shell";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";

type SessionData = InferResponseType<(typeof apiClient.sessions)[":id"]["$get"], 200>; // 获取SessionData的类型

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>((val) => {
    return val !== null && typeof val === "object" && "id" in val; //  验证session对象是否包含id属性
  })
})

function ChatMessage({ msg }: { msg: SessionData["messages"][number] }) {
  if (msg.role === "USER") { // 如果是用户消息
    return <UserMessage message={msg.content} />;
  }
  if (msg.role === "ERROR") { // 如果是错误消息
    return <ErrorMessage message={msg.content} />;
  }
  return <BotMessage content={msg.content} model={msg.model} />; // 否则是机器人消息
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
    <SessionShell onSubmit={() => { }} inputDisabled >
      {session.messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} /> // 渲染每条消息
      ))}
    </SessionShell>
  );
}