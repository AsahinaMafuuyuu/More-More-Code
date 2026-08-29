import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import Header from "../components/header";
import { Composer } from "../ui/session/composer/composer";
import { usePromptConfig } from "../providers/prompt-config";
import { useSessionCommandHandler } from "../ui/session/command/use-session-command-handler";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { getConfiguredModelOptions } from "../lib/models";

export function Home() {
    const navigate = useNavigate(); // 使用useNavigate()获取navigate函数

    const { mode, model } = usePromptConfig();
    const { colors } = useTheme();
    const modelOptions = useMemo(() => getConfiguredModelOptions(model), [model]);
    const reasoningLabel = modelOptions?.reasoningEffort
        ? modelOptions.reasoningEffort[0]!.toUpperCase() + modelOptions.reasoningEffort.slice(1)
        : "Default";
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
                    justifyContent="space-between"
                    width="100%"
                    flexShrink={0}
                >
                    <box flexDirection="row" gap={1}>
                        <text fg={mode === "PLAN" ? colors.planMode : colors.primary}>
                            {mode === "PLAN" ? "Plan" : "Build"}
                        </text>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>&#8250;</text>
                        <text>{model.providerId}/{model.modelId}</text>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
                        <text attributes={TextAttributes.DIM}>Reasoning</text>
                        <text>{reasoningLabel}</text>
                    </box>
                    <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
                        <text>tab</text>
                        <text attributes={TextAttributes.DIM}>Build/Plan</text>
                    </box>
                </box>
            </box>
        </box>
    );
};
