import { TextAttributes } from "@opentui/core";
import { Spinner } from "../../../components/spinner";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectComposerRuntime, selectStatus } from "../store/session-ui-selectors";

export function InteractionHintsSurface() {
  const runtime = useSessionUiSelector(selectComposerRuntime);
  const status = useSessionUiSelector(selectStatus);
  const loading = runtime.runActive || runtime.canInterrupt || runtime.disabled;
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
            <Spinner mode={status.mode} />
            {runtime.canInterrupt && (
              <text>enter steer · alt+enter follow-up · esc interrupt</text>
            )}
          </>
        ) : null}
      </box>
      <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
        <text>tab</text>
        <text attributes={TextAttributes.DIM}>agents</text>
      </box>
    </box>
  );
}
