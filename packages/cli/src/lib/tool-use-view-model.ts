import { formatActivityDuration } from "./activity-view-model";
import { formatActivityToolName } from "./agent-activity-projection";
import type {
  ToolUseDiagnostic,
  ToolUseStatus,
  ToolUseView,
} from "./tool-use-projection";

export type ToolUseStatusDisplay = {
  glyph: string;
  label: string;
};

export type ToolUseDisplay = {
  collapsed: string;
  status: ToolUseStatusDisplay;
  detailLines: string[];
};

export function createToolUseDisplay(view: ToolUseView, width: number): ToolUseDisplay {
  const safeWidth = Math.max(20, Math.floor(width));
  const status = formatToolUseStatus(view.status);
  const toolName = formatActivityToolName(view.toolName);
  const duration = formatActivityDuration(view.durationMs);
  const statusTail = [status.label, duration].filter(Boolean).join(" · ");
  const inputSummary = summarizeToolInput(view.input);

  let collapsed = `${toolName} · ${statusTail}`;
  if (safeWidth >= 72 && inputSummary) {
    const fixedLength = toolName.length + statusTail.length + 6;
    const inputBudget = Math.max(8, safeWidth - fixedLength);
    collapsed = `${toolName} · ${boundText(inputSummary, inputBudget)} · ${statusTail}`;
  }
  collapsed = boundText(collapsed, safeWidth);

  const detailLines: string[] = [];
  if (hasOwn(view, "input")) {
    detailLines.push(boundDetailLine("input", safeDetail(view.input)));
  }
  if (hasOwn(view, "output")) {
    detailLines.push(boundDetailLine("output", safeDetail(view.output)));
  }
  if (view.error) {
    detailLines.push(boundDetailLine("error", normalizeWhitespace(view.error)));
  }
  if (view.source || duration) {
    detailLines.push(boundDetailLine(
      "runtime",
      [view.source, duration].filter(Boolean).join(" · "),
    ));
  }
  if (view.diagnostic) {
    detailLines.push(boundDetailLine("diagnostic", diagnosticText(view.diagnostic)));
  }

  return { collapsed, status, detailLines };
}

export function formatToolUseStatus(status: ToolUseStatus): ToolUseStatusDisplay {
  switch (status) {
    case "requested":
      return { glyph: "○", label: "requested" };
    case "running":
      return { glyph: "●", label: "running" };
    case "completed":
      return { glyph: "✓", label: "completed" };
    case "failed":
      return { glyph: "×", label: "failed" };
    case "cancelled":
      return { glyph: "■", label: "cancelled" };
    case "timed_out":
      return { glyph: "◷", label: "timed out" };
    case "denied":
      return { glyph: "⊘", label: "denied" };
    case "approval_waiting":
      return { glyph: "?", label: "approval waiting" };
    case "incomplete":
      return { glyph: "!", label: "incomplete" };
  }
}

function summarizeToolInput(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return normalizeWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) return boundText(safeDetail(value), 120);
  if (typeof value === "object") {
    const primitives = Object.values(value as Record<string, unknown>)
      .filter((candidate) => (
        typeof candidate === "string"
        || typeof candidate === "number"
        || typeof candidate === "boolean"
      ))
      .map((candidate) => normalizeWhitespace(String(candidate)))
      .filter(Boolean);
    if (primitives.length > 0) return primitives.join(" ");
  }
  return safeDetail(value);
}

function safeDetail(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return String(value);
    return normalizeWhitespace(serialized);
  } catch {
    return "[detail unavailable]";
  }
}

function diagnosticText(diagnostic: ToolUseDiagnostic) {
  switch (diagnostic) {
    case "approval_required":
      return "historical approval was required; this transaction cannot be resumed";
    case "integrity_error":
      return "canonical ToolUse integrity check failed; terminal state is not trusted";
    case "missing_terminal":
      return "durable tool call has no matching terminal result; automatic replay is disabled";
  }
}

function boundDetailLine(label: string, value: string) {
  const prefix = `${label}  `;
  return `${prefix}${boundText(value, Math.max(1, 500 - prefix.length))}`;
}

function boundText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
