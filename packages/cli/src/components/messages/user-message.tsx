// 用户消息
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import { Mode, type ModeType } from "@more-more-code/shared";
import { MessageTextDisclosure } from "./message-text-disclosure";

type Props = {
    message: string;
    mode: ModeType;
}


export function UserMessage({ message, mode }: Props) {
    const { colors } = useTheme();

    return (
        <box
            width="100%"
            alignItems="center"
        >
            <box
                border={["left"]}
                borderColor={mode === Mode.BUILD ? colors.primary : colors.planMode}
                width="100%"
            >
                <box
                    justifyContent="center"
                    paddingX={2}
                    paddingY={1}
                    backgroundColor={colors.surface}
                    width="100%"
                >
                    <MessageTextDisclosure text={message} />
                </box>
            </box>
        </box>
    )
}
