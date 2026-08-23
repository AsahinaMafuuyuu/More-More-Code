import type {
  PermissionEffect,
  PermissionPolicySource,
  PermissionResourceKind,
  PermissionScope,
} from "./permission";
import type {
  RuntimeApprovalRequirement,
  RuntimeEvent,
  RuntimeSecurityEventPayloadV1,
  RuntimeSecurityEventPayloadV2,
  RuntimeSecurityEventPayloadV3,
  RuntimeToolEventPayload,
  RuntimeToolStatus,
} from "./event-store";

export type SecurityAuditIssue =
  | "missing_decision"
  | "missing_terminal"
  | "orphan_decision"
  | "duplicate_request"
  | "duplicate_decision"
  | "decision_before_request"
  | "metadata_mismatch"
  | "duplicate_terminal"
  | "deny_must_not_execute"
  | "ask_requires_approval"
  | "allow_cannot_be_policy_blocked"
  | "multiple_approvals"
  | "approval_requirement_mismatch"
  | "approval_tool_terminal_mismatch";

export type ApprovalAuditIssue =
  | "missing_approval_terminal"
  | "orphan_approval_terminal"
  | "duplicate_approval_request"
  | "duplicate_approval_terminal"
  | "approval_terminal_before_request"
  | "approval_metadata_mismatch";

export type ApprovalAuditOutcome = "allow" | "deny" | "cancelled" | "timed_out";

export type SecurityAuditStatus =
  | "complete"
  | "pending"
  | "legacy"
  | "inconsistent";

export type SecurityAuditEntry = {
  schemaVersion: 1 | 2;
  sessionId: string;
  runId?: string;
  turnId?: string;
  stepId?: string;
  toolCallId: string;
  capability: string;
  resourceKind?: PermissionResourceKind;
  scope?: PermissionScope;
  decision?: PermissionEffect;
  policy?: PermissionPolicySource;
  requestedOffset?: number;
  decidedOffset?: number;
  terminalOffset?: number;
  toolStatus?: RuntimeToolStatus;
  status: SecurityAuditStatus;
  issues: SecurityAuditIssue[];
};

export type ApprovalAuditEntry = {
  schemaVersion: 3;
  sessionId: string;
  runId?: string;
  turnId?: string;
  stepId?: string;
  toolCallId: string;
  approvalId: string;
  requirements: RuntimeApprovalRequirement[];
  outcome?: ApprovalAuditOutcome;
  requestedOffset?: number;
  terminalOffset?: number;
  status: Exclude<SecurityAuditStatus, "legacy">;
  issues: ApprovalAuditIssue[];
};

export type SecurityAuditTimeline = {
  sessionId: string;
  entries: SecurityAuditEntry[];
  approvals: ApprovalAuditEntry[];
  inconsistentCount: number;
  pendingCount: number;
  legacyCount: number;
};

type SecurityRuntimeEvent = RuntimeEvent<"security">;
type ToolRuntimeEvent = RuntimeEvent<"tool"> & {
  payload: Extract<RuntimeToolEventPayload, { phase: "completed" }>;
};

type V2Group = {
  toolKey: string;
  requests: Array<SecurityRuntimeEvent & {
    payload: Extract<RuntimeSecurityEventPayloadV2, { phase: "requested" }>;
  }>;
  decisions: Array<SecurityRuntimeEvent & {
    payload: Extract<RuntimeSecurityEventPayloadV2, { phase: "decided" }>;
  }>;
};

type V3Group = {
  toolKey: string;
  approvalId: string;
  requests: Array<SecurityRuntimeEvent & {
    payload: Extract<RuntimeSecurityEventPayloadV3, { phase: "requested" }>;
  }>;
  terminals: Array<SecurityRuntimeEvent & {
    payload: Exclude<RuntimeSecurityEventPayloadV3, { phase: "requested" }>;
  }>;
};

type InternalAuditEntry = SecurityAuditEntry & {
  toolKey: string;
};

type InternalApprovalAuditEntry = ApprovalAuditEntry & {
  toolKey: string;
};

