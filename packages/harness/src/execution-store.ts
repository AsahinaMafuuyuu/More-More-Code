import type { ExecutionEvent } from "./execution-events";

export interface ExecutionEventStore {
  append(event: ExecutionEvent): void | Promise<void>;
  getEvents(): readonly ExecutionEvent[];
  getRunEvents(runId: string): readonly ExecutionEvent[];
}

export class ExecutionEventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionEventStoreError";
  }
}

function cloneEvent<TEvent extends ExecutionEvent>(event: TEvent): TEvent {
  return { ...event };
}

function isRunTerminalEvent(event: ExecutionEvent) {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.interrupted"
  );
}

export class InMemoryExecutionEventStore implements ExecutionEventStore {
  private readonly events: ExecutionEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly eventsByRun = new Map<string, ExecutionEvent[]>();

  append(event: ExecutionEvent) {
    if (this.eventIds.has(event.id)) {
      throw new ExecutionEventStoreError(`Duplicate execution event id: ${event.id}`);
    }

    if (!Number.isInteger(event.sequence) || event.sequence < 0) {
      throw new ExecutionEventStoreError(
        `Execution event sequence must be a non-negative integer: ${event.sequence}`,
      );
    }

    const runEvents = this.eventsByRun.get(event.runId) ?? [];

    if (runEvents.length === 0) {
      if (event.type !== "run.started") {
        throw new ExecutionEventStoreError(
          `First execution event for run ${event.runId} must be run.started`,
        );
      }

      if (event.sequence !== 0) {
        throw new ExecutionEventStoreError(
          `First execution event for run ${event.runId} must use sequence 0`,
        );
      }
    } else {
      const firstEvent = runEvents[0]!;
      const previousEvent = runEvents.at(-1)!;
      const expectedSequence = previousEvent.sequence + 1;

      if (event.sessionId !== firstEvent.sessionId) {
        throw new ExecutionEventStoreError(
          `Execution event session mismatch for run ${event.runId}`,
        );
      }

      if (event.sequence !== expectedSequence) {
        throw new ExecutionEventStoreError(
          `Execution event sequence mismatch for run ${event.runId}: expected ${expectedSequence}, received ${event.sequence}`,
        );
      }

      if (isRunTerminalEvent(previousEvent)) {
        throw new ExecutionEventStoreError(
          `Cannot append execution event after terminal run event for ${event.runId}`,
        );
      }
    }

    const stored = cloneEvent(event);
    this.events.push(stored);
    runEvents.push(stored);
    this.eventsByRun.set(event.runId, runEvents);
    this.eventIds.add(event.id);
  }

  getEvents(): readonly ExecutionEvent[] {
    return this.events.map(cloneEvent);
  }

  getRunEvents(runId: string): readonly ExecutionEvent[] {
    return (this.eventsByRun.get(runId) ?? []).map(cloneEvent);
  }
}
