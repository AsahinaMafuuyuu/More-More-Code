import type {
  AgentLifecycleEvent,
  AgentRun,
  AgentRunStatus,
  AgentStepProgress,
  AgentStepKind,
  AgentStepStatus,
  AgentTurnCause,
  AgentTurnStatus,
} from "@more-more-code/harness";

export type ActivityStepView = {
  id: string;
  index: number;
  kind: AgentStepKind;
  label: string;
  status: AgentStepStatus;
  startedAt?: number;
  endedAt?: number;
  elapsedMs?: number;
  active: boolean;
  toolCallId?: string;
  toolName?: string;
  progress?: ActivityProgressView;
};

export type ActivityProgressView = {
  message?: string;
  completed?: number;
  total?: number;
};

export type ActivityTurnView = {
  id: string;
  index: number;
  cause: AgentTurnCause;
  status: AgentTurnStatus;
  startedAt?: number;
  endedAt?: number;
  elapsedMs?: number;
  active: boolean;
  steps: ActivityStepView[];
};

export type AgentActivityView = {
  runId: string;
  status: AgentRunStatus;
  startedAt?: number;
  endedAt?: number;
  elapsedMs?: number;
  activeStepId?: string;
  turns: ActivityTurnView[];
};

export type AgentActivityProjectionOptions = {
  now?: number;
  progressByStep?: Readonly<Record<string, AgentStepProgress | undefined>>;
};

export type AgentActivityProgressState = Readonly<Record<string, ActivityProgressView>>;

/**
 * Keeps lifecycle progress process-local. Run lifecycle remains authoritative
 * in Harness; this reducer only retains ephemeral render hints for the current
 * Run and deliberately ignores progress `details` semantics.
 */
export function reduceAgentActivityProgress(
  state: AgentActivityProgressState,
  event: AgentLifecycleEvent,
): AgentActivityProgressState {
  if (event.type === "run_start") return {};
  if (event.type !== "step_update") return state;

  const progress = projectActivityProgress(event.update);
  if (!progress) return state;

  return {
    ...state,
    [event.step.id]: progress,
  };
}

/**
 * Converts the current Harness Run lifecycle into CLI presentation state.
 * It intentionally returns only display-safe lifecycle fields rather than raw
 * provider, prompt, Tool input, or Tool output data.
 */
export function projectAgentActivity(
  run: AgentRun | null | undefined,
  options: AgentActivityProjectionOptions = {},
): AgentActivityView | null {
  if (!run) return null;

  const now = options.now ?? Date.now();
  const activeStepId = findActiveStepId(run);

  return {
    runId: run.id,
    status: run.status,
    ...projectTiming(run, now),
    ...(activeStepId ? { activeStepId } : {}),
    turns: run.turns.map((turn) => ({
      id: turn.id,
      index: turn.index,
      cause: turn.cause,
      status: turn.status,
      ...projectTiming(turn, now),
      active: turn.steps.some((step) => step.id === activeStepId),
      steps: turn.steps.map((step) => ({
        id: step.id,
        index: step.index,
        kind: step.kind,
        label: step.kind === "model" ? "Model" : formatActivityToolName(step.toolName),
        status: step.status,
        ...projectTiming(step, now),
        active: step.id === activeStepId,
        ...(projectActivityProgress(options.progressByStep?.[step.id])
          ? { progress: projectActivityProgress(options.progressByStep?.[step.id]) }
          : {}),
        ...(step.kind === "tool"
          ? { toolCallId: step.toolCallId, toolName: step.toolName }
          : {}),
      })),
    })),
  };
}

function findActiveStepId(run: AgentRun): string | undefined {
  for (let turnIndex = run.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = run.turns[turnIndex]!;
    for (let stepIndex = turn.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = turn.steps[stepIndex]!;
      if (step.status === "running") return step.id;
    }
  }
  return undefined;
}

function projectTiming(
  value: { startedAt?: number; endedAt?: number; status: AgentRunStatus },
  now: number,
) {
  const startedAt = finiteTimestamp(value.startedAt);
  const endedAt = finiteTimestamp(value.endedAt);
  const elapsedEnd = value.status === "running" ? finiteTimestamp(now) : endedAt;
  const elapsedMs = startedAt === undefined || elapsedEnd === undefined
    ? undefined
    : Math.max(0, elapsedEnd - startedAt);

  return {
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
  };
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function projectActivityProgress(
  update: AgentStepProgress | undefined,
): ActivityProgressView | undefined {
  if (!update) return undefined;

  const normalizedMessage = typeof update.message === "string"
    ? update.message.replace(/\s+/g, " ").trim()
    : "";
  const message = normalizedMessage.length > 120
    ? `${normalizedMessage.slice(0, 119)}…`
    : normalizedMessage || undefined;
  const hasNumericProgress = Number.isFinite(update.completed)
    && Number.isFinite(update.total)
    && update.completed! >= 0
    && update.total! > 0
    && update.completed! <= update.total!;

  if (!message && !hasNumericProgress) return undefined;
  return {
    ...(message ? { message } : {}),
    ...(hasNumericProgress ? { completed: update.completed!, total: update.total! } : {}),
  };
}

export function formatActivityToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : "Tool";
}