export function projectSecurityAuditTimeline(
  sessionId: string,
  events: readonly RuntimeEvent[],
): SecurityAuditTimeline {
  if (!sessionId.trim()) {
    throw new Error("Security audit projection requires a non-empty sessionId");
  }

  const ordered = [...events].sort((left, right) => left.offset - right.offset);
  for (const event of ordered) {
    if (event.sessionId !== sessionId) {
      throw new Error(
        `Security audit projection received foreign Runtime Event ${event.id}`,
      );
    }
  }

  const groups = new Map<string, V2Group>();
  const approvalGroups = new Map<string, V3Group>();
  const entries: InternalAuditEntry[] = [];
  const approvals: InternalApprovalAuditEntry[] = [];
  const terminals = new Map<string, ToolRuntimeEvent[]>();

  for (const event of ordered) {
    if (event.type === "tool" && event.payload.phase === "completed") {
      const key = toolCorrelationKey(event.payload);
      const existing = terminals.get(key) ?? [];
      existing.push(event as ToolRuntimeEvent);
      terminals.set(key, existing);
      continue;
    }

    if (event.type !== "security") continue;

    if (event.payload.schemaVersion === 1) {
      entries.push(createLegacyEntry(event as SecurityRuntimeEvent & {
        payload: RuntimeSecurityEventPayloadV1;
      }));
      continue;
    }

    if (event.payload.schemaVersion === 3) {
      const key = approvalCorrelationKey(event.payload);
      const group = approvalGroups.get(key) ?? {
        toolKey: toolCorrelationKey(event.payload),
        approvalId: event.payload.approvalId,
        requests: [],
        terminals: [],
      };
      if (event.payload.phase === "requested") {
        group.requests.push(event as V3Group["requests"][number]);
      } else {
        group.terminals.push(event as V3Group["terminals"][number]);
      }
      approvalGroups.set(key, group);
      continue;
    }

    const key = permissionCorrelationKey(event.payload);
    const group = groups.get(key) ?? {
      toolKey: toolCorrelationKey(event.payload),
      requests: [],
      decisions: [],
    };
    if (event.payload.phase === "requested") {
      group.requests.push(event as V2Group["requests"][number]);
    } else {
      group.decisions.push(event as V2Group["decisions"][number]);
    }
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    entries.push(createV2Entry(sessionId, group));
  }
  for (const group of approvalGroups.values()) {
    approvals.push(createApprovalEntry(sessionId, group));
  }

  applyToolTerminalVerification(entries, approvals, terminals);

  entries.sort((left, right) => {
    const leftOffset = left.requestedOffset ?? left.decidedOffset ?? Number.MAX_SAFE_INTEGER;
    const rightOffset = right.requestedOffset ?? right.decidedOffset ?? Number.MAX_SAFE_INTEGER;
    return leftOffset - rightOffset || left.capability.localeCompare(right.capability);
  });
  approvals.sort((left, right) => {
    const leftOffset = left.requestedOffset ?? left.terminalOffset ?? Number.MAX_SAFE_INTEGER;
    const rightOffset = right.requestedOffset ?? right.terminalOffset ?? Number.MAX_SAFE_INTEGER;
    return leftOffset - rightOffset || left.approvalId.localeCompare(right.approvalId);
  });

  const publicEntries = entries.map(({ toolKey: _toolKey, ...entry }) => entry);
  const publicApprovals = approvals.map(({ toolKey: _toolKey, ...entry }) => entry);
  return {
    sessionId,
    entries: publicEntries,
    approvals: publicApprovals,
    inconsistentCount:
      publicEntries.filter((entry) => entry.status === "inconsistent").length
      + publicApprovals.filter((entry) => entry.status === "inconsistent").length,
    pendingCount:
      publicEntries.filter((entry) => entry.status === "pending").length
      + publicApprovals.filter((entry) => entry.status === "pending").length,
    legacyCount: publicEntries.filter((entry) => entry.status === "legacy").length,
  };
}

function createV2Entry(
  sessionId: string,
  group: V2Group,
): InternalAuditEntry {
  const request = group.requests[0];
  const decision = group.decisions[0];
  const source = request?.payload ?? decision?.payload;
  if (!source) {
    throw new Error("Security audit group has no lifecycle events");
  }

  const issues: SecurityAuditIssue[] = [];
  if (group.requests.length === 0) issues.push("orphan_decision");
  if (group.requests.length > 1) issues.push("duplicate_request");
  if (group.decisions.length === 0) issues.push("missing_decision");
  if (group.decisions.length > 1) issues.push("duplicate_decision");

  if (request && decision) {
    if (decision.offset < request.offset) {
      issues.push("decision_before_request");
    }
    if (request.payload.resourceKind !== decision.payload.resourceKind
      || request.payload.scope !== decision.payload.scope) {
      issues.push("metadata_mismatch");
    }
  }

  const entry: InternalAuditEntry = {
    schemaVersion: 2,
    sessionId,
    ...copyCorrelation(source),
    toolCallId: source.toolCallId,
    capability: source.capability,
    resourceKind: request?.payload.resourceKind ?? decision?.payload.resourceKind,
    scope: request?.payload.scope ?? decision?.payload.scope,
    decision: decision?.payload.decision,
    policy: decision?.payload.policy,
    requestedOffset: request?.offset,
    decidedOffset: decision?.offset,
    status: "complete",
    issues,
    toolKey: group.toolKey,
  };
  entry.status = resolveEntryStatus(entry);
  return entry;
}

