import type { ReactNode } from "react";
import { BusyIndicator } from "../../../components/busy-indicator";
import StatusBar from "../../../components/status-bar";
import { usePromptConfig } from "../../../providers/prompt-config";
import { Composer } from "../composer/composer";
import { SessionWorkspace } from "./session-workspace";

export function SessionLoadingWorkspace({ conversation }: { conversation?: ReactNode }) {
  const { mode } = usePromptConfig();
  return (
    <SessionWorkspace
      conversation={conversation ?? <box />}
      composer={<Composer onSubmit={() => {}} disabled mode={mode} />}
      status={<StatusBar />}
      hints={(
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <BusyIndicator mode={mode} />
          <text>loading session</text>
        </box>
      )}
    />
  );
}
