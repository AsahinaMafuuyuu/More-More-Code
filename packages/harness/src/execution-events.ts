import type { AgentTurnCause } from "./types";

export type ExecutionEventType =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.interrupted"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "turn.interrupted"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "step.interrupted";

export type ExecutionEventBase<TType extends ExecutionEventType> = {
  id: string;
  type: TType;
  sequence: number;
  timestamp: number;
  sessionId: string;
  runId: string;
};

export type RunStartedEvent = ExecutionEventBase<"run.started">;

export type RunCompletedEvent = ExecutionEventBase<"run.completed">;

export type RunFailedEvent = ExecutionEventBase<"run.failed"> & {
  error: string;
};

export type RunInterruptedEvent = ExecutionEventBase<"run.interrupted">;

export type TurnStartedEvent = ExecutionEventBase<"turn.started"> & {
  turnId: string;
  turnIndex: number;
  cause: AgentTurnCause;
  inputMessageId?: string;
  interactionId?: string;
};

export type TurnCompletedEvent = ExecutionEventBase<"turn.completed"> & {
  turnId: string;
};

export type TurnFailedEvent = ExecutionEventBase<"turn.failed"> & {
  turnId: string;
  error: string;
};

export type TurnInterruptedEvent = ExecutionEventBase<"turn.interrupted"> & {
  turnId: string;
};

export type ModelStepStartedEvent = ExecutionEventBase<"step.started"> & {
  turnId: string;
  stepId: string;
  stepIndex: number;
  stepKind: "model";
};

export type ToolStepStartedEvent = ExecutionEventBase<"step.started"> & {
  turnId: string;
  stepId: string;
  stepIndex: number;
  stepKind: "tool";
  toolCallId: string;
  toolName: string;
};

export type StepStartedEvent = ModelStepStartedEvent | ToolStepStartedEvent;

export type StepCompletedEvent = ExecutionEventBase<"step.completed"> & {
  turnId: string;
  stepId: string;
};

export type StepFailedEvent = ExecutionEventBase<"step.failed"> & {
  turnId: string;
  stepId: string;
  error: string;
};

export type StepInterruptedEvent = ExecutionEventBase<"step.interrupted"> & {
  turnId: string;
  stepId: string;
};

export type ExecutionEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunInterruptedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnInterruptedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepInterruptedEvent;

export type ExecutionEventPayload = ExecutionEvent extends infer TEvent
  ? TEvent extends ExecutionEvent
    ? Omit<TEvent, "id" | "sequence" | "timestamp" | "sessionId" | "runId">
    : never
  : never;
