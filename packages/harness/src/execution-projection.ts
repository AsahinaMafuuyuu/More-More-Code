import type { ExecutionEvent } from "./execution-events";
import type { AgentRun, AgentStep, AgentTurn } from "./types";

export class ExecutionProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionProjectionError";
  }
}

function assertRunning(status: string, label: string) {
  if (status !== "running") {
    throw new ExecutionProjectionError(`${label} is already terminal`);
  }
}

function assertNoRunningSteps(turn: AgentTurn) {
  if (turn.steps.some((step) => step.status === "running")) {
    throw new ExecutionProjectionError(
      `Cannot finish turn ${turn.id} while a step is still running`,
    );
  }
}

function requireTurn(turns: Map<string, AgentTurn>, turnId: string) {
  const turn = turns.get(turnId);
  if (!turn) {
    throw new ExecutionProjectionError(`Unknown turn referenced by event: ${turnId}`);
  }
  return turn;
}

function requireStep(
  steps: Map<string, AgentStep>,
  turnId: string,
  stepId: string,
) {
  const step = steps.get(stepId);
  if (!step) {
    throw new ExecutionProjectionError(`Unknown step referenced by event: ${stepId}`);
  }
  if (step.turnId !== turnId) {
    throw new ExecutionProjectionError(
      `Step ${stepId} does not belong to turn ${turnId}`,
    );
  }
  return step;
}