function createLegacyEntry(
  event: SecurityRuntimeEvent & { payload: RuntimeSecurityEventPayloadV1 },
): InternalAuditEntry {
  return {
    schemaVersion: 1,
    sessionId: event.sessionId,
    ...copyCorrelation(event.payload),
    toolCallId: event.payload.toolCallId,
    capability: event.payload.capability,
    decision: event.payload.decision,
    policy: event.payload.policy,
    decidedOffset: event.offset,
    status: "legacy",
    issues: [],
    toolKey: toolCorrelationKey(event.payload),
  };
}

function createApprovalEntry(
  sessionId: string,
  group: V3Group,
): InternalApprovalAuditEntry {
  const request = group.requests[0];
  const terminal = group.terminals[0];
  const source = request?.payload ?? terminal?.payload;
  if (!source) {
    throw new Error("Security audit approval group has no lifecycle events");
  }

  const issues: ApprovalAuditIssue[] = [];
  if (group.requests.length === 0) issues.push("orphan_approval_terminal");
  if (group.requests.length > 1) issues.push("duplicate_approval_request");
  if (group.terminals.length === 0) issues.push("missing_approval_terminal");
  if (group.terminals.length > 1) issues.push("duplicate_approval_terminal");

  if (request && terminal) {
    if (terminal.offset < request.offset) {
      issues.push("approval_terminal_before_request");
    }
    if (!sameApprovalRequirements(request.payload.requirements, terminal.payload.requirements)) {
      issues.push("approval_metadata_mismatch");
    }
  }

  const entry: InternalApprovalAuditEntry = {
    schemaVersion: 3,
    sessionId,
    ...copyCorrelation(source),
    toolCallId: source.toolCallId,
    approvalId: source.approvalId,
    requirements: structuredClone(request?.payload.requirements ?? terminal?.payload.requirements ?? []),
    ...(terminal ? { outcome: approvalOutcome(terminal.payload) } : {}),
    ...(request ? { requestedOffset: request.offset } : {}),
    ...(terminal ? { terminalOffset: terminal.offset } : {}),
    status: "complete",
    issues,
    toolKey: group.toolKey,
  };
  entry.status = resolveApprovalStatus(entry);
  return entry;
}

function applyToolTerminalVerification(
  entries: InternalAuditEntry[],
  approvals: InternalApprovalAuditEntry[],
  terminals: Map<string, ToolRuntimeEvent[]>,
): void {
  const byTool = new Map<string, InternalAuditEntry[]>();
  for (const entry of entries) {
    const toolEntries = byTool.get(entry.toolKey) ?? [];
    toolEntries.push(entry);
    byTool.set(entry.toolKey, toolEntries);
  }

  const approvalsByTool = new Map<string, InternalApprovalAuditEntry[]>();
  for (const approval of approvals) {
    const toolApprovals = approvalsByTool.get(approval.toolKey) ?? [];
    toolApprovals.push(approval);
    approvalsByTool.set(approval.toolKey, toolApprovals);
  }

  for (const [toolKey, toolEntries] of byTool) {
    const terminalEvents = terminals.get(toolKey) ?? [];
    const terminal = terminalEvents[0];
    const toolApprovals = approvalsByTool.get(toolKey) ?? [];

    if (terminalEvents.length > 1) {
      for (const entry of toolEntries) addIssue(entry, "duplicate_terminal");
    }

    if (terminal) {
      for (const entry of toolEntries) {
        entry.terminalOffset = terminal.offset;
        entry.toolStatus = terminal.payload.status;
      }
    }

    const v2DecidedEntries = toolEntries.filter(
      (entry) => entry.schemaVersion === 2 && entry.decision !== undefined,
    );
    if (!terminal && v2DecidedEntries.length > 0) {
      for (const entry of v2DecidedEntries) addIssue(entry, "missing_terminal");
    }

    const decisions = toolEntries
      .map((entry) => entry.decision)
      .filter((decision): decision is PermissionEffect => decision !== undefined);
    if (terminal && decisions.length > 0) {
      if (decisions.includes("deny")) {
        if (terminal.payload.status !== "denied") {
          for (const entry of toolEntries) addIssue(entry, "deny_must_not_execute");
        }
      } else if (decisions.includes("ask")) {
        if (toolApprovals.length === 0) {
          if (terminal.payload.status !== "approval_required") {
            for (const entry of toolEntries) addIssue(entry, "ask_requires_approval");
          }
        } else {
          if (toolApprovals.length > 1) {
            for (const entry of toolEntries) addIssue(entry, "multiple_approvals");
          }
          const approval = toolApprovals[0]!;
          const askRequirements = toolEntries
            .filter((entry) => entry.decision === "ask")
            .flatMap((entry) => entry.resourceKind && entry.scope
              ? [{
                  capability: entry.capability,
                  resourceKind: entry.resourceKind,
                  scope: entry.scope,
                }]
              : []);
          if (!sameApprovalRequirements(askRequirements, approval.requirements)) {
            for (const entry of toolEntries) addIssue(entry, "approval_requirement_mismatch");
          }

          const expectedStatus = expectedToolStatusForApproval(approval.outcome);
          if (expectedStatus === "execute") {
            if (terminal.payload.status === "denied"
              || terminal.payload.status === "approval_required") {
              for (const entry of toolEntries) addIssue(entry, "approval_tool_terminal_mismatch");
            }
          } else if (expectedStatus && terminal.payload.status !== expectedStatus) {
            for (const entry of toolEntries) addIssue(entry, "approval_tool_terminal_mismatch");
          }
        }
      } else if (terminal.payload.status === "denied"
        || terminal.payload.status === "approval_required") {
        for (const entry of toolEntries) addIssue(entry, "allow_cannot_be_policy_blocked");
      }
    }

    for (const entry of toolEntries) {
      entry.status = resolveEntryStatus(entry);
    }
  }
}

