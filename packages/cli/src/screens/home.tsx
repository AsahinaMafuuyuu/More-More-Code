import { useCallback } from "react";
import { useNavigate } from "react-router";
import Header from "../components/header";
import { Composer } from "../ui/session/composer/composer";
import { usePromptConfig } from "../providers/prompt-config";
import { useSessionCommandHandler } from "../ui/session/command/use-session-command-handler";
import { TextAttributes } from "@opentui/core";

export function Home() {
    const navigate = useNavigate(); // 使用useNavigate()获取navigate函数

    const { mode, model } = usePromptConfig();
    const handleIntent = useSessionCommandHandler({});
    const handleSubmit = useCallback(
        (text: string) => {
            navigate("/sessions/new", { state: { message: text, mode, model } });
        },
        [navigate, mode, model],
    )
    return (
        <box
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
            gap={2}
            position="relative"
            width="100%"
            height="100%"
        >
            <Header />
            <box width="100%" maxWidth={78} paddingX={2} flexDirection="column" gap={1}>
                <Composer
                    onSubmit={handleSubmit}
                    mode={mode}
                    onIntent={handleIntent}
                />
                <box
                    flexDirection="row"
                    gap={1}
                    flexShrink={0}
                    marginLeft="auto"
                >
                    <text>
                        tab
                    </text>

                    <text
                        attributes={TextAttributes.DIM}
                    >
                        agents
                    </text>
                </box>
            </box>
        </box>
    );
};
