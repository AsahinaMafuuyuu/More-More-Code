import type { Command } from "../../../components/command-menu/types";
import type { ModeType } from "@more-more-code/shared";

export type ComposerIntent =
  | {
      type: "command";
      commandName: string;
      commandValue: string;
    }
  | {
      type: "change-mode";
      mode: ModeType;
    };

export function commandToComposerIntent(command: Command): ComposerIntent {
  return {
    type: "command",
    commandName: command.name,
    commandValue: command.value,
  };
}
