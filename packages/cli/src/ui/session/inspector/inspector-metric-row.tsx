import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../../providers/theme";

export function InspectorMetricRow({
  label,
  value,
  narrow = false,
  valueTone = "normal",
}: {
  label: string;
  value: string;
  narrow?: boolean;
  valueTone?: "normal" | "success" | "warning" | "error";
}) {
  const { colors } = useTheme();
  const valueColor = valueTone === "success"
    ? colors.success
    : valueTone === "error"
      ? colors.error
      : valueTone === "warning"
        ? colors.thinking
        : undefined;

  if (narrow) {
    return (
      <box flexDirection="column" flexShrink={0}>
        <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>{label}</text>
        <text fg={valueColor}>{value}</text>
      </box>
    );
  }

  return (
    <box flexDirection="row" flexShrink={0}>
      <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>{label}</text>
      <box flexGrow={1} />
      <text fg={valueColor}>{value}</text>
    </box>
  );
}
