import type { ReactNode, RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "../../../providers/theme";
import { createTerminalScrollbarOptions } from "../../scrollbar-style";

export function ConversationPane({ children, minRows, scrollRef }: {
  children: ReactNode;
  minRows: number;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
}) {
  const { colors } = useTheme();
  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      minHeight={minRows}
      width="100%"
      scrollX={false}
      stickyScroll
      stickyStart="bottom"
      viewportCulling
      verticalScrollbarOptions={createTerminalScrollbarOptions(colors)}
    >
      <box width="100%" flexDirection="column">
        {children}
      </box>
    </scrollbox>
  );
}
