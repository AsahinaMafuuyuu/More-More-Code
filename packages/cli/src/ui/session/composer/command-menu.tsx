import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { getFilteredCommands } from "../../../components/command-menu/filter-commands";
import { useTheme } from "../../../providers/theme";
import { createTerminalScrollbarOptions } from "../../scrollbar-style";
import { commandToComposerIntent, type ComposerIntent } from "./composer-intent";

export function ComposerCommandMenu({ query, selectedIndex, scrollRef, onSelect, onIntent }: {
  query: string;
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onIntent: (intent: ComposerIntent) => void;
}) {
  const { colors } = useTheme();
  const commands = getFilteredCommands(query);
  if (commands.length === 0) {
    return <box padding={1}><text attributes={TextAttributes.DIM}>No matching commands</text></box>;
  }
  return (
    <scrollbox
      ref={scrollRef}
      height={Math.min(commands.length, 8)}
      scrollX={false}
      verticalScrollbarOptions={createTerminalScrollbarOptions(colors)}
    >
      {commands.map((command, index) => {
        const selected = index === selectedIndex;
        return (
          <box key={command.value} height={1} paddingLeft={1} flexDirection="row"
            backgroundColor={selected ? colors.selection : undefined}
            onMouseMove={() => onSelect(index)}
            onMouseDown={() => onIntent(commandToComposerIntent(command))}>
            <text selectable={false} fg={selected ? "black" : "white"}>/{command.name}</text>
            <text selectable={false} fg={selected ? "black" : "grey"}> {command.description}</text>
          </box>
        );
      })}
    </scrollbox>
  );
}

export function resolveComposerCommandIntent(query: string, index: number) {
  const command = getFilteredCommands(query)[index];
  return command ? commandToComposerIntent(command) : null;
}
