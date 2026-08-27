import type { ReactNode } from "react";

export function ActivityDock({ children, maxRows }: {
  children: ReactNode;
  maxRows: number;
}) {
  return (
    <box flexShrink={0} maxHeight={maxRows} width="100%" overflow="hidden">
      {children}
    </box>
  );
}
