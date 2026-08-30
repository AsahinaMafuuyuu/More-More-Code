import { Mode, type ModeType } from "@more-more-code/shared";
import { useTheme } from "../providers/theme";

export function BusyIndicator({ mode = Mode.BUILD }: { mode?: ModeType }) {
  const { colors } = useTheme();
  const activeColor = mode === Mode.BUILD ? colors.primary : colors.planMode;
  return <text fg={activeColor}>●</text>;
}
