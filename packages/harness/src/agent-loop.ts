import type {
  ExecutionEvent,
  ExecutionEventPayload,
} from "./execution-events";
import { projectAgentRun } from "./execution-projection";
import {
  InMemoryExecutionEventStore,
  type ExecutionEventStore,
} from "./execution-store";
import type {
  AgentLifecycleErrorHandler,
  AgentLifecycleEvent,
  AgentLifecycleListener,
} from "./lifecycle";
import type {
  AgentInteraction,
  AgentInteractionInput,
  AgentLoopRunOptions,
  AgentModelStep,
  AgentRun,
  AgentStepProgress,
  AgentToolCall,
  AgentToolStep,
  AgentTurn,
  AgentTurnCause,
} from "./types";
import {
  DEFAULT_TOOL_BATCH_EXECUTION,
  ToolBatchScheduler,
} from "./tool-batch-scheduler";

export class AgentLoopBusyError extends Error {
  constructor() {
    super("Agent loop is already busy");
    this.name = "AgentLoopBusyError";
  }
}

export class AgentLoopMaxStepsError extends Error {
  constructor(maxSteps: number) {
    super(`Agent loop exceeded the safety ceiling of ${maxSteps} total steps`);
    this.name = "AgentLoopMaxStepsError";
  }
}

export class AgentLoopMaxExecutionStepsError extends Error {
  constructor(maxExecutionSteps: number) {
    super(`Agent loop exceeded the safety ceiling of ${maxExecutionSteps} execution steps`);
    this.name = "AgentLoopMaxExecutionStepsError";
  }
}

export class AgentLoopMaxModelLoopsError extends Error {
  constructor(maxModelLoops: number) {
    super(`Agent loop exceeded the maximum of ${maxModelLoops} model loops in this interaction round`);
    this.name = "AgentLoopMaxModelLoopsError";
  }
}

export class AgentLoopMaxToolCallsError extends Error {
  constructor(maxToolCalls: number) {
    super(`Agent loop exceeded the maximum of ${maxToolCalls} tool calls in this interaction round`);
    this.name = "AgentLoopMaxToolCallsError";
  }
}

export class AgentLoopMaxModelStepsError extends Error {
  constructor(maxModelSteps: number) {
    super(`Agent loop exceeded the maximum of ${maxModelSteps} model steps`);
    this.name = "AgentLoopMaxModelStepsError";
  }
}

export class AgentLoopMaxToolStepsError extends Error {
  constructor(maxToolSteps: number) {
    super(`Agent loop exceeded the maximum of ${maxToolSteps} tool steps`);
    this.name = "AgentLoopMaxToolStepsError";
  }
}

export class AgentLoopMaxTurnsError extends Error {
  constructor(maxTurns: number) {
    super(`Agent loop exceeded the maximum of ${maxTurns} turns`);
    this.name = "AgentLoopMaxTurnsError";
  }
}

export type AgentLoopOptions = {
  /**
   * Absolute per-interaction safety ceiling across model and Tool steps.
   * This is intentionally much higher than the workload-specific budgets.
   */
  maxSteps?: number;
  /** Preferred name for the catastrophic model+tool execution ceiling. */
  maxExecutionSteps?: number;
  /** Maximum model iterations in one interaction epoch. */
  maxModelSteps?: number;
  /** Preferred name: primary Provider invocations per Interaction Round. */
  maxModelLoops?: number;
  /** Maximum individual Tool calls in one interaction epoch. */
  maxToolSteps?: number;
  /** Preferred name: ToolUse calls per Interaction Round. */
  maxToolCalls?: number;
  maxTurns?: number;
  createId?: () => string;
  now?: () => number;
  eventStore?: ExecutionEventStore;
  onLifecycleError?: AgentLifecycleErrorHandler;
};

type NextTurn = {
  cause: AgentTurnCause;
  interaction?: AgentInteraction;
};

