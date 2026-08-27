import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { modeSchema } from "@more-more-code/shared";
import { useNavigate, useLocation } from "react-router";
import { useTheme } from "../providers/theme";
import { ErrorMessage, UserMessage, BotMessage } from "../components/messages";
import { SessionLoadingWorkspace } from "../ui/session/workspace/session-loading-workspace";

import { useToast } from "../providers/toast";
import { getLocalSessionAuthority } from "../lib/session-environment";

// 新对话可以传入mode和model
const newSessionSchema = z.object({
    message: z.string(),
    mode: modeSchema,
    model: z.object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
    }).strict(),
})

// 创建默认的聊天对话
export function NewSession() {
    const navigate = useNavigate();
    const location = useLocation();
    const { colors } = useTheme();
    const toast = useToast();
    const hasStartedRef = useRef(false);

    const state = useMemo(() => {
        const parsed = newSessionSchema.safeParse(location.state); // 解析state
        return parsed.success ? parsed.data : null; // 如果解析成功，返回数据，否则返回null
    }, [location.state]);


    useEffect(() => {
        if (!state?.message) {
            navigate("/", { replace: true }); // 如果没有传递消息，则重定向回主页
        }
    }, [navigate, state])

    useEffect(() => {
        if (!state || hasStartedRef.current) return; // 如果没有state或者已经开始，则返回
        hasStartedRef.current = true; // 标记为已经开始
        let ignore = false; // 标记是否忽略
        const createSession = async () => {
            try {
                // The root Session Tree is persisted before the conversation is
                // exposed. The first user message follows through the durable
                // turn gate in useChat.
                const snapshot = await getLocalSessionAuthority().create({
                    title: state.message.trim().slice(0, 100) || "New session",
                });
                if (ignore) return;

                navigate(
                    `/sessions/${snapshot.session.id}`,
                    { 
                        replace: true, 
                        state: { 
                            snapshot,
                            initialPrompt: state
                        } }); // 导航到新会话页面, 并传递本地快照
            }
            catch (error) {
                if (ignore) return; // 如果忽略，则返回
                toast.show({
                    variant: "error",
                    message: error instanceof Error
                        ? `Unable to create a local session: ${error.message}`
                        : "Unable to create a local session",
                })
                navigate("/", { replace: true }); // 如果创建会话失败，导航回主页
            }
        }

        createSession(); // 创建会话
        return () => { ignore = true; }; // 返回取消函数
    }, [state, navigate, toast])

    if (!state?.message) return null;

    return (
        <SessionLoadingWorkspace
            conversation={<UserMessage message={state.message} mode={state.mode} />}
        />
    )
};