function expectedToolStatusForApproval(
  outcome: ApprovalAuditOutcome | undefined,
): RuntimeToolStatus | "execute" | undefined {
  switch (outcome) {
    case "allow":
      return "execute";
    case "deny":
      return "denied";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    default:
      return undefined;
  }
}

function approvalOutcome(
  payload: Exclude<RuntimeSecurityEventPayloadV3, { phase: "requested" }>,
): ApprovalAuditOutcome {
  if (payload.phase === "resolved") return payload.decision;
  return payload.phase;
}

function resolveApprovalStatus(
  entry: ApprovalAuditEntry,
): Exclude<SecurityAuditStatus, "legacy"> {
  if (entry.issues.length === 0) return "complete";
  if (entry.issues.length === 1 && entry.issues[0] === "missing_approval_terminal") {
    return "pending";
  }
  return "inconsistent";
}

function sameApprovalRequirements(
  left: readonly RuntimeApprovalRequirement[],
  right: readonly RuntimeApprovalRequirement[],
): boolean {
  const normalize = (requirements: readonly RuntimeApprovalRequirement[]) => requirements
    .map((requirement) => `${requirement.capability}\u0000${requirement.resourceKind}\u0000${requirement.scope}`)
    .sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function resolveEntryStatus(entry: SecurityAuditEntry): SecurityAuditStatus {
  if (entry.schemaVersion === 1) {
    return entry.issues.length > 0 ? "inconsistent" : "legacy";
  }

  const pendingOnly = entry.issues.every(
    (issue) => issue === "missing_decision" || issue === "missing_terminal",
  );
  if (entry.issues.length > 0 && !pendingOnly) return "inconsistent";
  if (entry.issues.includes("missing_decision") || entry.issues.includes("missing_terminal")) {
    return "pending";
  }
  return "complete";
}

function addIssue(entry: SecurityAuditEntry, issue: SecurityAuditIssue): void {
  if (!entry.issues.includes(issue)) entry.issues.push(issue);
}

function permissionCorrelationKey(payload: RuntimeSecurityEventPayloadV2): string {
  return `${toolCorrelationKey(payload)}\u0000${payload.capability}`;
}

function approvalCorrelationKey(payload: RuntimeSecurityEventPayloadV3): string {
  return `${toolCorrelationKey(payload)}\u0000${payload.approvalId}`;
}

function toolCorrelationKey(payload: {
  runId?: string;
  turnId?: string;
  stepId?: string;
  toolCallId: string;
}): string {
  return [
    payload.runId ?? "",
    payload.turnId ?? "",
    payload.stepId ?? "",
    payload.toolCallId,
  ].join("\u0000");
}

function copyCorrelation(payload: {
  runId?: string;
  turnId?: string;
  stepId?: string;
}): Pick<SecurityAuditEntry, "runId" | "turnId" | "stepId"> {
  return {
    ...(payload.runId ? { runId: payload.runId } : {}),
    ...(payload.turnId ? { turnId: payload.turnId } : {}),
    ...(payload.stepId ? { stepId: payload.stepId } : {}),
  };
}
