// 显示模型状态栏
import { TextAttributes } from "@opentui/core";

export default function StatusBar() {
    return(
        <box flexDirection="row" gap={1}>
            <text fg="cyan">Build</text>
            <text attributes={TextAttributes.DIM} fg="grey">
                &#8250;
            </text>
            <text>opus-4.6</text>
        </box>
    )
}