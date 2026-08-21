export type RuntimeEventType =
  | "execution"
  | "tool"
  | "security"
  | "context"
  | "system";

export interface RuntimeEvent {
  id: string;
  sessionId?: string;
  type: RuntimeEventType;
  payload: unknown;
  createdAt: number;
  sequence: number;
}

export interface EventStore {
  append(event: Omit<RuntimeEvent, "id" | "createdAt" | "sequence">): Promise<RuntimeEvent>;
  listAfter(sequence: number): Promise<RuntimeEvent[]>;
}

export interface RuntimeSnapshot {
  id: string;
  eventOffset: number;
  state: unknown;
}
