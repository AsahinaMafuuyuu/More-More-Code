import { TextAttributes } from "@opentui/core";
import { useMemo, useState } from "react";
import { useTheme } from "../../providers/theme";

export const COLLAPSED_MESSAGE_TEXT_CHARS = 16_384;
const COLLAPSED_MESSAGE_TEXT_HEAD_CHARS = 12_288;
const COLLAPSED_MESSAGE_TEXT_TAIL_CHARS = 3_072;

export function createCollapsedMessageTextPreview(text: string) {
  if (text.length <= COLLAPSED_MESSAGE_TEXT_CHARS) return text;
  const head = text.slice(0, COLLAPSED_MESSAGE_TEXT_HEAD_CHARS);
  const tail = text.slice(-COLLAPSED_MESSAGE_TEXT_TAIL_CHARS);
  const hidden = Math.max(0, text.length - head.length - tail.length);
  return `${head}\n⋯ ${hidden.toLocaleString()} characters hidden ⋯\n${tail}`;
}

/**
 * Prevent one pasted/generated megatext message from defeating transcript
 * windowing. The source remains intact in Session/Chat state; only renderer
 * materialization is bounded until the user explicitly expands it.
 */
export function MessageTextDisclosure({ text }: { text: string }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > COLLAPSED_MESSAGE_TEXT_CHARS;
  const rendered = useMemo(
    () => expanded || !collapsible ? text : createCollapsedMessageTextPreview(text),
    [collapsible, expanded, text],
  );

  if (!collapsible) return <text>{text}</text>;

  return (
    <box width="100%" flexDirection="column">
      <box width="100%" flexDirection="row" gap={1} onMouseDown={() => setExpanded((value) => !value)}>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          {expanded ? "▾" : "▸"}
        </text>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          {expanded
            ? `large message · ${text.length.toLocaleString()} chars · collapse`
            : `large message · ${text.length.toLocaleString()} chars · expand`}
        </text>
      </box>
      <text>{rendered}</text>
    </box>
  );
}