export function projectAgentRun(events: readonly ExecutionEvent[]): AgentRun | null {
  if (events.length === 0) return null;

  let run: AgentRun | null = null;
  let previousSequence = -1;
  const turns = new Map<string, AgentTurn>();
  const steps = new Map<string, AgentStep>();

  for (const event of events) {
    if (event.sequence !== previousSequence + 1) {
      throw new ExecutionProjectionError(
        `Execution event sequence is not contiguous: expected ${previousSequence + 1}, received ${event.sequence}`,
      );
    }
    previousSequence = event.sequence;

    if (!run) {
      if (event.type !== "run.started") {
        throw new ExecutionProjectionError("Execution history must begin with run.started");
      }

      run = {
        id: event.runId,
        sessionId: event.sessionId,
        status: "running",
        startedAt: event.timestamp,
        turns: [],
      };
      continue;
    }

    if (event.runId !== run.id) {
      throw new ExecutionProjectionError(
        `Execution history mixes runs ${run.id} and ${event.runId}`,
      );
    }

    if (event.sessionId !== run.sessionId) {
      throw new ExecutionProjectionError(
        `Execution history changes session within run ${run.id}`,
      );
    }

    switch (event.type) {
      case "run.started":
        throw new ExecutionProjectionError(`Run ${run.id} was started more than once`);

      case "turn.started": {
        assertRunning(run.status, `Run ${run.id}`);

        if (turns.has(event.turnId)) {
          throw new ExecutionProjectionError(`Duplicate turn id: ${event.turnId}`);
        }
        if (event.turnIndex !== run.turns.length) {
          throw new ExecutionProjectionError(
            `Turn ${event.turnId} index mismatch: expected ${run.turns.length}, received ${event.turnIndex}`,
          );
        }

        const turn: AgentTurn = {
          id: event.turnId,
          runId: run.id,
          index: event.turnIndex,
          cause: event.cause,
          ...(event.inputMessageId ? { inputMessageId: event.inputMessageId } : {}),
          ...(event.interactionId ? { interactionId: event.interactionId } : {}),
          status: "running",
          startedAt: event.timestamp,
          steps: [],
        };

        run.turns.push(turn);
        turns.set(turn.id, turn);
        break;
      }

      case "step.started": {
        assertRunning(run.status, `Run ${run.id}`);
        const turn = requireTurn(turns, event.turnId);
        assertRunning(turn.status, `Turn ${turn.id}`);

        if (steps.has(event.stepId)) {
          throw new ExecutionProjectionError(`Duplicate step id: ${event.stepId}`);
        }
        if (event.stepIndex !== turn.steps.length) {
          throw new ExecutionProjectionError(
            `Step ${event.stepId} index mismatch: expected ${turn.steps.length}, received ${event.stepIndex}`,
          );
        }

        const step: AgentStep = event.stepKind === "tool"
          ? {
              id: event.stepId,
              runId: run.id,
              turnId: turn.id,
              index: event.stepIndex,
              kind: "tool",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: "running",
              startedAt: event.timestamp,
            }
          : {
              id: event.stepId,
              runId: run.id,
              turnId: turn.id,
              index: event.stepIndex,
              kind: "model",
              status: "running",
              startedAt: event.timestamp,
            };

        turn.steps.push(step);
        steps.set(step.id, step);
        break;
      }

      case "step.completed": {
        const step = requireStep(steps, event.turnId, event.stepId);
        assertRunning(step.status, `Step ${step.id}`);
        step.status = "completed";
        step.endedAt = event.timestamp;
        break;
      }

      case "step.failed": {
        const step = requireStep(steps, event.turnId, event.stepId);
        assertRunning(step.status, `Step ${step.id}`);
        step.status = "failed";
        step.endedAt = event.timestamp;
        step.error = event.error;
        break;
      }

      case "step.interrupted": {
        const step = requireStep(steps, event.turnId, event.stepId);
        assertRunning(step.status, `Step ${step.id}`);
        step.status = "interrupted";
        step.endedAt = event.timestamp;
        break;
      }

      case "turn.completed": {
        const turn = requireTurn(turns, event.turnId);
        assertRunning(turn.status, `Turn ${turn.id}`);
        assertNoRunningSteps(turn);
        turn.status = "completed";
        turn.endedAt = event.timestamp;
        break;
      }

      case "turn.failed": {
        const turn = requireTurn(turns, event.turnId);
        assertRunning(turn.status, `Turn ${turn.id}`);
        assertNoRunningSteps(turn);
        turn.status = "failed";
        turn.endedAt = event.timestamp;
        turn.error = event.error;
        break;
      }

      case "turn.interrupted": {
        const turn = requireTurn(turns, event.turnId);
        assertRunning(turn.status, `Turn ${turn.id}`);
        assertNoRunningSteps(turn);
        turn.status = "interrupted";
        turn.endedAt = event.timestamp;
        break;
      }

      case "run.completed":
        assertRunning(run.status, `Run ${run.id}`);
        if (run.turns.some((turn) => turn.status === "running")) {
          throw new ExecutionProjectionError(
            `Cannot complete run ${run.id} while a turn is still running`,
          );
        }
        run.status = "completed";
        run.endedAt = event.timestamp;
        break;

      case "run.failed":
        assertRunning(run.status, `Run ${run.id}`);
        if (run.turns.some((turn) => turn.status === "running")) {
          throw new ExecutionProjectionError(
            `Cannot fail run ${run.id} while a turn is still running`,
          );
        }
        run.status = "failed";
        run.endedAt = event.timestamp;
        run.error = event.error;
        break;

      case "run.interrupted":
        assertRunning(run.status, `Run ${run.id}`);
        if (run.turns.some((turn) => turn.status === "running")) {
          throw new ExecutionProjectionError(
            `Cannot interrupt run ${run.id} while a turn is still running`,
          );
        }
        run.status = "interrupted";
        run.endedAt = event.timestamp;
        break;
    }
  }

  return run;
}

export function projectAgentRuns(events: readonly ExecutionEvent[]): AgentRun[] {
  const eventsByRun = new Map<string, ExecutionEvent[]>();
  const runOrder: string[] = [];

  for (const event of events) {
    let runEvents = eventsByRun.get(event.runId);
    if (!runEvents) {
      runEvents = [];
      eventsByRun.set(event.runId, runEvents);
      runOrder.push(event.runId);
    }
    runEvents.push(event);
  }

  return runOrder.map((runId) => {
    const run = projectAgentRun(eventsByRun.get(runId)!);
    if (!run) {
      throw new ExecutionProjectionError(`Unable to project run ${runId}`);
    }
    return run;
  });
}
