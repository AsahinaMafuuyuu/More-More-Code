import { describe, expect, test } from "bun:test";
import {
  createSessionCommandRouter,
  resolveSessionCommandIntent,
} from "../src/app/session/session-command-router";

describe("Session command router", () => {
  test("maps slash command metadata to one typed intent", () => {
    expect(resolveSessionCommandIntent({
      type: "command",
      commandName: "compact",
      commandValue: "/compact",
    })).toEqual({ type: "compact-context" });
    expect(resolveSessionCommandIntent({
      type: "change-mode",
      mode: "PLAN",
    })).toEqual({ type: "change-mode", mode: "PLAN" });
  });

  test("executes exactly one application action per intent", async () => {
    const calls: string[] = [];
    const router = createSessionCommandRouter({
      navigate: (path) => calls.push(`navigate:${path}`),
      openDialog: (dialog) => calls.push(`dialog:${dialog}`),
      changeMode: async (mode) => { calls.push(`mode:${mode}`); },
      compact: async () => { calls.push("compact"); },
      navigateTree: async (target) => { calls.push(`tree:${target}`); },
      showError: (message) => calls.push(`error:${message}`),
      shutdown: async () => { calls.push("shutdown"); },
      destroyRenderer: () => calls.push("destroy"),
    });

    await router.execute({ type: "compact-context" });
    expect(calls).toEqual(["compact"]);
  });

  test("exit preserves quiescence ordering and never destroys first", async () => {
    const calls: string[] = [];
    const router = createSessionCommandRouter({
      navigate: () => {},
      openDialog: () => {},
      changeMode: async () => {},
      compact: async () => {},
      navigateTree: async () => {},
      showError: (message) => calls.push(`error:${message}`),
      shutdown: async () => { calls.push("shutdown"); },
      destroyRenderer: () => calls.push("destroy"),
    });
    await router.execute({ type: "exit" });
    expect(calls).toEqual(["shutdown", "destroy"]);
  });

  test("failed shutdown leaves renderer alive and reports the failure", async () => {
    const calls: string[] = [];
    const router = createSessionCommandRouter({
      navigate: () => {},
      openDialog: () => {},
      changeMode: async () => {},
      compact: async () => {},
      navigateTree: async () => {},
      showError: (message) => calls.push(`error:${message}`),
      shutdown: async () => { calls.push("shutdown"); throw new Error("busy"); },
      destroyRenderer: () => calls.push("destroy"),
    });
    await router.execute({ type: "exit" });
    expect(calls).toEqual(["shutdown", "error:Exit cancelled safely: busy"]);
  });
});
