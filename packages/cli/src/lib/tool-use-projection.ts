import { getToolName, isToolUIPart } from "./chat-types";
import {
  projectSessionEntryPath,
  type ApprovalRequest,
  type SessionToolResultEntry,
  type SessionTreeState,
} from "@more-more-code/harness";
import type { AgentActivityView } from "./agent-activity-projection";
import type { Message } from "./chat-types";

type MessagePart = Message["parts"][number];
type ToolPart = Extract<MessagePart, { type: `tool-${string}` | "dynamic-tool" }>;

export type ToolUseStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "denied"
  | "approval_waiting"
  | "incomplete";

export type ToolUseDiagnostic =
  | "approval_required"
  | "missing_terminal"
  | "integrity_error";

export type ToolUseView = {
  toolCallId: string;
  toolName: string;
  status: ToolUseStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  source?: string;
  durationMs?: number;
  diagnostic?: ToolUseDiagnostic;
};

export type ToolUseProjectionInput = {
  messages: readonly Message[];
  sessionTree: SessionTreeState<Message>;
  activity?: AgentActivityView | null;
  pendingApprovals?: readonly ApprovalRequest[];
};

type SessionPathEntry = ReturnType<typeof projectSessionEntryPath<Message>>[number];
type ToolCallEntry = Extract<SessionPathEntry, { type: "tool_call" }>;
type ToolResultEntry = Extract<SessionPathEntry, { type: "tool_result" }>;

export type CanonicalToolUseIndex = Readonly<{
  calls: ReadonlyMap<string, ToolCallEntry>;
  results: ReadonlyMap<string, ToolResultEntry>;
  integrityIssues: ReadonlySet<string>;
}>;

/**
 * Session-path work is intentionally separated from chat streaming work. The
 * returned index is safe to memoize by SessionTree identity/revision and reuse
 * across arbitrarily many text/reasoning deltas.
 */
export function createCanonicalToolUseIndex(
  sessionTree: SessionTreeState<Message>,
): CanonicalToolUseIndex {
  const calls = new Map<string, ToolCallEntry>();
  const results = new Map<string, ToolResultEntry>();
  const integrityIssues = new Set<string>();

  for (const entry of projectSessionEntryPath(sessionTree)) {
    if (entry.type === "tool_call") {
      if (calls.has(entry.toolCallId)) integrityIssues.add(entry.toolCallId);
      else calls.set(entry.toolCallId, entry);
      continue;
    }
    if (entry.type !== "tool_result") continue;
    if (!calls.has(entry.toolCallId) || results.has(entry.toolCallId)) {
      integrityIssues.add(entry.toolCallId);
    }
    if (!results.has(entry.toolCallId)) results.set(entry.toolCallId, entry);
  }

  return { calls, results, integrityIssues };
}

export type ToolUseIndexedProjectionInput = {
  messages: readonly Message[];
  canonical: CanonicalToolUseIndex;
  activity?: AgentActivityView | null;
  pendingApprovals?: readonly ApprovalRequest[];
  /**
   * Compatibility mode for callers that require every canonical ToolUse. The
   * main Conversation UI leaves this false so output cardinality is bounded by
   * the materialized transcript + active runtime state.
   */
  includeAllCanonical?: boolean;
};

/**
 * Projects semantic ToolUse presentation from existing authorities without
 * creating a second durable terminal state. Canonical Session `tool_result`
 * wins over process-local/live hints; current Activity and Approval state are
 * used only while no canonical terminal exists.
 */
export function projectToolUses(input: ToolUseProjectionInput): Readonly<Record<string, ToolUseView>> {
  return projectToolUsesFromIndex({
    messages: input.messages,
    canonical: createCanonicalToolUseIndex(input.sessionTree),
    activity: input.activity,
    pendingApprovals: input.pendingApprovals,
    includeAllCanonical: true,
  });
}

