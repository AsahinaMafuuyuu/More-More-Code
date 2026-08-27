import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { useTheme } from "../../../providers/theme";
import type { MentionCandidate } from "./mention-model";

export function MentionMenu({ candidates, selectedIndex, scrollRef, onSelect, onExecute }: {
  candidates: MentionCandidate[];
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
}) {
  const { colors } = useTheme();
  if (candidates.length === 0) {
    return <box paddingX={1}><text attributes={TextAttributes.DIM}>No matching files or directories</text></box>;
  }
  return (
    <scrollbox ref={scrollRef} height={Math.min(candidates.length, 8)}>
      {candidates.map((candidate, index) => {
        const selected = index === selectedIndex;
        return (
          <box key={candidate.path} height={1} paddingX={1} flexDirection="row" justifyContent="space-between"
            backgroundColor={selected ? colors.selection : undefined}
            onMouseMove={() => onSelect(index)} onMouseDown={() => onExecute(index)}>
            <text selectable={false} fg={selected ? "black" : "white"}>{candidate.path}</text>
            <text selectable={false} fg={selected ? "black" : "gray"}>{candidate.kind === "directory" ? "📁" : "📄"}</text>
          </box>
        );
      })}
    </scrollbox>
  );
}
