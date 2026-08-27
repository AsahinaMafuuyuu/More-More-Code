import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { AgentRunStatus } from "@more-more-code/harness";
import type { AgentActivityView } from "../lib/agent-activity-projection";
import { createActivityRows, formatActivityHeader } from "../lib/activity-view-model";
import { useTheme } from "../providers/theme";
import { EmptyBorder } from "./border";

type Props = {
  activity?: AgentActivityView | null;
};

export function ActivityView({ activity }: Props) {
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();
  const [showHistory, setShowHistory] = useState(true);
  const [turnExpansion, setTurnExpansion] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setShowHistory(true);
    setTurnExpansion({});
  }, [activity?.runId]);

  const rows = useMemo(() => activity
    ? createActivityRows(activity, {
        width: dimensions.width,
        showHistory,
        turnExpansion,
        maxTurns: dimensions.height < 24 ? 2 : dimensions.height < 36 ? 3 : 4,
        maxStepsPerTurn: dimensions.height < 24 ? 3 : 4,
      })
    : [], [activity, dimensions.height, dimensions.width, showHistory, turnExpansion]);

  if (!activity) return null;

  const toggleTurn = (turnId: string, currentExpanded: boolean) => {
    setTurnExpansion((current) => ({
      ...current,
      [turnId]: !currentExpanded,
    }));
  };

  return (
    <box
      flexShrink={0}
      width="100%"
      border={["left"]}
      borderColor={colors.thinkingBorder}
      customBorderChars={{
        ...EmptyBorder,
        vertical: "│",
      }}
      paddingX={1}
    >
      <box
        width="100%"
        flexDirection="row"
        gap={1}
        onMouseDown={() => setShowHistory((current) => !current)}
      >
        <text fg={statusColor(activity.status, colors)}>
          {showHistory ? "▾" : "▸"}
        </text>
        <text attributes={TextAttributes.BOLD}>
          {formatActivityHeader(activity, dimensions.width)}
        </text>
      </box>

      {rows.map((row) => {
        const content = (
          <text
            attributes={row.kind === "omitted" ? TextAttributes.DIM : undefined}
            fg={row.status ? statusColor(row.status, colors) : undefined}
          >
            {row.kind === "turn" && row.expandable
              ? `${row.expanded ? "▾" : "▸"} ${row.text}`
              : row.text}
          </text>
        );

        if (row.kind === "turn" && row.turnId && row.expandable) {
          return (
            <box
              key={row.key}
              width="100%"
              onMouseDown={() => toggleTurn(row.turnId!, Boolean(row.expanded))}
            >
              {content}
            </box>
          );
        }

        return <box key={row.key} width="100%">{content}</box>;
      })}
    </box>
  );
}

function statusColor(
  status: AgentRunStatus,
  colors: ReturnType<typeof useTheme>["colors"],
) {
  switch (status) {
    case "completed":
      return colors.success;
    case "failed":
      return colors.error;
    case "interrupted":
      return colors.thinking;
    default:
      return colors.info;
  }
}
