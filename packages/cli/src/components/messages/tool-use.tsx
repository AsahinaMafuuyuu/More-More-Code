import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useMemo, useState } from "react";
import type { ToolUseStatus, ToolUseView } from "../../lib/tool-use-projection";
import { createToolUseDisplay } from "../../lib/tool-use-view-model";
import { useTheme } from "../../providers/theme";
import { EmptyBorder } from "../border";

type Props = {
  view: ToolUseView;
};

export function ToolUse({ view }: Props) {
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();
  const [expanded, setExpanded] = useState(false);
  const display = useMemo(
    () => createToolUseDisplay(view, Math.max(20, dimensions.width - 10)),
    [dimensions.width, view],
  );
  const color = statusColor(view.status, colors);

  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={color}
      customBorderChars={{
        ...EmptyBorder,
        vertical: "│",
      }}
      paddingX={2}
    >
      <box
        width="100%"
        flexDirection="row"
        gap={1}
        onMouseDown={() => setExpanded((current) => !current)}
      >
        <text fg={color}>{expanded ? "▾" : "▸"}</text>
        <text fg={color}>{display.status.glyph}</text>
        <text>{display.collapsed}</text>
      </box>

      {expanded && display.detailLines.map((line, index) => (
        <box key={`${view.toolCallId}:detail:${index}`} width="100%" paddingLeft={4}>
          <text
            attributes={TextAttributes.DIM}
            fg={line.startsWith("error  ") || line.startsWith("diagnostic  ")
              ? colors.error
              : undefined}
          >
            {line}
          </text>
        </box>
      ))}
    </box>
  );
}

function statusColor(
  status: ToolUseStatus,
  colors: ReturnType<typeof useTheme>["colors"],
) {
  switch (status) {
    case "completed":
      return colors.success;
    case "failed":
    case "denied":
    case "incomplete":
      return colors.error;
    case "cancelled":
    case "timed_out":
      return colors.thinking;
    case "approval_waiting":
    case "running":
      return colors.info;
    default:
      return colors.sessionTool;
  }
}
