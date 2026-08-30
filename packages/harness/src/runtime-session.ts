import type { ExecutionEvent } from "./execution-events";
import { projectAgentRun } from "./execution-projection";
import {
  InMemoryExecutionEventStore,
  type ExecutionEventStore,
} from "./execution-store";
import {
  isRuntimeEventPayload,
  RUNTIME_EVENT_SCHEMA_VERSION,
  type PersistedExecutionEvent,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventPayloadByType,
  type RuntimeEventType,
  type RuntimeJsonValue,
  type RuntimeStore,
} from "./event-store";
import { ProjectionCache } from "./projection-cache";
import { recoverRuntime, type PendingExternalOperation } from "./recovery";
import {
  createRuntimeUsageProjection,
  isRuntimeUsageProjection,
  reduceRuntimeUsageProjection,
  type RuntimeUsageProjection,
  type SessionUsageSummary,
} from "./runtime-usage";
import { SnapshotPolicy, type SnapshotPolicyOptions } from "./snapshot-policy";

type OpenRunProjection = {
  events: PersistedExecutionEvent[];
  lastEventOffset: number;
};

type PendingContextProjection = {
  eventOffset: number;
  operation: "model-step" | "manual-compaction";
};

export type RuntimeSessionProjection = {
  schemaVersion: 1;
  sessionId: string;
  openRuns: Record<string, OpenRunProjection>;
  pendingContexts: Record<string, PendingContextProjection>;
  /** Optional for backward compatibility with pre-usage Runtime snapshots. */
  usage?: RuntimeUsageProjection;
};

export type RuntimeSessionRecoveryReport = {
  sessionId: string;
  recoveredEventOffset: number;
  replayedEventCount: number;
  incompleteRunIds: readonly string[];
  pendingExternalOperations: readonly PendingExternalOperation[];
};

export type RuntimeSessionSnapshotDiagnostics = {
  consecutiveFailures: number;
  lastFailureAt?: number;
  nextRetryAt?: number;
};

type NonExecutionRuntimeEventType = Exclude<RuntimeEventType, "execution">;

export type RuntimeSessionFactInput<TType extends NonExecutionRuntimeEventType = NonExecutionRuntimeEventType> = {
  [T in TType]: {
    type: T;
    payload: RuntimeEventPayloadByType[T];
  };
}[TType];

export type RuntimeSessionOptions = {
  sessionId: string;
  store: RuntimeStore<RuntimeSessionProjection & RuntimeJsonValue>;
  projectionCache?: ProjectionCache<RuntimeSessionProjection>;
  snapshotPolicy?: SnapshotPolicy | SnapshotPolicyOptions;
  now?: () => number;
};

export class RuntimeSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeSessionError";
  }
}

/**
 * Deep local-runtime module: callers see the existing ExecutionEventStore seam
 * plus one typed fact recorder, while write-ahead ordering, replay, hot-cache,
 * and snapshots remain internal.
 */
export class RuntimeSession implements ExecutionEventStore {
  private memoryStore = new InMemoryExecutionEventStore();
  private readonly projectionCache: ProjectionCache<RuntimeSessionProjection>;
  private readonly snapshotPolicy: SnapshotPolicy;
  private readonly now: () => number;
  private readonly readyPromise: Promise<RuntimeSessionRecoveryReport>;
  private projection: RuntimeSessionProjection;
  private lastEventOffset = 0;
  private previousSnapshotOffset = 0;
  private previousSnapshotAt: number | undefined;
  private unsnapshottedEventCount = 0;
  private firstUnsnappedEventAt: number | undefined;
  private operationQueue: Promise<void> = Promise.resolve();
  private snapshotDiagnostics: RuntimeSessionSnapshotDiagnostics = {
    consecutiveFailures: 0,
  };

  constructor(private readonly options: RuntimeSessionOptions) {
    if (!options.sessionId.trim()) {
      throw new RuntimeSessionError("Runtime Session requires a non-empty sessionId");
    }

    this.projectionCache = options.projectionCache ?? new ProjectionCache();
    this.snapshotPolicy = options.snapshotPolicy instanceof SnapshotPolicy
      ? options.snapshotPolicy
      : new SnapshotPolicy(options.snapshotPolicy ?? {
        maxEvents: 50,
        maxAgeMs: 5 * 60_000,
      });
    this.now = options.now ?? Date.now;
    this.projection = createRuntimeSessionProjection(options.sessionId);
    this.readyPromise = this.initialize();
  }

