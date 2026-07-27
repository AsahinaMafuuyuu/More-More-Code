import "opentui-spinner/react";
import { useTheme } from "../providers/theme";
import { Mode, type ModeType } from "@more-more-code/shared";

type SpinnerProps = {
    mode?: ModeType,
}
export function Spinner({ mode = Mode.BUILD }: SpinnerProps) {
    const { colors } = useTheme();
    const activeColor = mode === Mode.BUILD ? colors.primary : colors.planMode;

    return (
        <spinner name="dots" color={activeColor}></spinner>
    );

}