function defaultCreateId() {
  return crypto.randomUUID();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cloneInteraction(interaction: AgentInteraction): AgentInteraction {
  return {
    ...interaction,
    ...(interaction.metadata ? { metadata: { ...interaction.metadata } } : {}),
  };
}

export class AgentLoop {
  private readonly maxExecutionSteps: number;
  private readonly maxModelLoops: number;
  private readonly maxToolCalls: number;
  private readonly maxTurns: number;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly eventStore: ExecutionEventStore;
  private readonly onLifecycleError?: AgentLifecycleErrorHandler;
  private readonly lifecycleListeners = new Set<AgentLifecycleListener>();
  private readonly steeringQueue: AgentInteraction[] = [];
  private readonly followUpQueue: AgentInteraction[] = [];
  private readonly interactionQueueListeners = new Set<() => void>();
  private readonly idleWaiters = new Set<() => void>();

  private activeRunId: string | null = null;
  private activeSessionId: string | null = null;
  private activeAbortController: AbortController | null = null;
  private activeAbortModelStep: (() => void) | null = null;
  private nextSequence = 0;
  private interruptRequested = false;
  private acceptingInteractions = false;
  private busy = false;

  constructor(options: AgentLoopOptions = {}) {
    // A Tool-heavy coding turn can legitimately contain dozens of individual
    // Tool steps. Keep multiple independent budgets rather than treating every
    // Tool call as if it consumed one scarce model iteration.
    this.maxExecutionSteps = options.maxExecutionSteps ?? options.maxSteps ?? 1_024;
    this.maxModelLoops = options.maxModelLoops ?? options.maxModelSteps ?? 128;
    this.maxToolCalls = options.maxToolCalls ?? options.maxToolSteps ?? 512;
    this.maxTurns = options.maxTurns ?? 128;
    this.createId = options.createId ?? defaultCreateId;
    this.now = options.now ?? Date.now;
    this.eventStore = options.eventStore ?? new InMemoryExecutionEventStore();
    this.onLifecycleError = options.onLifecycleError;

    if (!Number.isInteger(this.maxExecutionSteps) || this.maxExecutionSteps < 1) {
      throw new Error("maxExecutionSteps must be a positive integer");
    }
    if (!Number.isInteger(this.maxModelLoops) || this.maxModelLoops < 1) {
      throw new Error("maxModelLoops must be a positive integer");
    }
    if (!Number.isInteger(this.maxToolCalls) || this.maxToolCalls < 1) {
      throw new Error("maxToolCalls must be a positive integer");
    }
    if (!Number.isInteger(this.maxTurns) || this.maxTurns < 1) {
      throw new Error("maxTurns must be a positive integer");
    }
  }

  get currentRun(): AgentRun | null {
    if (!this.activeRunId) return null;
    return projectAgentRun(this.eventStore.getRunEvents(this.activeRunId));
  }

  get currentTurn(): AgentTurn | null {
    const run = this.currentRun;
    if (!run) return null;
    return run.turns.findLast((turn) => turn.status === "running") ?? null;
  }

  get currentStep(): AgentModelStep | AgentToolStep | null {
    const turn = this.currentTurn;
    if (!turn) return null;
    return turn.steps.findLast((step) => step.status === "running") ?? null;
  }

  get isRunning() {
    return this.currentRun?.status === "running";
  }

  get isBusy() {
    return this.busy;
  }

  get pendingSteering(): readonly AgentInteraction[] {
    return this.steeringQueue.map(cloneInteraction);
  }

  get pendingFollowUps(): readonly AgentInteraction[] {
    return this.followUpQueue.map(cloneInteraction);
  }

  get pendingInteractions(): readonly AgentInteraction[] {
    return [...this.steeringQueue, ...this.followUpQueue]
      .map(cloneInteraction)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  get hasPendingInteractions() {
    return this.steeringQueue.length > 0 || this.followUpQueue.length > 0;
  }

  subscribe(listener: AgentLifecycleListener) {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  subscribePendingInteractions(listener: () => void) {
    this.interactionQueueListeners.add(listener);
    return () => {
      this.interactionQueueListeners.delete(listener);
    };
  }

  waitForIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();

    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  getExecutionEvents(runId?: string): readonly ExecutionEvent[] {
    if (runId) return this.eventStore.getRunEvents(runId);
    return this.eventStore.getEvents();
  }

  interrupt() {
    if (!this.isRunning) return false;

    this.interruptRequested = true;
    this.activeAbortController?.abort();
    this.activeAbortModelStep?.();
    return true;
  }

  steer(input: AgentInteractionInput) {
    return this.enqueueSteering(input) !== null;
  }

  followUp(input: AgentInteractionInput) {
    return this.enqueueFollowUp(input) !== null;
  }

  enqueueSteering(input: AgentInteractionInput) {
    return this.enqueueInteraction("steering", input, this.steeringQueue);
  }

  enqueueFollowUp(input: AgentInteractionInput) {
    return this.enqueueInteraction("follow-up", input, this.followUpQueue);
  }

  cancelPendingInteraction(id: string) {
    const steeringIndex = this.steeringQueue.findIndex((item) => item.id === id);
    if (steeringIndex >= 0) {
      this.steeringQueue.splice(steeringIndex, 1);
      this.notifyInteractionQueueChanged();
      return true;
    }
    const followUpIndex = this.followUpQueue.findIndex((item) => item.id === id);
    if (followUpIndex < 0) return false;
    this.followUpQueue.splice(followUpIndex, 1);
    this.notifyInteractionQueueChanged();
    return true;
  }

  promoteFollowUpToSteering(id: string) {
    const index = this.followUpQueue.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [interaction] = this.followUpQueue.splice(index, 1);
    if (!interaction) return false;
    this.steeringQueue.push({ ...interaction, kind: "steering" });
    this.notifyInteractionQueueChanged();
    return true;
  }

  clearSteeringQueue() {
    const count = this.steeringQueue.length;
    this.steeringQueue.splice(0, count);
    if (count > 0) this.notifyInteractionQueueChanged();
    return count;
  }

  clearFollowUpQueue() {
    const count = this.followUpQueue.length;
    this.followUpQueue.splice(0, count);
    if (count > 0) this.notifyInteractionQueueChanged();
    return count;
  }

  clearAllQueues() {
    return this.clearSteeringQueue() + this.clearFollowUpQueue();
  }

  async run<TToolCall extends AgentToolCall = AgentToolCall>(
    options: AgentLoopRunOptions<TToolCall>,
  ): Promise<AgentRun> {
    if (this.busy) {
      throw new AgentLoopBusyError();
    }

    const runId = this.createId();
    let runStarted = false;
    let activeTurnId: string | null = null;
    let activeStepId: string | null = null;

    this.busy = true;
    this.activeRunId = runId;
    this.activeSessionId = options.sessionId;
    this.activeAbortController = new AbortController();
    this.nextSequence = 0;
    this.activeAbortModelStep = options.adapter.abortModelStep ?? null;
    this.interruptRequested = false;
    this.acceptingInteractions = false;
    this.clearAllQueues();

    try {
      await this.appendEvent({ type: "run.started" }, options.onStateChange);
      runStarted = true;
      await this.emitLifecycle({ type: "run_start", run: this.requireCurrentRun() });
      this.acceptingInteractions = true;

      let nextTurn: NextTurn = { cause: "initial" };
      let turnIndex = 0;

      while (true) {
        if (this.interruptRequested) {
          return await this.finishInterrupted(
            activeTurnId,
            activeStepId,
            options.onStateChange,
          );
        }

        if (nextTurn.interaction && options.adapter.commitInteraction) {
          const pendingInteraction = cloneInteraction(nextTurn.interaction);
          try {
            nextTurn = {
              ...nextTurn,
              interaction: await options.adapter.commitInteraction(
                pendingInteraction,
                {
                  run: this.requireCurrentRun(),
                  signal: this.requireAbortSignal(),
                },
              ),
            };
          } catch (error) {
            options.onPendingInteractionOutcome?.({
              interaction: pendingInteraction,
              reason: "run-failed",
            });
            throw error;
          }
        }

        this.assertTurnBudget(nextTurn.cause);
        this.assertStepBudget(nextTurn.cause);
        const turn = await this.startTurn(
          turnIndex,
          nextTurn,
          options.inputMessageId,
          options.onStateChange,
        );
        activeTurnId = turn.id;

        if (this.interruptRequested) {
          return await this.finishInterrupted(
            activeTurnId,
            activeStepId,
            options.onStateChange,
          );
        }

        const modelStep = await this.startModelStep(turn.id, options.onStateChange);
        activeStepId = modelStep.id;

        if (this.interruptRequested) {
          return await this.finishInterrupted(
            activeTurnId,
            activeStepId,
            options.onStateChange,
          );
        }

        const modelResult = await options.adapter.runModelStep(
          this.getModelStepContext(
            turn.id,
            modelStep.id,
            nextTurn,
            turnIndex > 0,
          ),
        );

        if (this.interruptRequested) {
          return await this.finishInterrupted(
            activeTurnId,
            activeStepId,
            options.onStateChange,
          );
        }

        await this.finishStepCompleted(turn.id, modelStep.id, options.onStateChange);
        activeStepId = null;

        this.assertToolBatchBudget(modelResult.toolCalls.length);
        const scheduler = new ToolBatchScheduler(
          options.toolExecution ?? DEFAULT_TOOL_BATCH_EXECUTION,
        );
        const waves = scheduler.plan(
          modelResult.toolCalls,
          (toolCall) => options.adapter.getToolExecutionSafety?.(toolCall).parallelSafe === true,
        );
        let toolBatchError: unknown = null;

        for (const wave of waves) {
          if (this.interruptRequested) {
            return await this.finishInterrupted(
              activeTurnId,
              activeStepId,
              options.onStateChange,
            );
          }

          const prepared = [] as Array<{
            toolCall: TToolCall;
            toolStep: AgentToolStep;
          }>;
          for (const toolCall of wave) {
            const toolStep = await this.startToolStep(
              turn.id,
              toolCall,
              options.onStateChange,
            );
            prepared.push({ toolCall, toolStep });
          }

          const settled = await Promise.allSettled(prepared.map(({ toolCall, toolStep }) => (
            options.adapter.runToolStep(
              toolCall,
              this.getToolStepContext(turn.id, toolStep.id),
            )
          )));

          if (this.interruptRequested) {
            return await this.finishInterrupted(
              activeTurnId,
              activeStepId,
              options.onStateChange,
            );
          }

          for (let index = 0; index < prepared.length; index += 1) {
            const item = prepared[index];
            const result = settled[index];
            if (!item || !result) continue;
            if (result.status === "fulfilled") {
              await this.finishStepCompleted(turn.id, item.toolStep.id, options.onStateChange);
              continue;
            }
            await this.finishStepFailed(
              turn.id,
              item.toolStep.id,
              result.reason,
              options.onStateChange,
            );
            toolBatchError ??= result.reason;
          }

          // A rejected Tool adapter call represents infrastructure/durability
          // failure rather than a semantic Tool error (which should be encoded
          // in the Tool terminal itself). Settle the already-started wave, then
          // fail closed before any later wave can begin side effects.
          if (toolBatchError) break;
        }

        if (toolBatchError) throw toolBatchError;

        await this.finishTurnCompleted(turn.id, options.onStateChange);
        activeTurnId = null;

        if (this.interruptRequested) {
          return await this.finishInterrupted(null, null, options.onStateChange);
        }

        const steering = this.takePendingInteraction(this.steeringQueue);
        if (steering) {
          nextTurn = { cause: "steering", interaction: steering };
          turnIndex += 1;
          continue;
        }

        if (modelResult.toolCalls.length > 0) {
          nextTurn = { cause: "tool-continuation" };
          turnIndex += 1;
          continue;
        }

        const followUp = this.takePendingInteraction(this.followUpQueue);
        if (followUp) {
          nextTurn = { cause: "follow-up", interaction: followUp };
          turnIndex += 1;
          continue;
        }

        // Close the acceptance gate synchronously before the first await in
        // settlement. A submit racing with this point is therefore rejected
        // from the old Run and can be routed as a fresh submission by the CLI.
        this.acceptingInteractions = false;
        return await this.finishRunCompleted(options.onStateChange);
      }
    } catch (error) {
      if (!runStarted) {
        this.activeRunId = null;
        this.activeSessionId = null;
        throw error;
      }

      if (this.interruptRequested) {
        return await this.finishInterrupted(
          activeTurnId,
          activeStepId,
          options.onStateChange,
        );
      }

      return await this.finishFailed(
        activeTurnId,
        activeStepId,
        error,
        options.onStateChange,
      );
    } finally {
      this.acceptingInteractions = false;
      const terminalStatus = this.currentRun?.status;
      if (terminalStatus === "interrupted" || terminalStatus === "failed") {
        const reason = terminalStatus === "interrupted" ? "run-interrupted" : "run-failed";
        for (const interaction of this.drainPendingInteractions()) {
          options.onPendingInteractionOutcome?.({ interaction, reason });
        }
      }
      this.activeAbortModelStep = null;
      this.activeAbortController = null;
      this.interruptRequested = false;
      this.busy = false;
      this.resolveIdleWaiters();
    }
  }

  private enqueueInteraction(
    kind: AgentInteraction["kind"],
    input: AgentInteractionInput,
    queue: AgentInteraction[],
  ) {
    if (!this.isRunning || !this.acceptingInteractions) return null;

    const text = input.text.trim();
    if (!text) return null;

    const interaction: AgentInteraction = {
      id: this.createId(),
      kind,
      text,
      createdAt: this.now(),
      ...(input.inputMessageId ? { inputMessageId: input.inputMessageId } : {}),
      ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    };
    queue.push(interaction);
    this.notifyInteractionQueueChanged();
    return cloneInteraction(interaction);
  }

  private takePendingInteraction(queue: AgentInteraction[]) {
    const interaction = queue.shift();
    if (!interaction) return undefined;
    this.notifyInteractionQueueChanged();
    return interaction;
  }

  private drainPendingInteractions() {
    const interactions = this.pendingInteractions.map(cloneInteraction);
    this.steeringQueue.splice(0, this.steeringQueue.length);
    this.followUpQueue.splice(0, this.followUpQueue.length);
    if (interactions.length > 0) this.notifyInteractionQueueChanged();
    return interactions;
  }

  private notifyInteractionQueueChanged() {
    for (const listener of [...this.interactionQueueListeners]) listener();
  }

  private async startTurn(
    turnIndex: number,
    nextTurn: NextTurn,
    initialInputMessageId: string | undefined,
    onStateChange?: (run: AgentRun) => void,
  ) {
    const turnId = this.createId();
    const inputMessageId = nextTurn.cause === "initial"
      ? initialInputMessageId
      : nextTurn.interaction?.inputMessageId;

    await this.appendEvent(
      {
        type: "turn.started",
        turnId,
        turnIndex,
        cause: nextTurn.cause,
        ...(inputMessageId ? { inputMessageId } : {}),
        ...(nextTurn.interaction ? { interactionId: nextTurn.interaction.id } : {}),
      },
      onStateChange,
    );

    const turn = this.getTurn(turnId);
    await this.emitLifecycle({
      type: "turn_start",
      run: this.requireCurrentRun(),
      turn,
      ...(nextTurn.interaction
        ? { interaction: cloneInteraction(nextTurn.interaction) }
        : {}),
    });
    return turn;
  }

  private async startModelStep(
    turnId: string,
    onStateChange?: (run: AgentRun) => void,
  ) {
    this.assertStepBudget();
    this.assertModelStepBudget();
    const turn = this.getTurn(turnId);
    const stepId = this.createId();

    await this.appendEvent(
      {
        type: "step.started",
        turnId,
        stepId,
        stepIndex: turn.steps.length,
        stepKind: "model",
      },
      onStateChange,
    );

    const step = this.getStep(turnId, stepId);
    if (step.kind !== "model") {
      throw new Error(`Expected model step ${stepId}`);
    }

    await this.emitLifecycle({
      type: "step_start",
      run: this.requireCurrentRun(),
      turn: this.getTurn(turnId),
      step,
    });
    return step;
  }

  private async startToolStep<TToolCall extends AgentToolCall>(
    turnId: string,
    toolCall: TToolCall,
    onStateChange?: (run: AgentRun) => void,
  ) {
    this.assertStepBudget();
    this.assertToolStepBudget();
    const turn = this.getTurn(turnId);
    const stepId = this.createId();

    await this.appendEvent(
      {
        type: "step.started",
        turnId,
        stepId,
        stepIndex: turn.steps.length,
        stepKind: "tool",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
      },
      onStateChange,
    );

    const step = this.getStep(turnId, stepId);
    if (step.kind !== "tool") {
      throw new Error(`Expected tool step ${stepId}`);
    }

    await this.emitLifecycle({
      type: "step_start",
      run: this.requireCurrentRun(),
      turn: this.getTurn(turnId),
      step,
    });
    return step;
  }

  private async finishStepCompleted(
    turnId: string,
    stepId: string,
    onStateChange?: (run: AgentRun) => void,
  ) {
    await this.appendEvent(
      { type: "step.completed", turnId, stepId },
      onStateChange,
    );
    await this.emitLifecycle({
      type: "step_end",
      run: this.requireCurrentRun(),
      turn: this.getTurn(turnId),
      step: this.getStep(turnId, stepId),
    });
  }

  private async finishStepFailed(
    turnId: string,
    stepId: string,
    error: unknown,
    onStateChange?: (run: AgentRun) => void,
  ) {
    await this.appendEvent(
      {
        type: "step.failed",
        turnId,
        stepId,
        error: getErrorMessage(error),
      },
      onStateChange,
    );
    await this.emitLifecycle({
      type: "step_end",
      run: this.requireCurrentRun(),
      turn: this.getTurn(turnId),
      step: this.getStep(turnId, stepId),
    });
  }

  private async finishTurnCompleted(
    turnId: string,
    onStateChange?: (run: AgentRun) => void,
  ) {
    await this.appendEvent(
      { type: "turn.completed", turnId },
      onStateChange,
    );
    await this.emitLifecycle({
      type: "turn_end",
      run: this.requireCurrentRun(),
      turn: this.getTurn(turnId),
    });
  }

  private async finishRunCompleted(
    onStateChange?: (run: AgentRun) => void,
  ) {
    await this.appendEvent({ type: "run.completed" }, onStateChange);
    const run = this.requireCurrentRun();
    await this.emitLifecycle({ type: "run_end", run });
    return this.requireCurrentRun();
  }

  private async finishInterrupted(
    turnId: string | null,
    activeStepId: string | null,
    onStateChange?: (run: AgentRun) => void,
  ) {
    if (turnId) {
      const runningStepIds = this.getTurn(turnId).steps
        .filter((step) => step.status === "running")
        .map((step) => step.id);
      if (
        activeStepId
        && this.isStepRunning(turnId, activeStepId)
        && !runningStepIds.includes(activeStepId)
      ) {
        runningStepIds.push(activeStepId);
      }
      for (const stepId of runningStepIds) {
        await this.appendEvent(
          { type: "step.interrupted", turnId, stepId },
          onStateChange,
        );
        await this.emitLifecycle({
          type: "step_end",
          run: this.requireCurrentRun(),
          turn: this.getTurn(turnId),
          step: this.getStep(turnId, stepId),
        });
      }
    }

    if (turnId && this.getTurn(turnId).status === "running") {
      await this.appendEvent(
        { type: "turn.interrupted", turnId },
        onStateChange,
      );
      await this.emitLifecycle({
        type: "turn_end",
        run: this.requireCurrentRun(),
        turn: this.getTurn(turnId),
      });
    }

    if (this.requireCurrentRun().status === "running") {
      await this.appendEvent({ type: "run.interrupted" }, onStateChange);
      await this.emitLifecycle({ type: "run_end", run: this.requireCurrentRun() });
    }

    return this.requireCurrentRun();
  }

  private async finishFailed(
    turnId: string | null,
    activeStepId: string | null,
    error: unknown,
    onStateChange?: (run: AgentRun) => void,
  ) {
    const message = getErrorMessage(error);

    if (turnId && activeStepId && this.isStepRunning(turnId, activeStepId)) {
      await this.appendEvent(
        {
          type: "step.failed",
          turnId,
          stepId: activeStepId,
          error: message,
        },
        onStateChange,
      );
      await this.emitLifecycle({
        type: "step_end",
        run: this.requireCurrentRun(),
        turn: this.getTurn(turnId),
        step: this.getStep(turnId, activeStepId),
      });
    }

    if (turnId && this.getTurn(turnId).status === "running") {
      await this.appendEvent(
        { type: "turn.failed", turnId, error: message },
        onStateChange,
      );
      await this.emitLifecycle({
        type: "turn_end",
        run: this.requireCurrentRun(),
        turn: this.getTurn(turnId),
      });
    }

    if (this.requireCurrentRun().status === "running") {
      await this.appendEvent(
        { type: "run.failed", error: message },
        onStateChange,
      );
      await this.emitLifecycle({ type: "run_end", run: this.requireCurrentRun() });
    }

    return this.requireCurrentRun();
  }

  private getBudgetEpochTurns(nextCause?: AgentTurnCause) {
    if (nextCause === "follow-up") return [];

    const turns = this.requireCurrentRun().turns;
    const latestFollowUpIndex = turns.findLastIndex(
      (turn) => turn.cause === "follow-up",
    );
    return latestFollowUpIndex >= 0 ? turns.slice(latestFollowUpIndex) : turns;
  }

  private assertTurnBudget(nextCause?: AgentTurnCause) {
    if (this.getBudgetEpochTurns(nextCause).length >= this.maxTurns) {
      throw new AgentLoopMaxTurnsError(this.maxTurns);
    }
  }

  private assertStepBudget(nextCause?: AgentTurnCause) {
    const stepCount = this.getBudgetEpochStepCounts(nextCause).total;
    if (stepCount >= this.maxExecutionSteps) {
      throw new AgentLoopMaxExecutionStepsError(this.maxExecutionSteps);
    }
  }

  private assertModelStepBudget(nextCause?: AgentTurnCause) {
    if (this.getBudgetEpochStepCounts(nextCause).model >= this.maxModelLoops) {
      throw new AgentLoopMaxModelLoopsError(this.maxModelLoops);
    }
  }

  private assertToolStepBudget(nextCause?: AgentTurnCause) {
    if (this.getBudgetEpochStepCounts(nextCause).tool >= this.maxToolCalls) {
      throw new AgentLoopMaxToolCallsError(this.maxToolCalls);
    }
  }

  private assertToolBatchBudget(count: number, nextCause?: AgentTurnCause) {
    if (count <= 0) return;
    const current = this.getBudgetEpochStepCounts(nextCause);
    if (current.tool + count > this.maxToolCalls) {
      throw new AgentLoopMaxToolCallsError(this.maxToolCalls);
    }
    if (current.total + count > this.maxExecutionSteps) {
      throw new AgentLoopMaxExecutionStepsError(this.maxExecutionSteps);
    }
  }

  private getBudgetEpochStepCounts(nextCause?: AgentTurnCause) {
    let model = 0;
    let tool = 0;
    for (const turn of this.getBudgetEpochTurns(nextCause)) {
      for (const step of turn.steps) {
        if (step.kind === "model") model += 1;
        else tool += 1;
      }
    }
    return { model, tool, total: model + tool };
  }

  private getModelStepContext(
    turnId: string,
    stepId: string,
    nextTurn: NextTurn,
    continuation: boolean,
  ) {
    const run = this.requireCurrentRun();
    const turn = this.getTurnFrom(run, turnId);
    const step = this.getStepFrom(turn, stepId);
    if (step.kind !== "model") {
      throw new Error(`Unknown model step ${stepId}`);
    }

    return {
      run,
      turn,
      step: step satisfies AgentModelStep,
      continuation,
      cause: nextTurn.cause,
      ...(nextTurn.interaction
        ? { interaction: cloneInteraction(nextTurn.interaction) }
        : {}),
      signal: this.requireAbortSignal(),
      reportProgress: (update: AgentStepProgress) =>
        this.reportStepProgress(turnId, stepId, update),
    };
  }

  private getToolStepContext(turnId: string, stepId: string) {
    const run = this.requireCurrentRun();
    const turn = this.getTurnFrom(run, turnId);
    const step = this.getStepFrom(turn, stepId);
    if (step.kind !== "tool") {
      throw new Error(`Unknown tool step ${stepId}`);
    }

    return {
      run,
      turn,
      step: step satisfies AgentToolStep,
      signal: this.requireAbortSignal(),
      reportProgress: (update: AgentStepProgress) =>
        this.reportStepProgress(turnId, stepId, update),
    };
  }

  private async reportStepProgress(
    turnId: string,
    stepId: string,
    update: AgentStepProgress,
  ) {
    const run = this.requireCurrentRun();
    const turn = this.getTurnFrom(run, turnId);
    const step = this.getStepFrom(turn, stepId);
    if (step.status !== "running") return;

    await this.emitLifecycle({
      type: "step_update",
      run,
      turn,
      step,
      update: { ...update },
    });
  }

  private getTurn(turnId: string) {
    return this.getTurnFrom(this.requireCurrentRun(), turnId);
  }

  private getTurnFrom(run: AgentRun, turnId: string) {
    const turn = run.turns.find((candidate) => candidate.id === turnId);
    if (!turn) throw new Error(`Unknown turn ${turnId}`);
    return turn;
  }

  private getStep(turnId: string, stepId: string) {
    return this.getStepFrom(this.getTurn(turnId), stepId);
  }

  private getStepFrom(turn: AgentTurn, stepId: string) {
    const step = turn.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`Unknown step ${stepId}`);
    return step;
  }

  private isStepRunning(turnId: string, stepId: string) {
    return this.getStep(turnId, stepId).status === "running";
  }

  private requireCurrentRun() {
    const run = this.currentRun;
    if (!run) throw new Error("Active run has no execution projection");
    return run;
  }

  private requireAbortSignal() {
    if (!this.activeAbortController) {
      throw new Error("Active run has no AbortSignal");
    }
    return this.activeAbortController.signal;
  }

  private async appendEvent(
    payload: ExecutionEventPayload,
    onStateChange?: (run: AgentRun) => void,
  ) {
    if (!this.activeRunId || !this.activeSessionId) {
      throw new Error("Cannot append an execution event without an active run");
    }

    const event = {
      ...payload,
      id: this.createId(),
      sequence: this.nextSequence,
      timestamp: this.now(),
      sessionId: this.activeSessionId,
      runId: this.activeRunId,
    } as ExecutionEvent;

    await this.eventStore.append(event);
    this.nextSequence += 1;
    onStateChange?.(this.requireCurrentRun());
    return event;
  }

  private async emitLifecycle(event: AgentLifecycleEvent) {
    const signal = this.requireAbortSignal();

    for (const listener of this.lifecycleListeners) {
      try {
        await listener(event, signal);
      } catch (error) {
        this.onLifecycleError?.(error, event);
      }
    }
  }

  private resolveIdleWaiters() {
    for (const resolve of this.idleWaiters) {
      resolve();
    }
    this.idleWaiters.clear();
  }
}
