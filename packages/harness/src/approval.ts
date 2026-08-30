import type { PermissionRequest } from "./permission";

export type ApprovalDecision = "allow" | "deny";

export type ApprovalRequest = {
  approvalId: string;
  sessionId: string;
  runId: string;
  turnId: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
  requirements: readonly PermissionRequest[];
};

export type ApprovalResolution = {
  decision: ApprovalDecision;
};

export type ApprovalRequestOptions = {
  signal: AbortSignal;
};

export interface ApprovalBroker {
  request(
    request: ApprovalRequest,
    options: ApprovalRequestOptions,
  ): Promise<ApprovalResolution>;
}

export class ApprovalCancelledError extends Error {
  constructor(message = "Approval was cancelled") {
    super(message);
    this.name = "ApprovalCancelledError";
  }
}

export function isApprovalResolution(value: unknown): value is ApprovalResolution {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["decision"])
    && (value.decision === "allow" || value.decision === "deny");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
