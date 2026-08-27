import type { ModeType } from "@more-more-code/shared";
import type { ComposerIntent } from "../../ui/session/composer/composer-intent";

export type SessionDialogIntent =
  | "agents"
  | "models"
  | "providers"
  | "sessions"
  | "tree"
  | "jump"
  | "settings"
  | "theme";

export type SessionCommandIntent =
  | { type: "new-session" }
  | { type: "open-dialog"; dialog: SessionDialogIntent }
  | { type: "navigate-tree"; target: "parent" | "root" }
  | { type: "compact-context" }
  | { type: "change-mode"; mode: ModeType }
  | { type: "exit" };

export type SessionCommandRouterDependencies = {
  navigate(path: string): void;
  openDialog(dialog: SessionDialogIntent): void;
  changeMode(mode: ModeType): void | Promise<void>;
  compact(): void | Promise<void>;
  navigateTree(target: "parent" | "root"): void | Promise<void>;
  showError(message: string): void;
  shutdown(): Promise<void>;
  destroyRenderer(): void;
};

const COMMAND_INTENTS: Readonly<Record<string, SessionCommandIntent>> = {
  new: { type: "new-session" },
  agents: { type: "open-dialog", dialog: "agents" },
  models: { type: "open-dialog", dialog: "models" },
  providers: { type: "open-dialog", dialog: "providers" },
  sessions: { type: "open-dialog", dialog: "sessions" },
  tree: { type: "open-dialog", dialog: "tree" },
  jump: { type: "open-dialog", dialog: "jump" },
  parent: { type: "navigate-tree", target: "parent" },
  root: { type: "navigate-tree", target: "root" },
  compact: { type: "compact-context" },
  settings: { type: "open-dialog", dialog: "settings" },
  theme: { type: "open-dialog", dialog: "theme" },
  exit: { type: "exit" },
};

export function resolveSessionCommandIntent(intent: ComposerIntent): SessionCommandIntent {
  if (intent.type === "change-mode") return intent;
  const resolved = COMMAND_INTENTS[intent.commandName];
  if (!resolved) throw new Error(`Unsupported command ${intent.commandValue}`);
  return structuredClone(resolved) as SessionCommandIntent;
}

export function createSessionCommandRouter(dependencies: SessionCommandRouterDependencies) {
  return {
    async execute(intent: SessionCommandIntent): Promise<void> {
      switch (intent.type) {
        case "new-session":
          dependencies.navigate("/");
          return;
        case "open-dialog":
          dependencies.openDialog(intent.dialog);
          return;
        case "navigate-tree":
          await dependencies.navigateTree(intent.target);
          return;
        case "compact-context":
          await dependencies.compact();
          return;
        case "change-mode":
          await dependencies.changeMode(intent.mode);
          return;
        case "exit":
          try {
            await dependencies.shutdown();
          } catch (error) {
            dependencies.showError(
              `Exit cancelled safely: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
          }
          dependencies.destroyRenderer();
      }
    },
  };
}