  ready(): Promise<RuntimeSessionRecoveryReport> {
    return this.readyPromise;
  }

  getEvents(): readonly ExecutionEvent[] {
    return this.memoryStore.getEvents();
  }

  getRunEvents(runId: string): readonly ExecutionEvent[] {
    return this.memoryStore.getRunEvents(runId);
  }

  getSnapshotDiagnostics(): RuntimeSessionSnapshotDiagnostics {
    return { ...this.snapshotDiagnostics };
  }

  getUsageSummary(): SessionUsageSummary {
    return structuredClone(
      this.projection.usage?.summary ?? createRuntimeUsageProjection().summary,
    );
  }

  async append(event: ExecutionEvent): Promise<void> {
    await this.readyPromise;
    await this.enqueueOperation(async () => {
      if (event.sessionId !== this.options.sessionId) {
        throw new RuntimeSessionError(
          `Execution event session mismatch: expected ${this.options.sessionId}, received ${event.sessionId}`,
        );
      }

      // Validate the append against a disposable projection before durable I/O.
      // Once SQLite accepts the fact, the in-memory projection can no longer be
      // the source of a validation-only failure.
      const nextMemoryStore = new InMemoryExecutionEventStore(this.memoryStore.getEvents());
      nextMemoryStore.append(event);
      const payload = {
        schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
        kind: "execution.lifecycle",
        event: redactExecutionEvent(event),
      } as const;
      if (!isRuntimeEventPayload("execution", payload)) {
        throw new RuntimeSessionError("Execution event contains non-allowlisted durable fields");
      }
      const durableEvent = await this.options.store.append({
        sessionId: this.options.sessionId,
        type: "execution",
        payload,
      });

      this.memoryStore = nextMemoryStore;
      await this.applyDurableEvent(durableEvent as RuntimeEvent);
    });
  }

  async record<TType extends NonExecutionRuntimeEventType>(
    input: RuntimeSessionFactInput<TType>,
  ): Promise<RuntimeEvent<TType>> {
    await this.readyPromise;
    return this.enqueueOperation(async () => {
      if (!isRuntimeEventPayload(input.type, input.payload)) {
        throw new RuntimeSessionError(
          `${input.type} Runtime Event contains non-allowlisted durable fields`,
        );
      }
      const durableEvent = await this.options.store.append({
        sessionId: this.options.sessionId,
        type: input.type,
        payload: input.payload,
      } as RuntimeEventInput<TType>);
      await this.applyDurableEvent(durableEvent as RuntimeEvent);
      return durableEvent;
    });
  }

  private async initialize(): Promise<RuntimeSessionRecoveryReport> {
    const recovered = await recoverRuntime(this.options.store, {
      sessionId: this.options.sessionId,
      initialState: createRuntimeSessionProjection(this.options.sessionId) as RuntimeSessionProjection & RuntimeJsonValue,
      restoreSnapshot(snapshot) {
        if (!isRuntimeSessionProjection(snapshot.state, snapshot.sessionId)) {
          throw new RuntimeSessionError(
            `Runtime Snapshot ${snapshot.id} has an unsupported projection schema`,
          );
        }
        return structuredClone(snapshot.state);
      },
      reducer: (state, event) => reduceRuntimeSessionProjection(state, event),
    });

    if (!isRuntimeSessionProjection(recovered.state, this.options.sessionId)) {
      throw new RuntimeSessionError("Recovered Runtime Session projection is invalid");
    }

    this.projection = recovered.state;
    this.lastEventOffset = recovered.diagnostics.lastEventOffset;
    this.previousSnapshotOffset = recovered.snapshot?.eventOffset ?? 0;
    this.previousSnapshotAt = recovered.snapshot?.timestamp;
    this.unsnapshottedEventCount = recovered.replayedEvents.length;
    this.firstUnsnappedEventAt = recovered.replayedEvents[0]?.timestamp;
    this.memoryStore = new InMemoryExecutionEventStore(
      Object.values(this.projection.openRuns)
        .flatMap((run) => run.events.map(restoreExecutionEvent)),
    );
    this.projectionCache.set(
      this.options.sessionId,
      structuredClone(this.projection),
      this.lastEventOffset,
    );

    const report = createRecoveryReport(
      this.projection,
      recovered.diagnostics.lastEventOffset,
      recovered.diagnostics.replayedEventCount,
    );
    const openedEvent = await this.options.store.append({
      sessionId: this.options.sessionId,
      type: "system",
      payload: {
        schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
        kind: "runtime.session_opened",
        recoveredEventOffset: report.recoveredEventOffset,
        incompleteRunCount: report.incompleteRunIds.length,
        pendingExternalOperationCount: report.pendingExternalOperations.length,
      },
    });
    await this.applyDurableEvent(openedEvent);

    return report;
  }

