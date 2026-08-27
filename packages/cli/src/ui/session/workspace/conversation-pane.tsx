import type { ReactNode, RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

export function ConversationPane({ children, minRows, scrollRef }: {
  children: ReactNode;
  minRows: number;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
}) {
  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      minHeight={minRows}
      width="100%"
      stickyScroll
      stickyStart="bottom"
    >
      <box width="100%" flexDirection="column">
        {children}
      </box>
    </scrollbox>
  );
}
