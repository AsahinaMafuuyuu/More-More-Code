import { TextAttributes } from "@opentui/core";
import type { SessionController } from "../../../app/session/session-controller";
import { useTheme } from "../../../providers/theme";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectInteractionQueue } from "../store/session-ui-selectors";

const MAX_VISIBLE_PENDING = 2;
const MAX_TEXT_LENGTH = 72;

function compactText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

export function InteractionQueueSurface({ controller }: { controller: SessionController }) {
  const queue = useSessionUiSelector(selectInteractionQueue);
  const { colors } = useTheme();
  const visible = queue.pending.slice(0, MAX_VISIBLE_PENDING);
  const overflow = Math.max(0, queue.pending.length - visible.length);
  const latestOutcome = queue.outcomes.at(-1);

  if (visible.length === 0 && !latestOutcome) return null;

  return (
    <box
      width="100%"
      flexDirection="column"
      paddingX={2}
      paddingY={visible.length > 0 ? 1 : 0}
      backgroundColor={colors.surface}
    >
      {visible.map((item) => (
        <box key={item.id} width="100%" height={1} flexDirection="row" gap={1}>
          <text attributes={TextAttributes.DIM}>
            {item.kind === "follow-up" ? "Follow-up" : "Steering"}
          </text>
          <text flexGrow={1}>{compactText(item.text)}</text>
          {item.kind === "follow-up" ? (
            <text
              fg={colors.primary}
              selectable={false}
              onMouseDown={() => controller.promoteFollowUpToSteering(item.id)}
            >
              Steer
            </text>
          ) : null}
          <text
            attributes={TextAttributes.DIM}
            selectable={false}
            onMouseDown={() => controller.cancelPendingInteraction(item.id)}
          >
            ×
          </text>
        </box>
      ))}
      {overflow > 0 ? (
        <text attributes={TextAttributes.DIM}>+{overflow} queued</text>
      ) : null}
      {visible.length === 0 && latestOutcome ? (
        <text attributes={TextAttributes.DIM}>
          Not sent ({latestOutcome.reason === "run-interrupted" ? "run interrupted" : "run failed"}): {compactText(latestOutcome.text)}
        </text>
      ) : null}
    </box>
  );
}
