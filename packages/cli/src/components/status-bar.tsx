// 显示模型状态栏
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { DEFAULT_CHAT_MODEL_ID } from "@more-more-code/shared";

export default function StatusBar() {
    const { colors } = useTheme();
    return(
        <box flexDirection="row" gap={1}>
            <text fg={colors.primary}>Build</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                &#8250;
            </text>
            <text>{DEFAULT_CHAT_MODEL_ID}</text>
        </box>
    )
}