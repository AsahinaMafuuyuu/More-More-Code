import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../../providers/theme";

const BAR_CELLS = 8;

export function formatContextUtilizationBar(ratio: number | null) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return {
      filled: "",
      empty: "░".repeat(BAR_CELLS),
      percent: "—%",
    };
  }
  const normalized = Math.max(0, Math.min(1, ratio));
  const filledCells = Math.round(normalized * BAR_CELLS);
  return {
    filled: "█".repeat(filledCells),
    empty: "░".repeat(BAR_CELLS - filledCells),
    percent: `${Math.round(normalized * 100)}%`,
  };
}

export function ContextUtilizationBar({ ratio }: { ratio: number | null }) {
  const { colors } = useTheme();
  const bar = formatContextUtilizationBar(ratio);
  return (
    <box flexDirection="row">
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>[</text>
      {bar.filled && <text fg={colors.primary}>{bar.filled}</text>}
      {bar.empty && <text fg={colors.dimSeparator}>{bar.empty}</text>}
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>]</text>
      <text> {bar.percent}</text>
    </box>
  );
}
