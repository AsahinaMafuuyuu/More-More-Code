import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { DEFAULT_CHAT_MODEL_ID } from "@more-more-code/shared";
import { useNavigate, useLocation } from "react-router";
import { useTheme } from "../providers/theme";
import { ErrorMessage, UserMessage, BotMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell";

import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";

const newSessionSchema = z.object({
    message: z.string(),
})
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
                const res = await apiClient.sessions.$post({
                    json: {
                        title: state.message.slice(0, 100),
                        cwd: process.cwd(),
                        initialMessage: {
                            role: 'USER',
                            content: state.message,
                            mode: "BUILD",
                            model: DEFAULT_CHAT_MODEL_ID,
                        }
                    }
                });
                if (ignore) return;
                if (!res.ok) {
                    throw new Error(await getErrorMessage(res));
                }

                // 如果创建会话成功，导航到新会话页面
                const session = await res.json(); // 解析响应为JSON
                navigate(`/sessions/${session.id}`, { replace: true, state: { session } }); // 导航到新会话页面, 并传递session数据
            }
            catch (error) {
                if (ignore) return; // 如果忽略，则返回
                toast.show({
                    variant: "error",
                    message: error instanceof Error ? error.message : "Failed to create session",
                })
                navigate("/", { replace: true }); // 如果创建会话失败，导航回主页
            }
        }

        createSession(); // 创建会话
        return () => { ignore = true; }; // 返回取消函数
    }, [state, navigate, toast])

    if (!state?.message) return null;

    return (
        <SessionShell onSubmit={() => { }} inputDisabled loading={true}>
            <UserMessage message={state.message} />
        </SessionShell>
    )
};