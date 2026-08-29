export type InteractionKey = "escape" | "enter" | "up" | "down" | "tab" | "follow-up" | "steering";

export type InteractionState = {
  dialog: boolean;
  overlay: "command" | "mention" | null;
  inspector: boolean;
  composer: boolean;
  runInterruptible: boolean;
  runActive?: boolean;
};

export type InteractionAction =
  | { target: "dialog"; action: "close-dialog" }
  | { target: "overlay"; action: "close-command" | "close-mention" | "select-command" | "select-mention" | "command-prev" | "command-next" | "mention-prev" | "mention-next" }
  | { target: "inspector"; action: "close-inspector" | "inspector-prev" | "inspector-next" | "inspector-select" }
  | { target: "composer"; action: "submit" | "toggle-mode" | "follow-up" | "steering" }
  | { target: "session"; action: "interrupt-run" };

export function resolveInteractionAction(
  key: InteractionKey,
  state: InteractionState,
): InteractionAction | null {
  if (state.dialog) {
    return key === "escape" ? { target: "dialog", action: "close-dialog" } : null;
  }

  if (state.overlay === "command") {
    if (key === "escape") return { target: "overlay", action: "close-command" };
    if (key === "enter") return { target: "overlay", action: "select-command" };
    if (key === "up") return { target: "overlay", action: "command-prev" };
    if (key === "down") return { target: "overlay", action: "command-next" };
    return null;
  }

  if (state.overlay === "mention") {
    if (key === "escape") return { target: "overlay", action: "close-mention" };
    if (key === "enter") return { target: "overlay", action: "select-mention" };
    if (key === "up") return { target: "overlay", action: "mention-prev" };
    if (key === "down") return { target: "overlay", action: "mention-next" };
    return null;
  }

  if (state.inspector) {
    if (key === "escape") return { target: "inspector", action: "close-inspector" };
    if (key === "up") return { target: "inspector", action: "inspector-prev" };
    if (key === "down") return { target: "inspector", action: "inspector-next" };
    if (key === "enter") return { target: "inspector", action: "inspector-select" };
    return null;
  }

  if (state.composer) {
    if (key === "enter") {
      return state.runActive
        ? { target: "composer", action: "follow-up" }
        : { target: "composer", action: "submit" };
    }
    if (key === "tab") return { target: "composer", action: "toggle-mode" };
    if (key === "follow-up" && state.runActive) return { target: "composer", action: "follow-up" };
    if (key === "steering" && state.runActive) return { target: "composer", action: "steering" };
  }

  if (key === "escape" && state.runInterruptible) {
    return { target: "session", action: "interrupt-run" };
  }
  return null;
}
