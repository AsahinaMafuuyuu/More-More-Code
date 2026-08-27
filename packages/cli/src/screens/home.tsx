import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useRenderer } from "@opentui/react";
import Header from "../components/header";
import InputBar from "../components/input-bar";
import { usePromptConfig } from "../providers/prompt-config";
import { useToast } from "../providers/toast";
import { useDialog } from "../providers/dialog";
import { executeLegacyComposerIntent } from "../ui/session/composer/legacy-command-adapter";
import { shutdownCliEnvironment } from "../lib/cli-environment";
import { TextAttributes } from "@opentui/core";

export function Home() {
    const navigate = useNavigate(); // 使用useNavigate()获取navigate函数
    const renderer = useRenderer();
    const toast = useToast();
    const dialog = useDialog();

    const { mode, model, setMode, setModel } = usePromptConfig();
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
                <InputBar
                    onSubmit={handleSubmit}
                    mode={mode}
                    onIntent={(intent) => executeLegacyComposerIntent(intent, {
                        exit: () => {
                            void shutdownCliEnvironment().then(
                                () => renderer.destroy(),
                                (error) => toast.show({
                                    variant: "error",
                                    message: `Exit cancelled safely: ${error instanceof Error ? error.message : String(error)}`,
                                }),
                            );
                        },
                        toast,
                        dialog,
                        navigate,
                        mode,
                        model,
                        setMode,
                        setModel,
                    })}
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
