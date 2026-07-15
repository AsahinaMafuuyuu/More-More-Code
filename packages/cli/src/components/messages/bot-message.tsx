// 智能体错误的消息
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { ClientMessagePart } from "../../hooks/use-chat";
import { Mode } from "@more-more-code/database";

type Props = {
    parts: ClientMessagePart[];
    model: string;
    mode: Mode;
    duration?: string;
    streaming?: boolean;
    interrupted?: boolean;
}

export function BotMessage({
    parts,
    model,
    mode,
    duration,
    streaming = false,
    interrupted = false, // 不允许中断
}: Props) {
    const { colors } = useTheme();

    const content = parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ");

    return (
        <box width="100%" alignItems="center">
            <box paddingY={1} width="100%">
                <box paddingX={3} width="100%">
                    <text>{content}</text>
                </box>
            </box>

            <box paddingX={3} paddingBottom={1} gap={1} width="100%">
                <box flexDirection="row" gap={2}>

                    <text
                        attributes={interrupted ? TextAttributes.DIM : 0}
                        fg={interrupted ? undefined : mode === Mode.PLAN ? colors.planMode : colors.primary}
                    >
                        ◉
                    </text>

                    <box flexDirection="row" gap={1}>
                        <text
                            attributes={interrupted ? TextAttributes.DIM : 0}
                        >
                            {mode === Mode.PLAN ? "Plan" : "Build"}
                        </text>

                        {/* 标识箭头> */}
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                            &gt;
                        </text>

                        <text attributes={TextAttributes.DIM}>{model}</text>

                        {(duration || interrupted) && (
                            <>
                                {/* 标识箭头> */}
                                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                                    &gt;
                                </text>

                                <text attributes={TextAttributes.DIM}>{interrupted ? "interrupted" : duration}</text>
                            </>
                        )}
                    </box>
                </box>
            </box>
        </box>
    );
};