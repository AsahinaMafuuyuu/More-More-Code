import "opentui-spinner/react";
import { useTheme } from "../providers/theme";
import { Mode } from "@more-more-code/database";

type SpinnerProps = {
    mode?: Mode,
}
export function Spinner({ mode = Mode.BUILD }: SpinnerProps) {
    const { colors } = useTheme();
    const activeColor = mode === Mode.BUILD ? colors.primary : colors.planMode;

    return (
        <spinner name="dots" color={activeColor}></spinner>
    );

}