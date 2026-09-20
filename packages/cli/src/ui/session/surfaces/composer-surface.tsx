import type { SessionController } from "../../../app/session/session-controller";
import { usePromptConfig } from "../../../providers/prompt-config";
import { useToast } from "../../../providers/toast";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectComposerRuntime } from "../store/session-ui-selectors";
import { Composer } from "../composer/composer";
import { InteractionQueueSurface } from "./interaction-queue-surface";
import { useSessionCommandHandler } from "../command/use-session-command-handler";
import { useSessionTreeCommandApi } from "../navigation/use-session-tree-command-api";

export function ComposerSurface({ controller }: { controller: SessionController }) {
  const runtime = useSessionUiSelector(selectComposerRuntime);
  const { mode, model } = usePromptConfig();
  const toast = useToast();

  const sessionTree = useSessionTreeCommandApi(controller);

  const reportError = (error: unknown) => {
    toast.show({
      variant: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const submit = (text: string) => {
    void controller.submit({ userText: text, mode, model }).catch(reportError);
  };

  const followUp = (text: string) => {
    const operation = runtime.followUpAvailable
      ? controller.followUp({ userText: text, mode, model })
      : controller.submit({ userText: text, mode, model });
    void operation.catch(reportError);
  };

  const steer = (text: string) => {
    const operation = runtime.runActive
      ? controller.steer({ userText: text, mode, model })
      : controller.submit({ userText: text, mode, model });
    void operation.catch(reportError);
  };

  const handleIntent = useSessionCommandHandler({ controller, sessionTree });

  return (
    <box flexShrink={0}>
      <InteractionQueueSurface controller={controller} />
      <Composer
        onSubmit={submit}
        onFollowUp={followUp}
        onSteer={steer}
        disabled={runtime.disabled}
        runActive={runtime.runActive}
        mode={mode}
        onIntent={handleIntent}
      />
    </box>
  );
}
