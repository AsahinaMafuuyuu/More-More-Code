export type AgentRunStatus = "running" | "completed" | "interrupted" | "failed";
export type AgentTurnStatus = AgentRunStatus;
export type AgentStepStatus = AgentRunStatus;

export type AgentStepKind = "model" | "tool";

export type AgentTurnCause =
  | "initial"
  | "tool-continuation"
  | "steering"
  | "follow-up";

export type AgentInteractionKind = "steering" | "follow-up";

export type AgentInteractionMetadata = Readonly<Record<string, unknown>>;

export type AgentInteraction = {
  id: string;
  kind: AgentInteractionKind;
  text: string;
  createdAt: number;
  inputMessageId?: string;
  metadata?: AgentInteractionMetadata;
};

export type AgentInteractionInput = {
  text: string;
  inputMessageId?: string;
  metadata?: AgentInteractionMetadata;
};

export type AgentStepProgress = {
  message?: string;
  completed?: number;
  total?: number;
  details?: unknown;
};

export type AgentStepBase = {
  id: string;
  runId: string;
  turnId: string;
  index: number;
  kind: AgentStepKind;
  status: AgentStepStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
};

export type AgentModelStep = AgentStepBase & {
  kind: "model";
};

export type AgentToolStep = AgentStepBase & {
  kind: "tool";
  toolCallId: string;
  toolName: string;
};

export type AgentStep = AgentModelStep | AgentToolStep;

export type AgentTurn = {
  id: string;
  runId: string;
  index: number;
  cause: AgentTurnCause;
  inputMessageId?: string;
  interactionId?: string;
  status: AgentTurnStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  steps: AgentStep[];
};

export type AgentRun = {
  id: string;
  sessionId: string;
  status: AgentRunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  turns: AgentTurn[];
};

export type AgentToolCall<TInput = unknown> = {
  toolCallId: string;
  toolName: string;
  input: TInput;
};

export type AgentModelStepContext = {
  run: AgentRun;
  turn: AgentTurn;
  step: AgentModelStep;
  continuation: boolean;
  cause: AgentTurnCause;
  interaction?: AgentInteraction;
  signal: AbortSignal;
  reportProgress(update: AgentStepProgress): Promise<void>;
};

export type AgentToolStepContext = {
  run: AgentRun;
  turn: AgentTurn;
  step: AgentToolStep;
  signal: AbortSignal;
  reportProgress(update: AgentStepProgress): Promise<void>;
};

export type AgentModelStepResult<TToolCall extends AgentToolCall = AgentToolCall> = {
  toolCalls: TToolCall[];
};

export type AgentLoopAdapter<TToolCall extends AgentToolCall = AgentToolCall> = {
  runModelStep(context: AgentModelStepContext): Promise<AgentModelStepResult<TToolCall>>;
  runToolStep(toolCall: TToolCall, context: AgentToolStepContext): Promise<void>;
  abortModelStep?(): void;
};

export type AgentLoopRunOptions<TToolCall extends AgentToolCall = AgentToolCall> = {
  sessionId: string;
  inputMessageId?: string;
  adapter: AgentLoopAdapter<TToolCall>;
  onStateChange?: (run: AgentRun) => void;
};
