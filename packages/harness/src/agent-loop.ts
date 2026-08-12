import type {
  AgentLoopRunOptions,
  AgentModelStep,
  AgentRun,
  AgentStep,
  AgentToolCall,
  AgentToolStep,
  AgentTurn,
} from "./types";

export class AgentLoopBusyError extends Error {
  constructor() {
    super("Agent loop is already running");
    this.name = "AgentLoopBusyError";
  }
}

export class AgentLoopMaxStepsError extends Error {
  constructor(maxSteps: number) {
    super(`Agent loop exceeded the maximum of ${maxSteps} steps`);
    this.name = "AgentLoopMaxStepsError";
  }
}

type AgentLoopOptions = {
  maxSteps?: number;
  createId?: () => string;
  now?: () => number;
};

function defaultCreateId() {
  return crypto.randomUUID();
}

function cloneRun(run: AgentRun): AgentRun {
  return {
    ...run,
    turns: run.turns.map((turn) => ({
      ...turn,
      steps: turn.steps.map((step) => ({ ...step })),
    })),
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class AgentLoop {
  private readonly maxSteps: number;
  private readonly createId: () => string;
  private readonly now: () => number;
  private activeRun: AgentRun | null = null;
  private activeAbortModelStep: (() => void) | null = null;
  private interruptRequested = false;

  constructor(options: AgentLoopOptions = {}) {
    this.maxSteps = options.maxSteps ?? 64;
    this.createId = options.createId ?? defaultCreateId;
    this.now = options.now ?? Date.now;

    if (!Number.isInteger(this.maxSteps) || this.maxSteps < 1) {
      throw new Error("maxSteps must be a positive integer");
    }
  }

  get currentRun(): AgentRun | null {
    return this.activeRun ? cloneRun(this.activeRun) : null;
  }

  get isRunning() {
    return this.activeRun?.status === "running";
  }

  interrupt() {
    if (!this.isRunning) return false;

    this.interruptRequested = true;
    this.activeAbortModelStep?.();
    return true;
  }

  async run<TToolCall extends AgentToolCall = AgentToolCall>(
    options: AgentLoopRunOptions<TToolCall>,
  ): Promise<AgentRun> {
    if (this.isRunning) {
      throw new AgentLoopBusyError();
    }

    const run = this.createRun(options.sessionId);
    const turn = this.createTurn(run, options.inputMessageId);

    run.turns.push(turn);
    this.activeRun = run;
    this.activeAbortModelStep = options.adapter.abortModelStep ?? null;
    this.interruptRequested = false;
    this.emit(options.onStateChange);

    try {
      let continuation = false;

      while (true) {
        if (this.interruptRequested) {
          return this.finishInterrupted(run, turn, options.onStateChange);
        }

        const modelStep = this.appendModelStep(run, turn, options.onStateChange);
        let modelResult;

        try {
          modelResult = await options.adapter.runModelStep({
            run: cloneRun(run),
            turn: { ...turn, steps: turn.steps.map((step) => ({ ...step })) },
            step: { ...modelStep },
            continuation,
          });
        } catch (error) {
          if (this.interruptRequested) {
            this.finishStep(modelStep, "interrupted");
            return this.finishInterrupted(run, turn, options.onStateChange);
          }

          this.finishStep(modelStep, "failed", error);
          return this.failRun(run, turn, error, options.onStateChange);
        }

        if (this.interruptRequested) {
          this.finishStep(modelStep, "interrupted");
          return this.finishInterrupted(run, turn, options.onStateChange);
        }

        this.finishStep(modelStep, "completed");
        this.emit(options.onStateChange);

        if (modelResult.toolCalls.length === 0) {
          return this.completeRun(run, turn, options.onStateChange);
        }

        for (const toolCall of modelResult.toolCalls) {
          if (this.interruptRequested) {
            return this.finishInterrupted(run, turn, options.onStateChange);
          }

          const toolStep = this.appendToolStep(
            run,
            turn,
            toolCall,
            options.onStateChange,
          );

          try {
            await options.adapter.runToolStep(toolCall, {
              run: cloneRun(run),
              turn: { ...turn, steps: turn.steps.map((step) => ({ ...step })) },
              step: { ...toolStep },
            });
          } catch (error) {
            if (this.interruptRequested) {
              this.finishStep(toolStep, "interrupted");
              return this.finishInterrupted(run, turn, options.onStateChange);
            }

            this.finishStep(toolStep, "failed", error);
            return this.failRun(run, turn, error, options.onStateChange);
          }

          this.finishStep(toolStep, "completed");
          this.emit(options.onStateChange);
        }

        continuation = true;
      }
    } catch (error) {
      if (this.interruptRequested) {
        return this.finishInterrupted(run, turn, options.onStateChange);
      }

      return this.failRun(run, turn, error, options.onStateChange);
    } finally {
      this.activeAbortModelStep = null;
    }
  }

  private createRun(sessionId: string): AgentRun {
    return {
      id: this.createId(),
      sessionId,
      status: "running",
      startedAt: this.now(),
      turns: [],
    };
  }

  private createTurn(run: AgentRun, inputMessageId?: string): AgentTurn {
    return {
      id: this.createId(),
      runId: run.id,
      index: run.turns.length,
      ...(inputMessageId ? { inputMessageId } : {}),
      status: "running",
      startedAt: this.now(),
      steps: [],
    };
  }

  private appendModelStep(
    run: AgentRun,
    turn: AgentTurn,
    onStateChange?: (run: AgentRun) => void,
  ) {
    this.assertStepBudget(turn);

    const step: AgentModelStep = {
      id: this.createId(),
      runId: run.id,
      turnId: turn.id,
      index: turn.steps.length,
      kind: "model",
      status: "running",
      startedAt: this.now(),
    };

    turn.steps.push(step);
    this.emit(onStateChange);
    return step;
  }

  private appendToolStep<TToolCall extends AgentToolCall>(
    run: AgentRun,
    turn: AgentTurn,
    toolCall: TToolCall,
    onStateChange?: (run: AgentRun) => void,
  ) {
    this.assertStepBudget(turn);

    const step: AgentToolStep = {
      id: this.createId(),
      runId: run.id,
      turnId: turn.id,
      index: turn.steps.length,
      kind: "tool",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      status: "running",
      startedAt: this.now(),
    };

    turn.steps.push(step);
    this.emit(onStateChange);
    return step;
  }

  private assertStepBudget(turn: AgentTurn) {
    if (turn.steps.length >= this.maxSteps) {
      throw new AgentLoopMaxStepsError(this.maxSteps);
    }
  }

  private finishStep(
    step: AgentStep,
    status: AgentStep["status"],
    error?: unknown,
  ) {
    step.status = status;
    step.endedAt = this.now();

    if (error !== undefined) {
      step.error = getErrorMessage(error);
    }
  }

  private completeRun(
    run: AgentRun,
    turn: AgentTurn,
    onStateChange?: (run: AgentRun) => void,
  ) {
    const endedAt = this.now();
    turn.status = "completed";
    turn.endedAt = endedAt;
    run.status = "completed";
    run.endedAt = endedAt;
    this.emit(onStateChange);
    return cloneRun(run);
  }

  private finishInterrupted(
    run: AgentRun,
    turn: AgentTurn,
    onStateChange?: (run: AgentRun) => void,
  ) {
    const endedAt = this.now();
    turn.status = "interrupted";
    turn.endedAt = endedAt;
    run.status = "interrupted";
    run.endedAt = endedAt;
    this.emit(onStateChange);
    return cloneRun(run);
  }

  private failRun(
    run: AgentRun,
    turn: AgentTurn,
    error: unknown,
    onStateChange?: (run: AgentRun) => void,
  ) {
    const endedAt = this.now();
    const message = getErrorMessage(error);

    turn.status = "failed";
    turn.endedAt = endedAt;
    turn.error = message;
    run.status = "failed";
    run.endedAt = endedAt;
    run.error = message;
    this.emit(onStateChange);
    return cloneRun(run);
  }

  private emit(onStateChange?: (run: AgentRun) => void) {
    if (!this.activeRun) return;
    onStateChange?.(cloneRun(this.activeRun));
  }
}
