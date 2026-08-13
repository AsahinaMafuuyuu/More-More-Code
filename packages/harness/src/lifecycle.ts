import type {
  AgentInteraction,
  AgentRun,
  AgentStep,
  AgentStepProgress,
  AgentTurn,
} from "./types";

export type AgentRunStartLifecycleEvent = {
  type: "run_start";
  run: AgentRun;
};

export type AgentRunEndLifecycleEvent = {
  type: "run_end";
  run: AgentRun;
};

export type AgentTurnStartLifecycleEvent = {
  type: "turn_start";
  run: AgentRun;
  turn: AgentTurn;
  interaction?: AgentInteraction;
};

export type AgentTurnEndLifecycleEvent = {
  type: "turn_end";
  run: AgentRun;
  turn: AgentTurn;
};

export type AgentStepStartLifecycleEvent = {
  type: "step_start";
  run: AgentRun;
  turn: AgentTurn;
  step: AgentStep;
};

export type AgentStepUpdateLifecycleEvent = {
  type: "step_update";
  run: AgentRun;
  turn: AgentTurn;
  step: AgentStep;
  update: AgentStepProgress;
};

export type AgentStepEndLifecycleEvent = {
  type: "step_end";
  run: AgentRun;
  turn: AgentTurn;
  step: AgentStep;
};

export type AgentLifecycleEvent =
  | AgentRunStartLifecycleEvent
  | AgentRunEndLifecycleEvent
  | AgentTurnStartLifecycleEvent
  | AgentTurnEndLifecycleEvent
  | AgentStepStartLifecycleEvent
  | AgentStepUpdateLifecycleEvent
  | AgentStepEndLifecycleEvent;

export type AgentLifecycleListener = (
  event: AgentLifecycleEvent,
  signal: AbortSignal,
) => void | Promise<void>;

export type AgentLifecycleErrorHandler = (
  error: unknown,
  event: AgentLifecycleEvent,
) => void;
