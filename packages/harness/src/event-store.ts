/**
 * JSON-safe values are the only values that may cross the durable runtime
 * boundary. Adapters are responsible for serializing them, while the Harness
 * keeps the contract independent of a particular database or ORM.
 */
export type RuntimeJsonPrimitive = null | boolean | number | string;
export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };

export const RUNTIME_EVENT_TYPES = [
  "execution",
  "tool",
  "security",
  "context",
  "system",
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;
export const RUNTIME_SECURITY_EVENT_SCHEMA_VERSION = 2 as const;
export const RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION = 3 as const;

type RuntimeCorrelation = {
  runId?: string;
  turnId?: string;
  stepId?: string;
};

type PersistedExecutionEventOf<TEvent extends ExecutionEvent> = TEvent extends {
  error: string;
}
  ? Omit<TEvent, "error"> & { errorCode: "execution_failed" }
  : TEvent;

export type PersistedExecutionEvent = ExecutionEvent extends infer TEvent
  ? TEvent extends ExecutionEvent
    ? PersistedExecutionEventOf<TEvent>
    : never
  : never;

export type RuntimeExecutionEventPayload = {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  kind: "execution.lifecycle";
  event: PersistedExecutionEvent;
};

export type RuntimeToolStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "denied"
  | "approval_required";

type RuntimeToolEventBase = {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  kind: "tool.lifecycle";
  toolName: string;
  source: "native" | "mcp";
  toolCallId: string;
} & RuntimeCorrelation;

export type RuntimeToolEventPayload = RuntimeToolEventBase & (
  | { phase: "requested" }
  | { phase: "completed"; status: RuntimeToolStatus; durationMs: number }
);

export type RuntimeSecurityEventPayloadV1 = {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  kind: "permission.decision";
  capability: string;
  decision: "allow" | "deny" | "ask";
  policy: "default" | "configured";
  toolCallId: string;
} & RuntimeCorrelation;

type RuntimePermissionLifecycleBase = {
  schemaVersion: typeof RUNTIME_SECURITY_EVENT_SCHEMA_VERSION;
  kind: "permission.lifecycle";
  capability: string;
  resourceKind: "path" | "command" | "resource";
  scope: "workspace" | "outside-workspace" | "agent-config" | "external";
  toolCallId: string;
} & RuntimeCorrelation;

export type RuntimeSecurityEventPayloadV2 = RuntimePermissionLifecycleBase & (
  | { phase: "requested" }
  | {
      phase: "decided";
      decision: "allow" | "deny" | "ask";
      policy: "default" | "configured";
    }
);

export type RuntimeApprovalRequirement = {
  capability: string;
  resourceKind: "path" | "command" | "resource";
  scope: "workspace" | "outside-workspace" | "agent-config" | "external";
};

type RuntimeApprovalLifecycleBase = {
  schemaVersion: typeof RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION;
  kind: "approval.lifecycle";
  approvalId: string;
  requirements: RuntimeApprovalRequirement[];
  toolCallId: string;
} & RuntimeCorrelation;

export type RuntimeSecurityEventPayloadV3 = RuntimeApprovalLifecycleBase & (
  | { phase: "requested" }
  | { phase: "resolved"; decision: "allow" | "deny" }
  | { phase: "cancelled" }
  | { phase: "timed_out" }
);

export type RuntimeSecurityEventPayload =
  | RuntimeSecurityEventPayloadV1
  | RuntimeSecurityEventPayloadV2
  | RuntimeSecurityEventPayloadV3;

export type RuntimeContextEventPayload = {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  kind: "context.projection";
  phase: "started" | "completed";
  operationId: string;
  operation: "model-step" | "manual-compaction";
  mode: string;
  model: string;
  inputTokensBefore?: number;
  inputTokensAfter?: number;
  inputBudgetTokens?: number;
  toolResultTokensBefore?: number;
  toolResultTokensAfter?: number;
  prunedToolResultCount?: number;
  overBudget?: boolean;
  compactionTrigger?: string;
} & RuntimeCorrelation;

export type RuntimeSystemEventPayload = {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  kind: "runtime.session_opened";
  recoveredEventOffset: number;
  incompleteRunCount: number;
  pendingExternalOperationCount: number;
};

/**
 * Payloads are versioned, allowlisted envelopes. Model prompts, Tool
 * input/output, command text, file contents, and arbitrary error text do not
 * cross this interface.
 */
export interface RuntimeEventPayloadByType {
  execution: RuntimeExecutionEventPayload;
  tool: RuntimeToolEventPayload;
  security: RuntimeSecurityEventPayload;
  context: RuntimeContextEventPayload;
  system: RuntimeSystemEventPayload;
}

export type RuntimeEventInput<TType extends RuntimeEventType = RuntimeEventType> = {
  [T in TType]: {
    sessionId: string;
    type: T;
    payload: RuntimeEventPayloadByType[T];
  };
}[TType];

/**
 * `offset` is a database-assigned, globally monotonic position. `timestamp`
 * is Unix time in milliseconds, mapped by adapters from their durable
 * `createdAt` column.
 */
export type RuntimeEvent<TType extends RuntimeEventType = RuntimeEventType> =
  RuntimeEventInput<TType> & {
    id: string;
    offset: number;
    timestamp: number;
  };

export interface RuntimeSnapshotInput<TState extends RuntimeJsonValue = RuntimeJsonValue> {
  sessionId: string;
  eventOffset: number;
  state: TState;
}

/** `timestamp` uses the same Unix-millisecond representation as RuntimeEvent. */
export interface RuntimeSnapshot<TState extends RuntimeJsonValue = RuntimeJsonValue>
  extends RuntimeSnapshotInput<TState> {
  id: string;
  timestamp: number;
}

export interface EventStore {
  append<TType extends RuntimeEventType>(
    event: RuntimeEventInput<TType>,
  ): Promise<RuntimeEvent<TType>>;
  listAfter(sessionId: string, eventOffset: number): Promise<RuntimeEvent[]>;
}

export interface RuntimeSnapshotStore<TState extends RuntimeJsonValue = RuntimeJsonValue> {
  saveSnapshot(input: RuntimeSnapshotInput<TState>): Promise<RuntimeSnapshot<TState>>;
  latestSnapshot(sessionId: string): Promise<RuntimeSnapshot<TState> | null>;
}

export interface RuntimeStore<TState extends RuntimeJsonValue = RuntimeJsonValue>
  extends EventStore,
    RuntimeSnapshotStore<TState> {}

export function isRuntimeEventType(value: unknown): value is RuntimeEventType {
  return typeof value === "string" && (RUNTIME_EVENT_TYPES as readonly string[]).includes(value);
}

export function isRuntimeEventPayload<TType extends RuntimeEventType>(
  type: TType,
  value: unknown,
): value is RuntimeEventPayloadByType[TType] {
  if (!isRecord(value)) {
    return false;
  }
  if (type !== "security" && value.schemaVersion !== RUNTIME_EVENT_SCHEMA_VERSION) {
    return false;
  }

  switch (type) {
    case "execution":
      return hasOnlyKeys(value, ["schemaVersion", "kind", "event"])
        && value.kind === "execution.lifecycle"
        && isPersistedExecutionEvent(value.event);
    case "tool":
      return value.kind === "tool.lifecycle"
        && (value.phase === "requested" || value.phase === "completed")
        && isNonEmptyString(value.toolName)
        && (value.source === "native" || value.source === "mcp")
        && isNonEmptyString(value.toolCallId)
        && hasValidCorrelation(value)
        && (value.phase === "requested"
          ? hasOnlyKeys(value, [
            "schemaVersion", "kind", "phase", "toolName", "source", "toolCallId",
            "runId", "turnId", "stepId",
          ])
          : hasOnlyKeys(value, [
            "schemaVersion", "kind", "phase", "toolName", "source", "toolCallId",
            "status", "durationMs", "runId", "turnId", "stepId",
          ])
            && isRuntimeToolStatus(value.status)
            && isNonNegativeNumber(value.durationMs));
    case "security":
      return isRuntimeSecurityEventPayload(value);
    case "context":
      return value.kind === "context.projection"
        && (value.phase === "started" || value.phase === "completed")
        && isNonEmptyString(value.operationId)
        && (value.operation === "model-step" || value.operation === "manual-compaction")
        && isNonEmptyString(value.mode)
        && isNonEmptyString(value.model)
        && hasValidCorrelation(value)
        && (value.phase === "started"
          ? hasOnlyKeys(value, [
            "schemaVersion", "kind", "phase", "operationId", "operation", "mode", "model",
            "runId", "turnId", "stepId",
          ])
          : hasOnlyKeys(value, [
            "schemaVersion", "kind", "phase", "operationId", "operation", "mode", "model",
            "inputTokensBefore", "inputTokensAfter", "inputBudgetTokens",
            "toolResultTokensBefore", "toolResultTokensAfter", "prunedToolResultCount",
            "overBudget", "compactionTrigger", "runId", "turnId", "stepId",
          ])
            && optionalNonNegativeNumber(value.inputTokensBefore)
            && optionalNonNegativeNumber(value.inputTokensAfter)
            && optionalNonNegativeNumber(value.inputBudgetTokens)
            && optionalNonNegativeNumber(value.toolResultTokensBefore)
            && optionalNonNegativeNumber(value.toolResultTokensAfter)
            && optionalNonNegativeNumber(value.prunedToolResultCount)
            && (value.overBudget === undefined || typeof value.overBudget === "boolean")
            && optionalCompactionTrigger(value.compactionTrigger));
    case "system":
      return hasOnlyKeys(value, [
        "schemaVersion", "kind", "recoveredEventOffset", "incompleteRunCount",
        "pendingExternalOperationCount",
      ])
        && value.kind === "runtime.session_opened"
        && isNonNegativeSafeInteger(value.recoveredEventOffset)
        && isNonNegativeSafeInteger(value.incompleteRunCount)
        && isNonNegativeSafeInteger(value.pendingExternalOperationCount);
  }
}

function isRuntimeSecurityEventPayload(
  value: Record<string, unknown>,
): value is RuntimeSecurityEventPayload {
  if (value.schemaVersion === RUNTIME_EVENT_SCHEMA_VERSION) {
    return hasOnlyKeys(value, [
      "schemaVersion", "kind", "capability", "decision", "policy", "toolCallId",
      "runId", "turnId", "stepId",
    ])
      && value.kind === "permission.decision"
      && isNonEmptyString(value.capability)
      && isPermissionEffect(value.decision)
      && isPermissionPolicySource(value.policy)
      && isNonEmptyString(value.toolCallId)
      && hasValidCorrelation(value);
  }

  if (value.schemaVersion === RUNTIME_APPROVAL_EVENT_SCHEMA_VERSION) {
    if (value.kind !== "approval.lifecycle"
      || !isNonEmptyString(value.approvalId)
      || !isRuntimeApprovalRequirements(value.requirements)
      || !isNonEmptyString(value.toolCallId)
      || !hasValidCorrelation(value)
      || (value.phase !== "requested"
        && value.phase !== "resolved"
        && value.phase !== "cancelled"
        && value.phase !== "timed_out")) {
      return false;
    }

    if (value.phase === "resolved") {
      return hasOnlyKeys(value, [
        "schemaVersion", "kind", "phase", "approvalId", "requirements",
        "decision", "toolCallId", "runId", "turnId", "stepId",
      ])
        && (value.decision === "allow" || value.decision === "deny");
    }

    return hasOnlyKeys(value, [
      "schemaVersion", "kind", "phase", "approvalId", "requirements",
      "toolCallId", "runId", "turnId", "stepId",
    ]);
  }

  if (value.schemaVersion !== RUNTIME_SECURITY_EVENT_SCHEMA_VERSION
    || value.kind !== "permission.lifecycle"
    || (value.phase !== "requested" && value.phase !== "decided")
    || !isNonEmptyString(value.capability)
    || !isPermissionResourceKind(value.resourceKind)
    || !isPermissionScope(value.scope)
    || !isNonEmptyString(value.toolCallId)
    || !hasValidCorrelation(value)) {
    return false;
  }

  if (value.phase === "requested") {
    return hasOnlyKeys(value, [
      "schemaVersion", "kind", "phase", "capability", "resourceKind", "scope",
      "toolCallId", "runId", "turnId", "stepId",
    ]);
  }

  return hasOnlyKeys(value, [
    "schemaVersion", "kind", "phase", "capability", "resourceKind", "scope",
    "decision", "policy", "toolCallId", "runId", "turnId", "stepId",
  ])
    && isPermissionEffect(value.decision)
    && isPermissionPolicySource(value.policy);
}

function isRuntimeApprovalRequirements(value: unknown): value is RuntimeApprovalRequirement[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((requirement) => isRecord(requirement)
      && hasOnlyKeys(requirement, ["capability", "resourceKind", "scope"])
      && isNonEmptyString(requirement.capability)
      && isPermissionResourceKind(requirement.resourceKind)
      && isPermissionScope(requirement.scope));
}

export function isRuntimeJsonValue(value: unknown): value is RuntimeJsonValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (Array.isArray(value)) {
        return value.every(isRuntimeJsonValue);
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return false;
      }

      return Object.values(value).every(isRuntimeJsonValue);
    }
    default:
      return false;
  }
}

