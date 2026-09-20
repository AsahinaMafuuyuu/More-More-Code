import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../../providers/theme";
import { ContextUtilizationBar } from "../surfaces/context-utilization-bar";
import type { InspectorContextView } from "./inspector-projections";
import { InspectorMetricRow } from "./inspector-metric-row";

export function ContextInspectorSection({
  view,
  narrow,
}: {
  view: InspectorContextView;
  narrow: boolean;
}) {
  const { colors } = useTheme();

  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <box flexDirection="column">
        <text fg={colors.primary}>Current model context</text>
        <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>
          Read-only projection of the next model input budget.
        </text>
      </box>

      {!view.available ? (
        <text attributes={TextAttributes.DIM}>Context observability is unavailable for the active model.</text>
      ) : (
        <>
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text>{view.currentInput} / {view.contextWindow}</text>
            <ContextUtilizationBar ratio={view.utilizationRatio} />
          </box>
          <box flexDirection="column" gap={narrow ? 1 : 0}>
            <InspectorMetricRow label="Current input" value={view.currentInput} narrow={narrow} />
            <InspectorMetricRow label="Context window" value={view.contextWindow} narrow={narrow} />
            <InspectorMetricRow label="Utilization" value={view.utilization} narrow={narrow} />
            <InspectorMetricRow label="Input budget" value={view.inputBudget} narrow={narrow} />
            <InspectorMetricRow label="Reserved output" value={view.reservedOutput} narrow={narrow} />
            <InspectorMetricRow label="Safety margin" value={view.safetyMargin} narrow={narrow} />
            <InspectorMetricRow label="Counter" value={view.counterId} narrow={narrow} />
            <InspectorMetricRow
              label="Quality"
              value={view.quality}
              narrow={narrow}
              valueTone={view.quality === "exact" ? "success" : "warning"}
            />
          </box>
        </>
      )}
    </box>
  );
}
