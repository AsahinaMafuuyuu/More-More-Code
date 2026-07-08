import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { useTheme } from "../providers/theme";
import { ErrorMessage, UserMessage, BotMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell";

export function NewSession() {
    const navigate = useNavigate();
    const location = useLocation();
    const { colors } = useTheme();

    const state = location.state as { message?: string } | null;

    useEffect(() => {
        if (!state?.message) {
            navigate("/", { replace: true }); // 如果没有传递消息，则重定向回主页
        }
    }, [navigate, state])
    if (!state?.message) return null;

    return (
        <SessionShell onSubmit={() => {
           
        }} inputDisabled loading={true}>
            <UserMessage message={state.message} />
            <BotMessage
                content="抱歉，我无法处理您的请求。请稍后再试。"
                model="gpt5.5-turbo"
            />
            <ErrorMessage message="错误" />
        </SessionShell>
    )
};