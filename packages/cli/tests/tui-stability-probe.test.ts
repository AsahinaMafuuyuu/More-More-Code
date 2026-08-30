import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTuiStabilityProbe } from "../src/tui/stability-probe";

describe("TUI stability diagnostics", () => {
  test("diagnostics are disabled by default", () => {
    const probe = createTuiStabilityProbe({
      bunVersion: "1.4.0",
      bunRevision: "abc123",
      opentuiVersion: "0.5.9",
      profile: "normal",
    });

    probe.recordStoreCommit("conversation");
    probe.recordCoalescedCommit();
    probe.recordActivityTick();

    expect(probe.enabled).toBe(false);
    expect(probe.snapshot()).toBeNull();
  });

  test("enabled diagnostics contain only bounded technical counters", () => {
    const probe = createTuiStabilityProbe({
      enabled: true,
      bunVersion: "1.4.0",
      bunRevision: "abc123",
      opentuiVersion: "0.5.9",
      profile: "normal",
      now: () => 2500,
      startedAtMs: 1000,
      readMemory: () => ({ rssBytes: 100, heapUsedBytes: 40 }),
    });

    probe.recordStoreCommit("conversation");
    probe.recordStoreCommit("status");
    probe.recordCoalescedCommit();
    probe.recordActivityTick();

    expect(probe.snapshot({ terminalWidth: 120, terminalHeight: 40 })).toEqual({
      bunVersion: "1.4.0",
      bunRevision: "abc123",
      opentuiVersion: "0.5.9",
      profile: "normal",
      elapsedMs: 1500,
      storeCommits: {
        conversation: 1,
        activity: 0,
        status: 1,
        composerRuntime: 0,
        approval: 0,
        recovery: 0,
        inspector: 0,
      },
      coalescedCommits: 1,
      activityTicks: 1,
      rssBytes: 100,
      heapUsedBytes: 40,
      terminalWidth: 120,
      terminalHeight: 40,
    });
  });

  test("probe source cannot grow raw prompt/message/tool payload fields", () => {
    const sourcePath = fileURLToPath(
      new URL("../src/tui/stability-probe.ts", import.meta.url),
    );
    const source = readFileSync(sourcePath, "utf8");
    for (const forbidden of [
      "prompt:",
      "messages:",
      "toolInput:",
      "toolOutput:",
      "providerPayload:",
      "credential:",
      "apiKey:",
      "fileContent:",
      "commandText:",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
