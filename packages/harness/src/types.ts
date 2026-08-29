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

export type ToolExecutionMode = "serial" | "parallel";

export type AgentToolExecutionEffect = "read" | "write" | "process" | "unknown";

export type AgentToolExecutionSafety = {
  parallelSafe: boolean;
  effect: AgentToolExecutionEffect;
};

export type AgentToolBatchExecution = {
  mode: ToolExecutionMode;
  maxConcurrency: number;
};

export type AgentPendingInteractionOutcomeReason = "run-interrupted" | "run-failed";

export type AgentPendingInteractionOutcome = {
  interaction: AgentInteraction;
  reason: AgentPendingInteractionOutcomeReason;
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
  /**
   * Durable-on-consume seam for queued steering/follow-up input. The Harness
   * selects the interaction, then the adapter must commit its semantic user
   * message before the next Turn/Provider side effect can begin.
   */
  commitInteraction?(
    interaction: AgentInteraction,
    context: { run: AgentRun; signal: AbortSignal },
  ): Promise<AgentInteraction>;
  /** Source-specific safety metadata used by the provider-independent batch scheduler. */
  getToolExecutionSafety?(toolCall: TToolCall): AgentToolExecutionSafety;
  abortModelStep?(): void;
};

export type AgentLoopRunOptions<TToolCall extends AgentToolCall = AgentToolCall> = {
  sessionId: string;
  inputMessageId?: string;
  adapter: AgentLoopAdapter<TToolCall>;
  toolExecution?: AgentToolBatchExecution;
  onStateChange?: (run: AgentRun) => void;
  onPendingInteractionOutcome?: (outcome: AgentPendingInteractionOutcome) => void;
};
