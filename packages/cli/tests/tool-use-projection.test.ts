import { describe, expect, test } from "bun:test";
import {
  appendSessionEntry,
  createSessionTree,
  type ApprovalRequest,
  type SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "../src/lib/chat-types";
import type { AgentActivityView } from "../src/lib/agent-activity-projection";
import { projectToolUses } from "../src/lib/tool-use-projection";

function options() {
  let id = 0;
  let now = 100;
  return {
    createId: () => `entry-${++id}`,
    now: () => ++now,
  };
}

function toolMessage(
  state: "input-available" | "output-available" | "output-error" | "output-denied" = "input-available",
): Message {
  const base = {
    type: "dynamic-tool" as const,
    toolName: "bash",
    toolCallId: "call-1",
    input: { command: "bun test" },
  };
  const part = state === "output-available"
    ? { ...base, state, output: "ok" }
    : state === "output-error"
      ? { ...base, state, errorText: "boom" }
      : state === "output-denied"
        ? {
            ...base,
            state,
            approval: { id: "sdk-approval", approved: false as const },
          }
        : { ...base, state };

  return {
    id: "assistant-1",
    role: "assistant",
    parts: [part],
  };
}

function stateWithCall(): {
  state: SessionTreeState<Message>;
  options: ReturnType<typeof options>;
} {
  const deterministic = options();
  let state = createSessionTree<Message>([], deterministic);
  state = appendSessionEntry(state, {
    type: "assistant_message",
    messageId: "assistant-1",
    message: toolMessage(),
  }, deterministic);
  state = appendSessionEntry(state, {
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "bash",
    input: { command: "bun test" },
    runId: "run-1",
    turnId: "turn-1",
    stepId: "step-tool",
  }, deterministic);
  return { state, options: deterministic };
}

function runningActivity(): AgentActivityView {
  return {
    runId: "run-1",
    status: "running",
    turns: [{
      id: "turn-1",
      index: 0,
      cause: "initial",
      status: "running",
      active: true,
      steps: [{
        id: "step-tool",
        index: 0,
        kind: "tool",
        label: "Bash",
        status: "running",
        active: true,
        toolCallId: "call-1",
        toolName: "bash",
      }],
    }],
  };
}

function approval(): ApprovalRequest {
  return {
    approvalId: "approval-1",
    sessionId: "session-1",
    runId: "run-1",
    turnId: "turn-1",
    stepId: "step-tool",
    toolCallId: "call-1",
    toolName: "bash",
    requirements: [],
  };
}

describe("ToolUse projection", () => {
  test("moves requested -> running -> approval_waiting using only current presentation seams", () => {
    const emptyState = createSessionTree<Message>([], options());
    expect(projectToolUses({
      messages: [toolMessage()],
      sessionTree: emptyState,
    })["call-1"]?.status).toBe("requested");

    const { state } = stateWithCall();
    expect(projectToolUses({
      messages: [toolMessage()],
      sessionTree: state,
      activity: runningActivity(),
    })["call-1"]?.status).toBe("running");

    expect(projectToolUses({
      messages: [toolMessage()],
      sessionTree: state,
      activity: runningActivity(),
      pendingApprovals: [approval()],
    })["call-1"]?.status).toBe("approval_waiting");
  });

  test.each([
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["timed_out", "timed_out"],
    ["denied", "denied"],
  ] as const)("canonical %s Tool result wins over stale live state", (canonicalStatus, expected) => {
    const { state: callState, options: deterministic } = stateWithCall();
    const state = appendSessionEntry(callState, {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "bash",
      status: canonicalStatus,
      output: canonicalStatus === "completed" ? "canonical output" : undefined,
      error: canonicalStatus === "completed" ? undefined : `ended ${canonicalStatus}`,
      source: "native",
      durationMs: 240,
      runId: "run-1",
      turnId: "turn-1",
      stepId: "step-tool",
    }, deterministic);

    expect(projectToolUses({
      messages: [toolMessage("input-available")],
      sessionTree: state,
      activity: runningActivity(),
      pendingApprovals: [approval()],
    })["call-1"]).toMatchObject({
      status: expected,
      input: { command: "bun test" },
      source: "native",
      durationMs: 240,
    });
  });

  test("historical approval_required and orphaned canonical calls fail closed as incomplete", () => {
    const { state: callState, options: deterministic } = stateWithCall();
    const approvalRequired = appendSessionEntry(callState, {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "bash",
      status: "approval_required",
      error: "approval required",
      runId: "run-1",
      turnId: "turn-1",
      stepId: "step-tool",
    }, deterministic);

    expect(projectToolUses({
      messages: [toolMessage()],
      sessionTree: approvalRequired,
    })["call-1"]).toMatchObject({
      status: "incomplete",
      diagnostic: "approval_required",
    });

    expect(projectToolUses({
      messages: [toolMessage()],
      sessionTree: callState,
    })["call-1"]).toMatchObject({
      status: "incomplete",
      diagnostic: "missing_terminal",
    });
  });

  test("live output remains a fallback only when no canonical terminal exists", () => {
    const emptyState = createSessionTree<Message>([], options());
    expect(projectToolUses({
      messages: [toolMessage("output-available")],
      sessionTree: emptyState,
    })["call-1"]).toMatchObject({
      status: "completed",
      output: "ok",
    });

    expect(projectToolUses({
      messages: [toolMessage("output-error")],
      sessionTree: emptyState,
    })["call-1"]).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });
});
