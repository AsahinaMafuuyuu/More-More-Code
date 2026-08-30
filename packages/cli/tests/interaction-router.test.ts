import { describe, expect, test } from "bun:test";
import { resolveInteractionAction } from "../src/ui/session/interaction/interaction-router";

describe("Interaction Router", () => {
  test("Escape follows dialog > overlay > inspector > run priority", () => {
    expect(resolveInteractionAction("escape", {
      dialog: true,
      overlay: "command",
      inspector: true,
      composer: true,
      runInterruptible: true,
    })).toEqual({ target: "dialog", action: "close-dialog" });

    expect(resolveInteractionAction("escape", {
      dialog: false,
      overlay: "mention",
      inspector: true,
      composer: true,
      runInterruptible: true,
    })).toEqual({ target: "overlay", action: "close-mention" });

    expect(resolveInteractionAction("escape", {
      dialog: false,
      overlay: null,
      inspector: true,
      composer: true,
      runInterruptible: true,
    })).toEqual({ target: "inspector", action: "close-inspector" });

    expect(resolveInteractionAction("escape", {
      dialog: false,
      overlay: null,
      inspector: false,
      composer: true,
      runInterruptible: true,
    })).toEqual({ target: "session", action: "interrupt-run" });
  });

  test("overlay Enter/arrows and modal follow-up never leak to Composer", () => {
    const command = {
      dialog: false,
      overlay: "command" as const,
      inspector: false,
      composer: true,
      runInterruptible: true,
    };
    expect(resolveInteractionAction("enter", command)).toEqual({ target: "overlay", action: "select-command" });
    expect(resolveInteractionAction("down", command)).toEqual({ target: "overlay", action: "command-next" });
    expect(resolveInteractionAction("follow-up", { ...command, dialog: true })).toBeNull();
  });

  test("base Composer maps Enter by runtime state and reserves steering for an active Run", () => {
    const base = {
      dialog: false,
      overlay: null,
      inspector: false,
      composer: true,
      runInterruptible: true,
    };
    expect(resolveInteractionAction("tab", base)).toEqual({ target: "composer", action: "toggle-mode" });
    expect(resolveInteractionAction("enter", base)).toEqual({ target: "composer", action: "submit" });
    expect(resolveInteractionAction("steering", base)).toBeNull();

    const active = { ...base, runActive: true };
    expect(resolveInteractionAction("enter", active)).toEqual({ target: "composer", action: "follow-up" });
    expect(resolveInteractionAction("follow-up", active)).toEqual({ target: "composer", action: "follow-up" });
    expect(resolveInteractionAction("steering", active)).toEqual({ target: "composer", action: "steering" });
  });
});
