import { describe, expect, test } from "bun:test";
import {
  isRuntimeEventPayload,
  RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
  RUNTIME_EVENT_SCHEMA_VERSION,
  RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
  type RuntimeSecurityEventPayloadV1,
  type RuntimeSecurityEventPayloadV2,
  type RuntimeSecurityEventPayloadV3,
} from "../src";

const legacySecurityEvent: RuntimeSecurityEventPayloadV1 = {
  schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
  kind: "permission.decision",
  capability: "filesystem.read",
  decision: "allow",
  policy: "default",
  toolCallId: "tool-call-legacy",
  runId: "run-legacy",
};

const requestedSecurityEvent: RuntimeSecurityEventPayloadV2 = {
  schemaVersion: RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
  kind: "permission.lifecycle",
  phase: "requested",
  capability: "filesystem.read",
  resourceKind: "path",
  scope: "workspace",
  toolCallId: "tool-call-requested",
  runId: "run-v2",
  turnId: "turn-v2",
};

const decidedSecurityEvent: RuntimeSecurityEventPayloadV2 = {
  schemaVersion: RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
  kind: "permission.lifecycle",
  phase: "decided",
  capability: "process.execute",
  resourceKind: "command",
  scope: "workspace",
  decision: "deny",
  policy: "configured",
  toolCallId: "tool-call-decided",
  runId: "run-v2",
  turnId: "turn-v2",
  stepId: "step-v2",
};

const approvalRequestedEvent: RuntimeSecurityEventPayloadV3 = {
  schemaVersion: RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION,
  kind: "approval.lifecycle",
  phase: "requested",
  approvalId: "approval-one",
  requirements: [
    {
      capability: "process.execute",
      resourceKind: "command",
      scope: "workspace",
    },
  ],
  toolCallId: "tool-call-approval",
  runId: "run-approval",
  turnId: "turn-approval",
  stepId: "step-approval",
};

describe("runtime security event schemas", () => {
  test("keeps schema v1 permission decisions backward compatible", () => {
    expect(isRuntimeEventPayload("security", legacySecurityEvent)).toBe(true);
  });

  test("accepts schema v2 requested and decided lifecycle events", () => {
    expect(isRuntimeEventPayload("security", requestedSecurityEvent)).toBe(true);
    expect(isRuntimeEventPayload("security", decidedSecurityEvent)).toBe(true);
  });

  test.each(["command", "path", "value", "unknown"])(
    "rejects schema v2 payloads containing raw or unknown %s fields",
    (field) => {
      const payload = {
        ...requestedSecurityEvent,
        [field]: field === "unknown" ? "unexpected" : "raw user input",
      };

      expect(isRuntimeEventPayload("security", payload)).toBe(false);
    },
  );

  test("accepts schema v3 approval requested and terminal lifecycle events", () => {
    expect(isRuntimeEventPayload("security", approvalRequestedEvent)).toBe(true);
    expect(isRuntimeEventPayload("security", {
      ...approvalRequestedEvent,
      phase: "resolved",
      decision: "allow",
    })).toBe(true);
    expect(isRuntimeEventPayload("security", {
      ...approvalRequestedEvent,
      phase: "cancelled",
    })).toBe(true);
    expect(isRuntimeEventPayload("security", {
      ...approvalRequestedEvent,
      phase: "timed_out",
    })).toBe(true);
  });

  test("rejects raw values and unknown fields from approval lifecycle events", () => {
    expect(isRuntimeEventPayload("security", {
      ...approvalRequestedEvent,
      requirements: [{
        ...approvalRequestedEvent.requirements[0],
        value: "git push origin main",
      }],
    })).toBe(false);
    expect(isRuntimeEventPayload("security", {
      ...approvalRequestedEvent,
      command: "git push origin main",
    })).toBe(false);
  });
});
