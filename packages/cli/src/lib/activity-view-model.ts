import type { AgentRunStatus } from "@more-more-code/harness";
import type {
  ActivityStepView,
  ActivityTurnView,
  AgentActivityView,
} from "./agent-activity-projection";

export type ActivityDisplayRow = {
  key: string;
  kind: "turn" | "step" | "omitted";
  text: string;
  status?: AgentRunStatus;
  turnId?: string;
  active?: boolean;
  expandable?: boolean;
  expanded?: boolean;
};

export type ActivityDisplayOptions = {
  width: number;
  showHistory?: boolean;
  maxTurns?: number;
  maxStepsPerTurn?: number;
  turnExpansion?: Readonly<Record<string, boolean | undefined>>;
};

export function formatActivityHeader(activity: AgentActivityView, width: number) {
  if (width < 72) return `Activity · ${activity.status}`;
  const duration = formatActivityDuration(activity.elapsedMs);
  return `Agent Activity · ${activity.status}${duration ? ` · ${duration}` : ""}`;
}

export function createActivityRows(
  activity: AgentActivityView,
  options: ActivityDisplayOptions,
): ActivityDisplayRow[] {
  const width = Math.max(1, Math.floor(options.width));
  const turns = selectVisibleTurns(activity.turns, {
    showHistory: options.showHistory ?? true,
    maxTurns: options.maxTurns ?? 4,
  });
  const rows: ActivityDisplayRow[] = [];
  const omittedTurnCount = activity.turns.length - turns.length;

  if (omittedTurnCount > 0) {
    rows.push({
      key: "turns:omitted",
      kind: "omitted",
      text: `… ${omittedTurnCount} earlier ${omittedTurnCount === 1 ? "turn" : "turns"}`,
    });
  }

  const latestTurnId = activity.turns.at(-1)?.id;
  for (const turn of turns) {
    const defaultExpanded = turn.id === latestTurnId
      || turn.active
      || turn.status === "failed"
      || turn.status === "interrupted";
    const expanded = options.turnExpansion?.[turn.id] ?? defaultExpanded;

    rows.push({
      key: `turn:${turn.id}`,
      kind: "turn",
      turnId: turn.id,
      status: turn.status,
      expandable: turn.steps.length > 0,
      expanded,
      text: formatTurnLine(turn, width),
    });

    if (!expanded) continue;
    const stepRows = createStepRows(turn, width, options.maxStepsPerTurn ?? 4);
    rows.push(...stepRows);
  }

  return rows;
}

function selectVisibleTurns(
  turns: readonly ActivityTurnView[],
  options: { showHistory: boolean; maxTurns: number },
) {
  const maxTurns = Math.max(1, Math.floor(options.maxTurns));
  const latestTurn = turns.at(-1);
  const mustKeep = new Set(
    turns
      .filter((turn) => (
        turn.id === latestTurn?.id
        || turn.status === "failed"
        || turn.status === "interrupted"
      ))
      .map((turn) => turn.id),
  );

  let candidates = options.showHistory
    ? [...turns]
    : turns.filter((turn) => mustKeep.has(turn.id));

  if (candidates.length <= maxTurns) return candidates;

  const selectedIds = new Set<string>();
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index]!;
    if (mustKeep.has(turn.id)) selectedIds.add(turn.id);
  }
  for (let index = candidates.length - 1; index >= 0 && selectedIds.size < maxTurns; index -= 1) {
    selectedIds.add(candidates[index]!.id);
  }

  candidates = candidates.filter((turn) => selectedIds.has(turn.id));
  return candidates;
}

function createStepRows(
  turn: ActivityTurnView,
  width: number,
  maxStepsPerTurn: number,
): ActivityDisplayRow[] {
  const maxSteps = Math.max(1, Math.floor(maxStepsPerTurn));
  const steps = turn.steps.length <= maxSteps
    ? turn.steps
    : turn.steps.slice(-maxSteps);
  const rows: ActivityDisplayRow[] = [];

  if (turn.steps.length > steps.length) {
    const omitted = turn.steps.length - steps.length;
    rows.push({
      key: `steps:${turn.id}:omitted`,
      kind: "omitted",
      turnId: turn.id,
      text: `  … ${omitted} earlier ${omitted === 1 ? "step" : "steps"}`,
    });
  }

  for (const step of steps) {
    rows.push({
      key: `step:${step.id}`,
      kind: "step",
      turnId: turn.id,
      status: step.status,
      active: step.active,
      text: formatStepLine(step, width),
    });
  }

  return rows;
}

function formatTurnLine(turn: ActivityTurnView, width: number) {
  const turnNumber = turn.index + 1;
  if (width < 72) return `Turn ${turnNumber} · ${turn.status}`;

  const cause = formatTurnCause(turn.cause);
  const duration = formatActivityDuration(turn.elapsedMs);
  const stepCount = `${turn.steps.length} ${turn.steps.length === 1 ? "step" : "steps"}`;
  return [
    `Turn ${turnNumber}`,
    cause,
    turn.status,
    stepCount,
    duration,
  ].filter(Boolean).join(" · ");
}

function formatStepLine(step: ActivityStepView, width: number) {
  const glyph = statusGlyph(step.status);
  if (width < 72) return `${glyph} ${step.label} · ${step.status}`;

  const duration = formatActivityDuration(step.elapsedMs);
  const progress = formatProgress(step);
  return [
    `${glyph} ${step.label}`,
    step.status,
    duration,
    progress,
  ].filter(Boolean).join(" · ");
}

function formatProgress(step: ActivityStepView) {
  if (!step.progress) return "";
  const numeric = step.progress.completed !== undefined && step.progress.total !== undefined
    ? `${step.progress.completed}/${step.progress.total}`
    : "";
  return [step.progress.message, numeric].filter(Boolean).join(" ");
}

export function formatActivityDuration(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "";
  if (value < 100) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${Math.round(value / 1_000)}s`;
}

export function formatTurnCause(cause: ActivityTurnView["cause"]) {
  switch (cause) {
    case "tool-continuation":
      return "tool continuation";
    case "follow-up":
      return "follow-up";
    case "steering":
      return "steering";
    default:
      return "initial";
  }
}

export function statusGlyph(status: AgentRunStatus) {
  switch (status) {
    case "completed":
      return "✓";
    case "failed":
      return "×";
    case "interrupted":
      return "■";
    default:
      return "●";
  }
}
