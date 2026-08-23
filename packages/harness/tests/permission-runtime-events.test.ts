import { describe, expect, test } from "bun:test";
import {
  isRuntimeEventPayload,
  RUNTIME_EVENT_SCHEMA_VERSION,
  RUNTIME_SECURITY_EVENT_SCHEMA_VERSION,
  type RuntimeSecurityEventPayloadV1,
  type RuntimeSecurityEventPayloadV2,
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
});
