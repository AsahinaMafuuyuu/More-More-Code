import { describe, expect, test } from "bun:test";
import {
  projectSecurityAuditTimeline,
  type RuntimeEvent,
} from "../src/index";

let nextOffset = 1;

function runtimeEvent(
  type: RuntimeEvent["type"],
  payload: RuntimeEvent["payload"],
  options: { sessionId?: string; offset?: number } = {},
): RuntimeEvent {
  const offset = options.offset ?? nextOffset++;
  return {
    id: `event-${offset}`,
    offset,
    timestamp: offset * 100,
    sessionId: options.sessionId ?? "session-one",
    type,
    payload,
  } as RuntimeEvent;
}

const correlation = {
  runId: "run-one",
  turnId: "turn-one",
  stepId: "step-one",
  toolCallId: "tool-one",
};

describe("security audit projection", () => {
  test("pairs v2 permission lifecycle events and verifies an allowed tool terminal", () => {
    nextOffset = 1;
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "filesystem.read",
        resourceKind: "path",
        scope: "workspace",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "filesystem.read",
        resourceKind: "path",
        scope: "workspace",
        decision: "allow",
        policy: "configured",
        ...correlation,
      }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "readFile",
        source: "native",
        status: "completed",
        durationMs: 4,
        ...correlation,
      }),
    ]);

    expect(timeline.inconsistentCount).toBe(0);
    expect(timeline.entries).toEqual([expect.objectContaining({
      schemaVersion: 2,
      capability: "filesystem.read",
      resourceKind: "path",
      scope: "workspace",
      decision: "allow",
      policy: "configured",
      requestedOffset: 1,
      decidedOffset: 2,
      terminalOffset: 3,
      toolStatus: "completed",
      status: "complete",
      issues: [],
    })]);
  });

  test("marks an unmatched request as pending without inventing a decision", () => {
    nextOffset = 1;
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "filesystem.write",
        resourceKind: "path",
        scope: "workspace",
        ...correlation,
      }),
    ]);

    expect(timeline.entries[0]).toEqual(expect.objectContaining({
      status: "pending",
      decision: undefined,
      issues: ["missing_decision"],
    }));
  });

  test("detects lifecycle metadata mismatches, duplicate decisions, and orphan decisions", () => {
    nextOffset = 1;
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "filesystem.read",
        resourceKind: "path",
        scope: "workspace",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "filesystem.read",
        resourceKind: "command",
        scope: "external",
        decision: "deny",
        policy: "configured",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "filesystem.read",
        resourceKind: "command",
        scope: "external",
        decision: "deny",
        policy: "configured",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "process.execute",
        resourceKind: "command",
        scope: "workspace",
        decision: "deny",
        policy: "configured",
        ...correlation,
      }),
    ]);

    expect(timeline.inconsistentCount).toBe(2);
    expect(timeline.entries.find((entry) => entry.capability === "filesystem.read")?.issues)
      .toEqual(expect.arrayContaining(["metadata_mismatch", "duplicate_decision"]));
    expect(timeline.entries.find((entry) => entry.capability === "process.execute")?.issues)
      .toContain("orphan_decision");
  });

  test("verifies deny, ask, and allow terminal invariants", () => {
    nextOffset = 1;
    const makeLifecycle = (
      capability: string,
      decision: "allow" | "deny" | "ask",
      status: "completed" | "denied" | "approval_required",
      toolCallId: string,
    ) => [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability,
        resourceKind: "command",
        scope: "workspace",
        ...correlation,
        toolCallId,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability,
        resourceKind: "command",
        scope: "workspace",
        decision,
        policy: "configured",
        ...correlation,
        toolCallId,
      }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "bash",
        source: "native",
        status,
        durationMs: 1,
        ...correlation,
        toolCallId,
      }),
    ] as RuntimeEvent[];

    const timeline = projectSecurityAuditTimeline("session-one", [
      ...makeLifecycle("process.deny", "deny", "completed", "tool-deny"),
      ...makeLifecycle("process.ask", "ask", "denied", "tool-ask"),
      ...makeLifecycle("process.allow", "allow", "approval_required", "tool-allow"),
    ]);

    expect(timeline.inconsistentCount).toBe(3);
    expect(timeline.entries.find((entry) => entry.capability === "process.deny")?.issues)
      .toContain("deny_must_not_execute");
    expect(timeline.entries.find((entry) => entry.capability === "process.ask")?.issues)
      .toContain("ask_requires_approval");
    expect(timeline.entries.find((entry) => entry.capability === "process.allow")?.issues)
      .toContain("allow_cannot_be_policy_blocked");
  });

  test("preserves schema-v1 decisions as legacy audit entries", () => {
    nextOffset = 1;
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 1,
        kind: "permission.decision",
        capability: "filesystem.read",
        decision: "allow",
        policy: "default",
        ...correlation,
      }),
    ]);

    expect(timeline.entries).toEqual([expect.objectContaining({
      schemaVersion: 1,
      capability: "filesystem.read",
      decision: "allow",
      status: "legacy",
      decidedOffset: 1,
    })]);
    expect(timeline.entries[0]).not.toHaveProperty("requestedOffset");
  });

  test("rejects foreign-session events instead of mixing audit histories", () => {
    nextOffset = 1;
    expect(() => projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 1,
        kind: "permission.decision",
        capability: "filesystem.read",
        decision: "allow",
        policy: "default",
        ...correlation,
      }, { sessionId: "session-two" }),
    ])).toThrow("foreign Runtime Event");
  });
  test("detects reversed ordering, duplicate requests or terminals, and missing terminals", () => {
    nextOffset = 1;
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "reverse",
        resourceKind: "command",
        scope: "workspace",
        decision: "allow",
        policy: "configured",
        ...correlation,
        toolCallId: "tool-reverse",
      }, { offset: 1 }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "reverse",
        resourceKind: "command",
        scope: "workspace",
        ...correlation,
        toolCallId: "tool-reverse",
      }, { offset: 2 }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "bash",
        source: "native",
        status: "completed",
        durationMs: 1,
        ...correlation,
        toolCallId: "tool-reverse",
      }, { offset: 3 }),

      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "duplicate-request",
        resourceKind: "path",
        scope: "workspace",
        ...correlation,
        toolCallId: "tool-duplicate-request",
      }, { offset: 4 }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "duplicate-request",
        resourceKind: "path",
        scope: "workspace",
        ...correlation,
        toolCallId: "tool-duplicate-request",
      }, { offset: 5 }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "duplicate-request",
        resourceKind: "path",
        scope: "workspace",
        decision: "allow",
        policy: "configured",
        ...correlation,
        toolCallId: "tool-duplicate-request",
      }, { offset: 6 }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "readFile",
        source: "native",
        status: "completed",
        durationMs: 1,
        ...correlation,
        toolCallId: "tool-duplicate-request",
      }, { offset: 7 }),

      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "missing-terminal",
        resourceKind: "resource",
        scope: "agent-config",
        ...correlation,
        toolCallId: "tool-missing-terminal",
      }, { offset: 8 }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "missing-terminal",
        resourceKind: "resource",
        scope: "agent-config",
        decision: "allow",
        policy: "configured",
        ...correlation,
        toolCallId: "tool-missing-terminal",
      }, { offset: 9 }),

      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        capability: "duplicate-terminal",
        resourceKind: "command",
        scope: "workspace",
        ...correlation,
        toolCallId: "tool-duplicate-terminal",
      }, { offset: 10 }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        capability: "duplicate-terminal",
        resourceKind: "command",
        scope: "workspace",
        decision: "allow",
        policy: "configured",
        ...correlation,
        toolCallId: "tool-duplicate-terminal",
      }, { offset: 11 }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "bash",
        source: "native",
        status: "completed",
        durationMs: 1,
        ...correlation,
        toolCallId: "tool-duplicate-terminal",
      }, { offset: 12 }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "bash",
        source: "native",
        status: "completed",
        durationMs: 2,
        ...correlation,
        toolCallId: "tool-duplicate-terminal",
      }, { offset: 13 }),
    ]);

    expect(timeline.inconsistentCount).toBe(3);
    expect(timeline.pendingCount).toBe(1);
    expect(timeline.entries.find((entry) => entry.capability === "reverse")?.issues)
      .toContain("decision_before_request");
    expect(timeline.entries.find((entry) => entry.capability === "duplicate-request")?.issues)
      .toContain("duplicate_request");
    expect(timeline.entries.find((entry) => entry.capability === "missing-terminal"))
      .toEqual(expect.objectContaining({
        status: "pending",
        issues: ["missing_terminal"],
      }));
    expect(timeline.entries.find((entry) => entry.capability === "duplicate-terminal")?.issues)
      .toContain("duplicate_terminal");
  });

  test("accepts ask -> approval allow -> executor completion", () => {
    nextOffset = 1;
    const requirement = {
      capability: "process.execute",
      resourceKind: "command" as const,
      scope: "workspace" as const,
    };
    const requirements = [requirement];
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        ...requirement,
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        ...requirement,
        decision: "ask",
        policy: "configured",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 3,
        kind: "approval.lifecycle",
        phase: "requested",
        approvalId: "approval-one",
        requirements,
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 3,
        kind: "approval.lifecycle",
        phase: "resolved",
        approvalId: "approval-one",
        requirements,
        decision: "allow",
        ...correlation,
      }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "bash",
        source: "native",
        status: "completed",
        durationMs: 2,
        ...correlation,
      }),
    ]);

    expect(timeline.inconsistentCount).toBe(0);
    expect(timeline.pendingCount).toBe(0);
    expect(timeline.entries[0]).toEqual(expect.objectContaining({
      decision: "ask",
      toolStatus: "completed",
      status: "complete",
      issues: [],
    }));
    expect(timeline.approvals).toEqual([expect.objectContaining({
      approvalId: "approval-one",
      outcome: "allow",
      status: "complete",
      requestedOffset: 3,
      terminalOffset: 4,
      issues: [],
    })]);
  });

  test.each([
    ["deny", "denied"],
    ["cancelled", "cancelled"],
    ["timed_out", "timed_out"],
  ] as const)("reconciles approval %s with the matching Tool terminal", (outcome, toolStatus) => {
    nextOffset = 1;
    const requirement = {
      capability: "filesystem.write",
      resourceKind: "path" as const,
      scope: "workspace" as const,
    };
    const requirements = [requirement];
    const terminalApproval = outcome === "deny"
      ? {
          schemaVersion: 3 as const,
          kind: "approval.lifecycle" as const,
          phase: "resolved" as const,
          approvalId: "approval-one",
          requirements,
          decision: "deny" as const,
          ...correlation,
        }
      : {
          schemaVersion: 3 as const,
          kind: "approval.lifecycle" as const,
          phase: outcome,
          approvalId: "approval-one",
          requirements,
          ...correlation,
        };

    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        ...requirement,
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        ...requirement,
        decision: "ask",
        policy: "configured",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 3,
        kind: "approval.lifecycle",
        phase: "requested",
        approvalId: "approval-one",
        requirements,
        ...correlation,
      }),
      runtimeEvent("security", terminalApproval),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "writeFile",
        source: "native",
        status: toolStatus,
        durationMs: 2,
        ...correlation,
      }),
    ]);

    expect(timeline.inconsistentCount).toBe(0);
    expect(timeline.approvals[0]).toEqual(expect.objectContaining({
      outcome,
      status: "complete",
    }));
  });

  test("flags approval lifecycle and Tool-terminal mismatches", () => {
    nextOffset = 1;
    const requirement = {
      capability: "process.execute",
      resourceKind: "command" as const,
      scope: "workspace" as const,
    };
    const requirements = [requirement];
    const timeline = projectSecurityAuditTimeline("session-one", [
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "requested",
        ...requirement,
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 2,
        kind: "permission.lifecycle",
        phase: "decided",
        ...requirement,
        decision: "ask",
        policy: "configured",
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 3,
        kind: "approval.lifecycle",
        phase: "requested",
        approvalId: "approval-one",
        requirements,
        ...correlation,
      }),
      runtimeEvent("security", {
        schemaVersion: 3,
        kind: "approval.lifecycle",
        phase: "resolved",
        approvalId: "approval-one",
        requirements: [{
          capability: "process.execute",
          resourceKind: "resource",
          scope: "external",
        }],
        decision: "deny",
        ...correlation,
      }),
      runtimeEvent("tool", {
        schemaVersion: 1,
        kind: "tool.lifecycle",
        phase: "completed",
        toolName: "bash",
        source: "native",
        status: "completed",
        durationMs: 2,
        ...correlation,
      }),
    ]);

    expect(timeline.inconsistentCount).toBeGreaterThanOrEqual(1);
    expect(timeline.approvals[0]?.issues).toContain("approval_metadata_mismatch");
    expect(timeline.entries[0]?.issues).toContain("approval_tool_terminal_mismatch");
  });

});
