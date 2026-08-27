import type { ReactNode } from "react";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectInspector } from "../store/session-ui-selectors";

/** Shell only. Inspector section content belongs to the next UI slice. */
export function InspectorSurface({ children }: { children?: ReactNode }) {
  const inspector = useSessionUiSelector(selectInspector);
  if (!inspector.open || !children) return null;
  return (
    <box
      position="absolute"
      top={0}
      right={0}
      width="100%"
      height="100%"
      zIndex={50}
    >
      {children}
    </box>
  );
}
