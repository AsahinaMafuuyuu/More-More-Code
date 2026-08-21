export interface RecoveryState {
  snapshot: unknown | null;
  events: unknown[];
}

export interface RecoveryEvent {
  sequence: number;
  payload: unknown;
}

export interface RecoveryStore {
  latestSnapshot(): Promise<{ eventOffset: number; state: unknown } | null>;
  listAfter(sequence: number): Promise<RecoveryEvent[]>;
}

export async function recoverRuntime(store: RecoveryStore): Promise<RecoveryState> {
  const snapshot = await store.latestSnapshot();
  const events = await store.listAfter(snapshot?.eventOffset ?? 0);
  return {
    snapshot: snapshot?.state ?? null,
    events,
  };
}

export interface RuntimeSnapshotStore {
  saveSnapshot(input: { eventOffset: number; state: unknown }): Promise<unknown>;
  latestSnapshot(): Promise<{ eventOffset: number; state: unknown } | null>;
}
