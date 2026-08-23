import { describe, expect, test } from "bun:test";
import type { ApprovalRequest } from "@more-more-code/harness";
import { InteractiveApprovalBroker } from "../src/lib/interactive-approval-broker";

function approvalRequest(approvalId = "approval-one"): ApprovalRequest {
  return {
    approvalId,
    sessionId: "session-one",
    runId: "run-one",
    turnId: "turn-one",
    stepId: "step-one",
    toolCallId: "tool-one",
    toolName: "bash",
    requirements: [{
      capability: "process.execute",
      resource: {
        kind: "command",
        value: "git push origin main",
        scope: "workspace",
      },
    }],
  };
}

describe("InteractiveApprovalBroker", () => {
  test("publishes a pending request and resolves it exactly once", async () => {
    const broker = new InteractiveApprovalBroker();
    const snapshots: string[][] = [];
    const unsubscribe = broker.subscribe((pending) => {
      snapshots.push(pending.map((request) => request.approvalId));
    });

    const pending = broker.request(approvalRequest(), {
      signal: new AbortController().signal,
    });

    expect(broker.getPending().map((request) => request.approvalId)).toEqual(["approval-one"]);
    expect(broker.resolve("missing", "allow")).toBe(false);
    expect(broker.resolve("approval-one", "allow")).toBe(true);
    expect(broker.resolve("approval-one", "deny")).toBe(false);
    expect(await pending).toEqual({ decision: "allow" });
    expect(broker.getPending()).toEqual([]);
    expect(snapshots).toEqual([[], ["approval-one"], []]);
    unsubscribe();
  });

  test("removes and rejects a pending approval when its signal aborts", async () => {
    const broker = new InteractiveApprovalBroker();
    const controller = new AbortController();
    const pending = broker.request(approvalRequest(), { signal: controller.signal });

    controller.abort(new Error("approval cancelled"));

    await expect(pending).rejects.toThrow("approval cancelled");
    expect(broker.getPending()).toEqual([]);
  });

  test("cancels all pending approvals when the owning Session unmounts", async () => {
    const broker = new InteractiveApprovalBroker();
    const first = broker.request(approvalRequest("approval-one"), {
      signal: new AbortController().signal,
    });
    const second = broker.request(approvalRequest("approval-two"), {
      signal: new AbortController().signal,
    });

    broker.cancelAll(new Error("session closed"));

    await expect(first).rejects.toThrow("session closed");
    await expect(second).rejects.toThrow("session closed");
    expect(broker.getPending()).toEqual([]);
  });

  test("cancels one dialog-dismissed approval without touching another pending transaction", async () => {
    const broker = new InteractiveApprovalBroker();
    const first = broker.request(approvalRequest("approval-one"), {
      signal: new AbortController().signal,
    });
    const second = broker.request(approvalRequest("approval-two"), {
      signal: new AbortController().signal,
    });

    expect(broker.cancel("approval-one", "dialog dismissed")).toBe(true);
    await expect(first).rejects.toThrow("dialog dismissed");
    expect(broker.getPending().map((request) => request.approvalId)).toEqual(["approval-two"]);

    expect(broker.resolve("approval-two", "deny")).toBe(true);
    expect(await second).toEqual({ decision: "deny" });
  });
});