export function projectToolUsesFromIndex(
  input: ToolUseIndexedProjectionInput,
): Readonly<Record<string, ToolUseView>> {
  const liveParts = new Map<string, ToolPart>();
  const localIntegrityIssues = new Set<string>();

  for (const message of input.messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if (liveParts.has(part.toolCallId)) localIntegrityIssues.add(part.toolCallId);
      else liveParts.set(part.toolCallId, part as ToolPart);
    }
  }

  const activeToolSteps = new Map<string, { toolName: string; durationMs?: number }>();
  for (const turn of input.activity?.turns ?? []) {
    for (const step of turn.steps) {
      if (step.kind !== "tool" || step.status !== "running" || !step.toolCallId) continue;
      activeToolSteps.set(step.toolCallId, {
        toolName: step.toolName ?? step.label,
        ...(step.elapsedMs !== undefined ? { durationMs: step.elapsedMs } : {}),
      });
    }
  }

  const approvals = new Map<string, ApprovalRequest>();
  for (const approval of input.pendingApprovals ?? []) {
    approvals.set(approval.toolCallId, approval);
  }

  const ids = new Set<string>([
    ...liveParts.keys(),
    ...activeToolSteps.keys(),
    ...approvals.keys(),
  ]);
  if (input.includeAllCanonical) {
    for (const id of input.canonical.calls.keys()) ids.add(id);
    for (const id of input.canonical.results.keys()) ids.add(id);
  }
  const projected: Record<string, ToolUseView> = {};

  for (const toolCallId of ids) {
    const part = liveParts.get(toolCallId);
    const call = input.canonical.calls.get(toolCallId);
    const result = input.canonical.results.get(toolCallId);
    const approval = approvals.get(toolCallId);
    const activeStep = activeToolSteps.get(toolCallId);
    const toolName = call?.toolName
      ?? approval?.toolName
      ?? activeStep?.toolName
      ?? (part ? getToolName(part) : undefined)
      ?? result?.toolName
      ?? "Tool";
    const common = {
      toolCallId,
      toolName,
      ...(call ? { input: call.input } : partInput(part) !== undefined ? { input: partInput(part) } : {}),
    };

    if (localIntegrityIssues.has(toolCallId) || input.canonical.integrityIssues.has(toolCallId)) {
      projected[toolCallId] = {
        ...common,
        status: "incomplete",
        diagnostic: "integrity_error",
      };
      continue;
    }

    if (result) {
      const terminal = projectCanonicalTerminal(result);
      projected[toolCallId] = {
        ...common,
        ...terminal,
      };
      continue;
    }

    if (approval) {
      projected[toolCallId] = {
        ...common,
        status: "approval_waiting",
        ...(activeStep?.durationMs !== undefined ? { durationMs: activeStep.durationMs } : {}),
      };
      continue;
    }

    if (activeStep) {
      projected[toolCallId] = {
        ...common,
        status: "running",
        ...(activeStep.durationMs !== undefined ? { durationMs: activeStep.durationMs } : {}),
      };
      continue;
    }

    if (call) {
      projected[toolCallId] = {
        ...common,
        status: "incomplete",
        diagnostic: "missing_terminal",
      };
      continue;
    }

    if (part) {
      projected[toolCallId] = {
        ...common,
        ...projectLivePart(part),
      };
    }
  }

  return projected;
}

function projectCanonicalTerminal(result: SessionToolResultEntry): Omit<ToolUseView, "toolCallId" | "toolName" | "input"> {
  const status = result.status ?? (result.error !== undefined ? "failed" : "completed");
  if (status === "approval_required") {
    return {
      status: "incomplete",
      diagnostic: "approval_required",
      ...(result.error ? { error: result.error } : {}),
      ...(result.source ? { source: result.source } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    };
  }

  return {
    status,
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.source ? { source: result.source } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
  };
}

function projectLivePart(part: ToolPart): Omit<ToolUseView, "toolCallId" | "toolName" | "input"> {
  switch (part.state) {
    case "output-available":
      return {
        status: "completed",
        output: part.output,
      };
    case "output-error":
      return {
        status: "failed",
        error: part.errorText,
      };
    case "output-denied":
      return { status: "denied" };
    default:
      return { status: "requested" };
  }
}

function partInput(part: ToolPart | undefined): unknown {
  if (!part || !("input" in part)) return undefined;
  return part.input;
}
