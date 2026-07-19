import { useCallback, useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { format } from "date-fns";
import { useNavigate } from "react-router";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";
import { DialogSearchList } from "../dialog-search-list";
import type { InferResponseType } from "hono";

type SessionData = InferResponseType<typeof apiClient.sessions[":id"]["$get"], 200>;

type Session = {
    id: string;
    title: string;
    createdAt: string;
}

// 用于在对话框中显示会话列表，并允许用户选择和浏览过去的会话。
export const SessionsDialogContent = () => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);

    const { close } = useDialog(); // 关闭对话框
    const navigate = useNavigate(); // 用于导航到会话详情页
    const { show } = useToast(); // 用于显示提示

    useEffect(() => {
        let ignore = false; // 用于在组件卸载时忽略异步请求的结果

        const fetchSessions = async () => {
            try {
                const res = await apiClient.sessions.$get(); // 获取会话列表
                if (!res.ok) {
                    throw new Error(await getErrorMessage(res));
                }

                const data = await res.json();

                if (!ignore) {
                    setSessions(data); // 如果响应ok，则设置sessions为响应数据 
                    setLoading(false);
                }
            } catch (error) {
                if (!ignore) {
                    // 显示错误提示
                    show({
                        variant: "error",
                        message: error instanceof Error ?
                            error.message : "Failed to fetch sessions",
                    })

                    close(); // 关闭对话框
                }

            }
        }

        fetchSessions(); // 调用fetchSessions函数获取会话列表

        return () => {
            ignore = true;
        };
    }, [close, show]);

    const handleSelect = useCallback((session: Session) => {
        close(); // 关闭对话框
        navigate(`/sessions/${session.id}`);
    }, [close, navigate])

    if (loading) {
        return (
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Loading sessions...</text>
            </box>
        )
    }

    return (
        <DialogSearchList
            items={sessions}
            onSelect={handleSelect}
            filterFn={(session, query) => session.title.toLowerCase().includes(query.toLowerCase())}
            renderItem={(session, isSelected) => (
                <>
                    <text selectable={false} fg={isSelected ? "black" : "white"}>
                        {session.title}
                    </text>
                    <box flexGrow={1}></box>
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : undefined}
                        attributes={TextAttributes.DIM}
                    >
                        {format(new Date(session.createdAt), "hh:mm a")}
                    </text>
                </>
            )}
            getKey={(s) => s.id}
            placeholder="Search sessions..."
            emptyText="No matching sessions"
        />  
    )
}