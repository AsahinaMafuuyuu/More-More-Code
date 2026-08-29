import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../../providers/theme";
import type { InspectorUsageView } from "./inspector-projections";
import { InspectorMetricRow } from "./inspector-metric-row";

export function UsageInspectorSection({
  view,
  narrow,
}: {
  view: InspectorUsageView;
  narrow: boolean;
}) {
  const { colors } = useTheme();
  const cacheTone = view.cacheCoverage === "complete"
    ? "success"
    : view.cacheCoverage === "partial" ? "warning" : "normal";
  const costTone = view.costCoverage === "complete"
    ? "success"
    : view.costCoverage === "partial" ? "warning" : "normal";

  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <box flexDirection="column">
        <text fg={colors.primary}>Provider usage and calculated cost</text>
        <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>
          Durable Session Usage only. Context estimates are excluded.
        </text>
      </box>

      <box flexDirection="column" gap={narrow ? 1 : 0}>
        <InspectorMetricRow label="Input total" value={view.inputTotal} narrow={narrow} />
        <InspectorMetricRow label="  uncached" value={view.inputNoCache} narrow={narrow} />
        <InspectorMetricRow label="  cache read" value={view.cacheRead} narrow={narrow} />
        <InspectorMetricRow label="  cache write" value={view.cacheWrite} narrow={narrow} />
        <InspectorMetricRow label="Output total" value={view.outputTotal} narrow={narrow} />
        <InspectorMetricRow label="  text" value={view.outputText} narrow={narrow} />
        <InspectorMetricRow label="  reasoning" value={view.outputReasoning} narrow={narrow} />
        <InspectorMetricRow
          label="Cache hit"
          value={`${view.cacheHit} · ${view.cacheCoverage}`}
          narrow={narrow}
          valueTone={cacheTone}
        />
        <InspectorMetricRow
          label="API cost"
          value={`${view.apiCost} · ${view.costCoverage}`}
          narrow={narrow}
          valueTone={costTone}
        />
        <InspectorMetricRow label="Model steps" value={view.completedSteps} narrow={narrow} />
        <InspectorMetricRow
          label="Integrity"
          value={view.integrity}
          narrow={narrow}
          valueTone={view.integrity === "valid" ? "success" : "error"}
        />
      </box>

      {view.persistenceIncomplete && (
        <text fg={colors.thinking}>
          Usage persistence is incomplete; known totals are lower-bound/partial.
        </text>
      )}
    </box>
  );
}
