import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { BusyIndicator } from "../../../components/busy-indicator";
import { resolveTuiRenderProfileFromEnvironment } from "../../../tui/render-profile";
import { useSessionUiSelector } from "../store/react-session-ui";
import {
  selectActiveRuntime,
  selectComposerRuntime,
  selectStatus,
} from "../store/session-ui-selectors";
import { formatActiveRuntimeLabel } from "../projections/session-ui-projections";

function formatElapsed(startedAt: number | null, now: number) {
  if (startedAt === null || !Number.isFinite(startedAt)) return null;
  return `${(Math.max(0, now - startedAt) / 1000).toFixed(1)}s`;
}

export function InteractionHintsSurface() {
  const runtime = useSessionUiSelector(selectComposerRuntime);
  const activeRuntime = useSessionUiSelector(selectActiveRuntime);
  const status = useSessionUiSelector(selectStatus);
  const profile = resolveTuiRenderProfileFromEnvironment();
  const [now, setNow] = useState(() => Date.now());
  const loading = activeRuntime.phase !== "idle" || runtime.canInterrupt || runtime.disabled;

  useEffect(() => {
    setNow(Date.now());
    if (activeRuntime.phase === "idle" || profile.activityElapsedMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), profile.activityElapsedMs);
    return () => clearInterval(timer);
  }, [activeRuntime.phase, activeRuntime.runId, profile.activityElapsedMs]);

  const elapsed = activeRuntime.phase === "idle"
    ? null
    : formatElapsed(activeRuntime.startedAt, now);
  return (
    <box
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      height={1}
      gap={2}
      paddingLeft={1}
    >
      <box flexDirection="row" alignItems="center" gap={2}>
        {loading ? (
          <>
            <BusyIndicator mode={status.mode} />
            <text>
              {formatActiveRuntimeLabel(activeRuntime)}{elapsed ? ` · ${elapsed}` : ""}
            </text>
            {runtime.canInterrupt && (
              <text attributes={TextAttributes.DIM}>enter follow-up · ctrl+enter steer · shift+enter newline · esc interrupt</text>
            )}
          </>
        ) : null}
      </box>
      <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
        <text>tab</text>
        <text attributes={TextAttributes.DIM}>Build/Plan</text>
      </box>
    </box>
  );
}
