import { COMMANDS } from "../../../components/command-menu/commands";
import type { CommandContext } from "../../../components/command-menu/types";
import type { ComposerIntent } from "./composer-intent";

/**
 * A4-only compatibility seam. Composer emits data; this adapter executes the
 * legacy command table outside the editor/composer. A5 replaces it with the
 * typed SessionCommandRouter.
 */
export function executeLegacyComposerIntent(intent: ComposerIntent, context: CommandContext) {
  if (intent.type === "change-mode") {
    context.setMode(intent.mode);
    return;
  }
  const command = COMMANDS.find((candidate) =>
    candidate.name === intent.commandName && candidate.value === intent.commandValue);
  if (!command) throw new Error(`Unknown command ${intent.commandValue}`);
  if (command.action) return command.action(context);
}