  private async applyDurableEvent(event: RuntimeEvent): Promise<void> {
    this.projection = reduceRuntimeSessionProjection(this.projection, event);
    this.lastEventOffset = event.offset;
    this.unsnapshottedEventCount += 1;
    this.firstUnsnappedEventAt ??= event.timestamp;
    this.projectionCache.set(
      this.options.sessionId,
      structuredClone(this.projection),
      event.offset,
    );

    const snapshotNow = this.now();
    if (this.snapshotDiagnostics.nextRetryAt !== undefined
      && snapshotNow < this.snapshotDiagnostics.nextRetryAt) {
      return;
    }

    if (!this.snapshotPolicy.shouldSnapshot({
      currentEventOffset: event.offset,
      previousSnapshotOffset: this.previousSnapshotOffset,
      unsnapshottedEventCount: this.unsnapshottedEventCount,
      previousSnapshotAt: this.previousSnapshotAt,
      firstUnsnappedEventAt: this.firstUnsnappedEventAt,
      now: snapshotNow,
    })) {
      return;
    }

    try {
      const snapshot = await this.options.store.saveSnapshot({
        sessionId: this.options.sessionId,
        eventOffset: event.offset,
        state: structuredClone(this.projection) as RuntimeSessionProjection & RuntimeJsonValue,
      });
      this.previousSnapshotOffset = snapshot.eventOffset;
      this.previousSnapshotAt = snapshot.timestamp;
      this.unsnapshottedEventCount = 0;
      this.firstUnsnappedEventAt = undefined;
      this.snapshotDiagnostics = { consecutiveFailures: 0 };
    } catch {
      // The event is already durable and the in-memory projection has advanced.
      // Snapshotting is derived acceleration, so leave the counters intact and
      // retry with bounded backoff instead of misreporting the committed append
      // as a write-ahead failure or amplifying a persistent snapshot outage.
      const consecutiveFailures = this.snapshotDiagnostics.consecutiveFailures + 1;
      const retryDelayMs = Math.min(
        60_000,
        1_000 * (2 ** Math.min(consecutiveFailures - 1, 6)),
      );
      this.snapshotDiagnostics = {
        consecutiveFailures,
        lastFailureAt: snapshotNow,
        nextRetryAt: snapshotNow + retryDelayMs,
      };
    }
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createRuntimeSessionProjection(sessionId: string): RuntimeSessionProjection {
  return {
    schemaVersion: 1,
    sessionId,
    openRuns: {},
    pendingContexts: {},
    usage: createRuntimeUsageProjection(),
  };
}

export function reduceRuntimeSessionProjection<TState extends RuntimeJsonValue>(
  state: TState,
  event: RuntimeEvent,
): TState {
  if (!isRuntimeSessionProjection(state, event.sessionId)) {
    throw new RuntimeSessionError("Runtime Event cannot be applied to an incompatible projection");
  }

  const next = structuredClone(state);
  if (event.type === "execution") {
    const executionEvent = event.payload.event;
    if (executionEvent.type === "run.started") {
      if (next.openRuns[executionEvent.runId]) {
        throw new RuntimeSessionError(`Runtime projection contains duplicate run ${executionEvent.runId}`);
      }
      next.openRuns[executionEvent.runId] = {
        events: [structuredClone(executionEvent)],
        lastEventOffset: event.offset,
      };
    } else {
      const openRun = next.openRuns[executionEvent.runId];
      if (!openRun) {
        throw new RuntimeSessionError(
          `Runtime projection received ${executionEvent.type} for unknown run ${executionEvent.runId}`,
        );
      }
      openRun.events.push(structuredClone(executionEvent));
      openRun.lastEventOffset = event.offset;
      if (executionEvent.type === "run.completed"
        || executionEvent.type === "run.failed"
        || executionEvent.type === "run.interrupted") {
        delete next.openRuns[executionEvent.runId];
      }
    }
  }

  if (event.type === "context") {
    if (event.payload.phase === "started") {
      next.pendingContexts[event.payload.operationId] = {
        eventOffset: event.offset,
        operation: event.payload.operation,
      };
    } else {
      delete next.pendingContexts[event.payload.operationId];
    }
  }

  if (event.type === "usage") {
    next.usage = reduceRuntimeUsageProjection(
      next.usage ?? createRuntimeUsageProjection(),
      event,
    );
  }

  return next as TState;
}

export function isRuntimeSessionProjection(
  value: unknown,
  sessionId?: string,
): value is RuntimeSessionProjection & RuntimeJsonValue {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.sessionId !== "string"
    || (sessionId !== undefined && value.sessionId !== sessionId)
    || !isRecord(value.openRuns)
    || !isRecord(value.pendingContexts)
    || (value.usage !== undefined && !isRuntimeUsageProjection(value.usage))) {
    return false;
  }

  return Object.values(value.openRuns).every((run) =>
    isRecord(run)
    && Array.isArray(run.events)
    && run.events.every((event) => isRuntimeEventPayload("execution", {
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      kind: "execution.lifecycle",
      event,
    }))
    && Number.isSafeInteger(run.lastEventOffset)
    && Number(run.lastEventOffset) >= 0)
    && Object.values(value.pendingContexts).every((operation) =>
      isRecord(operation)
      && Number.isSafeInteger(operation.eventOffset)
      && Number(operation.eventOffset) >= 0
      && (operation.operation === "model-step" || operation.operation === "manual-compaction"));
}

function createRecoveryReport(
  projection: RuntimeSessionProjection,
  recoveredEventOffset: number,
  replayedEventCount: number,
): RuntimeSessionRecoveryReport {
  const pendingExternalOperations: PendingExternalOperation[] = [];

  for (const [runId, openRun] of Object.entries(projection.openRuns)) {
    const run = projectAgentRun(openRun.events.map(restoreExecutionEvent));
    const activeStep = run?.turns
      .findLast((turn) => turn.status === "running")
      ?.steps.findLast((step) => step.status === "running");
    if (activeStep) {
      pendingExternalOperations.push({
        id: activeStep.id,
        eventOffset: openRun.lastEventOffset,
        kind: activeStep.kind,
      });
    }

    if (!run || run.id !== runId || run.status !== "running") {
      throw new RuntimeSessionError(`Open Runtime projection for ${runId} is inconsistent`);
    }
  }

  for (const [operationId, context] of Object.entries(projection.pendingContexts)) {
    pendingExternalOperations.push({
      id: operationId,
      eventOffset: context.eventOffset,
      kind: context.operation,
    });
  }

  return {
    sessionId: projection.sessionId,
    recoveredEventOffset,
    replayedEventCount,
    incompleteRunIds: Object.keys(projection.openRuns),
    pendingExternalOperations: pendingExternalOperations.sort(
      (left, right) => left.eventOffset - right.eventOffset,
    ),
  };
}

function redactExecutionEvent(event: ExecutionEvent): PersistedExecutionEvent {
  if (event.type === "run.failed"
    || event.type === "turn.failed"
    || event.type === "step.failed") {
    const { error: _error, ...safeEvent } = event;
    return { ...safeEvent, errorCode: "execution_failed" } as PersistedExecutionEvent;
  }
  return structuredClone(event) as PersistedExecutionEvent;
}

function restoreExecutionEvent(event: PersistedExecutionEvent): ExecutionEvent {
  if (event.type === "run.failed"
    || event.type === "turn.failed"
    || event.type === "step.failed") {
    const { errorCode: _errorCode, ...safeEvent } = event;
    return {
      ...safeEvent,
      error: "Execution failed; sensitive details were not persisted",
    } as ExecutionEvent;
  }
  return structuredClone(event) as ExecutionEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
