import type {
  EventStore,
  RuntimeEvent,
  RuntimeJsonValue,
  RuntimeSnapshot,
  RuntimeSnapshotStore,
} from "./event-store";

export interface RecoveryStore<TState extends RuntimeJsonValue = RuntimeJsonValue>
  extends Pick<EventStore, "listAfter">,
    Pick<RuntimeSnapshotStore<TState>, "latestSnapshot"> {}

export type RuntimeProjectionReducer<TState extends RuntimeJsonValue> = (
  state: TState,
  event: RuntimeEvent,
) => TState | Promise<TState>;

export interface PendingExternalOperation {
  id: string;
  eventOffset: number;
  kind?: string;
}

export interface RecoveryOptions<TState extends RuntimeJsonValue> {
  sessionId: string;
  initialState: TState;
  reducer: RuntimeProjectionReducer<TState>;
  /**
   * Use this when a snapshot must be normalized before projection. If omitted,
   * the persisted JSON state is used directly.
   */
  restoreSnapshot?: (snapshot: RuntimeSnapshot<TState>) => TState;
  /**
   * Recovery deliberately only reports unfinished external work. It never
   * invokes or re-starts an operation on the caller's behalf.
   */
  findPendingExternalOperations?: (input: {
    state: TState;
    snapshot: RuntimeSnapshot<TState> | null;
    replayedEvents: readonly RuntimeEvent[];
  }) => readonly PendingExternalOperation[];
}

export interface RecoveryDiagnostics {
  snapshotEventOffset: number | null;
  replayedEventCount: number;
  lastEventOffset: number;
  pendingExternalOperations: readonly PendingExternalOperation[];
}

export interface RecoveryState<TState extends RuntimeJsonValue> {
  state: TState;
  snapshot: RuntimeSnapshot<TState> | null;
  replayedEvents: readonly RuntimeEvent[];
  diagnostics: RecoveryDiagnostics;
}

export async function recoverRuntime<TState extends RuntimeJsonValue>(
  store: RecoveryStore<TState>,
  options: RecoveryOptions<TState>,
): Promise<RecoveryState<TState>> {
  const snapshot = await store.latestSnapshot(options.sessionId);
  const snapshotEventOffset = snapshot?.eventOffset ?? 0;
  const replayedEvents = await store.listAfter(options.sessionId, snapshotEventOffset);

  let state = snapshot
    ? options.restoreSnapshot?.(snapshot) ?? structuredClone(snapshot.state)
    : structuredClone(options.initialState);

  for (const event of replayedEvents) {
    state = await options.reducer(state, event);
  }

  const lastEventOffset = replayedEvents.at(-1)?.offset ?? snapshotEventOffset;
  const pendingExternalOperations = options.findPendingExternalOperations?.({
    state,
    snapshot,
    replayedEvents,
  }) ?? [];

  return {
    state,
    snapshot,
    replayedEvents,
    diagnostics: {
      snapshotEventOffset: snapshot?.eventOffset ?? null,
      replayedEventCount: replayedEvents.length,
      lastEventOffset,
      pendingExternalOperations: [...pendingExternalOperations],
    },
  };
}
