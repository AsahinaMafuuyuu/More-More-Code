import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../../providers/theme";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectStatus } from "../store/session-ui-selectors";

export function StatusSurface() {
  const status = useSessionUiSelector(selectStatus);
  const { colors } = useTheme();
  return (
    <box flexDirection="row" gap={1}>
      <text fg={status.mode === "PLAN" ? colors.planMode : colors.primary}>
        {status.mode === "PLAN" ? "Plan" : "Build"}
      </text>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>&#8250;</text>
      <text>{status.modelLabel}</text>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
      <text>{status.contextLabel}</text>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
      <text>{status.costLabel}</text>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
      <text>{status.cacheLabel}</text>
    </box>
  );
}
