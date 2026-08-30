import type { ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { ConversationPane } from "./conversation-pane";
import { useUiTerminalDimensions } from "../../../providers/terminal-dimensions";

export type SessionWorkspaceLayout = {
  widthClass: "narrow" | "medium" | "wide";
  paddingX: number;
  conversationMinRows: number;
};

export function resolveSessionWorkspaceLayout(width: number, height: number): SessionWorkspaceLayout {
  const widthClass = width < 72 ? "narrow" : width < 120 ? "medium" : "wide";
  return {
    widthClass,
    paddingX: widthClass === "narrow" ? 1 : 2,
    conversationMinRows: height < 24 ? 6 : height < 30 ? 8 : 10,
  };
}

export function SessionWorkspace({
  conversation,
  composer,
  status,
  hints,
  inspector,
  conversationScrollRef,
}: {
  conversation: ReactNode;
  composer: ReactNode;
  status: ReactNode;
  hints?: ReactNode;
  inspector?: ReactNode;
  conversationScrollRef?: RefObject<ScrollBoxRenderable | null>;
}) {
  const dimensions = useUiTerminalDimensions();
  const layout = resolveSessionWorkspaceLayout(dimensions.width, dimensions.height);
  return (
    <box
      position="relative"
      flexDirection="column"
      flexGrow={1}
      width="100%"
      height="100%"
      paddingY={1}
      paddingX={layout.paddingX}
      gap={1}
    >
      <ConversationPane minRows={layout.conversationMinRows} scrollRef={conversationScrollRef}>
        {conversation}
      </ConversationPane>
      <box flexShrink={0} width="100%">{composer}</box>
      <box flexShrink={0} width="100%">{status}</box>
      {hints ? <box flexShrink={0} width="100%">{hints}</box> : null}
      {inspector}
    </box>
  );
}
