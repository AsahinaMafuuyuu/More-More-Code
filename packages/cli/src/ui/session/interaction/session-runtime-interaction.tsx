import { useKeyboard } from "@opentui/react";
import type { SessionController } from "../../../app/session/session-controller";
import { useKeyboardLayer } from "../../../providers/keyboard-layer";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectComposerRuntime } from "../store/session-ui-selectors";
import { resolveInteractionAction } from "./interaction-router";

export function SessionRuntimeInteraction({ controller }: { controller: SessionController }) {
  const runtime = useSessionUiSelector(selectComposerRuntime);
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (key.name !== "escape") return;
    const action = resolveInteractionAction("escape", {
      dialog: isTopLayer("dialog"),
      overlay: isTopLayer("command") ? "command" : isTopLayer("mention") ? "mention" : null,
      inspector: isTopLayer("inspector"),
      composer: isTopLayer("base"),
      runInterruptible: runtime.canInterrupt,
      runActive: runtime.runActive,
    });
    if (action?.action !== "interrupt-run") return;
    key.preventDefault();
    controller.interrupt();
  });

  return null;
}