function isPersistedExecutionEvent(value: unknown): value is PersistedExecutionEvent {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.type)
    || !isNonNegativeSafeInteger(value.sequence)
    || !isNonNegativeNumber(value.timestamp)
    || !isNonEmptyString(value.sessionId)
    || !isNonEmptyString(value.runId)) {
    return false;
  }

  switch (value.type) {
    case "run.started":
    case "run.completed":
    case "run.interrupted":
      return hasOnlyExecutionKeys(value);
    case "run.failed":
      return hasOnlyExecutionKeys(value, "errorCode")
        && value.errorCode === "execution_failed";
    case "turn.started":
      return hasOnlyExecutionKeys(
        value,
        "turnId", "turnIndex", "cause", "inputMessageId", "interactionId",
      )
        && isNonEmptyString(value.turnId)
        && isNonNegativeSafeInteger(value.turnIndex)
        && ["initial", "tool-continuation", "steering", "follow-up"].includes(String(value.cause))
        && optionalString(value.inputMessageId)
        && optionalString(value.interactionId);
    case "turn.completed":
    case "turn.interrupted":
      return hasOnlyExecutionKeys(value, "turnId")
        && isNonEmptyString(value.turnId);
    case "turn.failed":
      return hasOnlyExecutionKeys(value, "turnId", "errorCode")
        && isNonEmptyString(value.turnId)
        && value.errorCode === "execution_failed";
    case "step.started":
      return hasOnlyExecutionKeys(
        value,
        "turnId", "stepId", "stepIndex", "stepKind",
        ...(value.stepKind === "tool" ? ["toolCallId", "toolName"] : []),
      )
        && isNonEmptyString(value.turnId)
        && isNonEmptyString(value.stepId)
        && isNonNegativeSafeInteger(value.stepIndex)
        && (value.stepKind === "model"
          || (value.stepKind === "tool"
            && isNonEmptyString(value.toolCallId)
            && isNonEmptyString(value.toolName)));
    case "step.completed":
    case "step.interrupted":
      return hasOnlyExecutionKeys(value, "turnId", "stepId")
        && isNonEmptyString(value.turnId)
        && isNonEmptyString(value.stepId);
    case "step.failed":
      return hasOnlyExecutionKeys(value, "turnId", "stepId", "errorCode")
        && isNonEmptyString(value.turnId)
        && isNonEmptyString(value.stepId)
        && value.errorCode === "execution_failed";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeNumber(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasValidCorrelation(value: Record<string, unknown>): boolean {
  return optionalNonEmptyString(value.runId)
    && optionalNonEmptyString(value.turnId)
    && optionalNonEmptyString(value.stepId);
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isRuntimeToolStatus(value: unknown): value is RuntimeToolStatus {
  return value === "completed"
    || value === "failed"
    || value === "cancelled"
    || value === "timed_out"
    || value === "denied"
    || value === "approval_required";
}

function optionalCompactionTrigger(value: unknown): boolean {
  return value === undefined
    || value === "soft-limit"
    || value === "hard-limit"
    || value === "overflow"
    || value === "manual";
}

function isPermissionEffect(value: unknown): boolean {
  return value === "allow" || value === "deny" || value === "ask";
}

function isPermissionPolicySource(value: unknown): boolean {
  return value === "default" || value === "configured";
}

function isPermissionResourceKind(value: unknown): boolean {
  return value === "path" || value === "command" || value === "resource";
}

function isPermissionScope(value: unknown): boolean {
  return value === "workspace"
    || value === "outside-workspace"
    || value === "agent-config"
    || value === "external";
}

function hasOnlyExecutionKeys(
  value: Record<string, unknown>,
  ...additionalKeys: string[]
): boolean {
  return hasOnlyKeys(value, [
    "id", "type", "sequence", "timestamp", "sessionId", "runId",
    ...additionalKeys,
  ]);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}
import type { ExecutionEvent } from "./execution-events";
