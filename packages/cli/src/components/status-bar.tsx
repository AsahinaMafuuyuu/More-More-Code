// 显示模型状态栏
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { DEFAULT_CHAT_MODEL_ID } from "@more-more-code/shared";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode } from "@more-more-code/database";

export default function StatusBar() {
    const {mode, model} = usePromptConfig();
    const { colors } = useTheme();
    return(
        <box flexDirection="row" gap={1}>
            <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
                {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                &#8250;
            </text>
            <text>{model}</text>
        </box>
    )
}