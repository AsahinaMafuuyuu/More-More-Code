import type { SessionEntry, SessionTreeState } from "@more-more-code/harness";

/**
 * Session metadata belongs to the local authority rather than the runtime
 * event stream. Values are checked to be JSON-safe at the persistence edge.
 */
export type LocalSessionMetadata = Record<string, unknown>;

export type LocalSession = {
  id: string;
  title: string;
  metadata: LocalSessionMetadata;
  rootEntryId: string;
  activeEntryId: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
};

export type LocalSessionEntry<TMessage = unknown> = {
  sessionId: string;
  /** A per-session, append-only sequence assigned by this store. */
  sequence: number;
  entry: SessionEntry<TMessage>;
};

export type LocalSessionSnapshot<TMessage = unknown> = {
  session: LocalSession;
  state: SessionTreeState<TMessage>;
  entries: LocalSessionEntry<TMessage>[];
};

export type CreateLocalSessionInput<TMessage = unknown> = {
  id: string;
  title: string;
  state: SessionTreeState<TMessage>;
  metadata?: LocalSessionMetadata;
};

export type CommitLocalSessionInput<TMessage = unknown> = {
  sessionId: string;
  state: SessionTreeState<TMessage>;
  /** Omitted fields retain their last committed values. */
  title?: string;
  metadata?: LocalSessionMetadata;
};

export type ListLocalSessionsOptions = {
  /** Archived sessions are excluded unless this is explicitly requested. */
  includeArchived?: boolean;
};

export interface LocalSessionStore {
  create<TMessage = unknown>(input: CreateLocalSessionInput<TMessage>): Promise<LocalSession>;
  /** Convenience metadata-only lookup. Prefer load() when opening a session. */
  get(sessionId: string): Promise<LocalSession | null>;
  load<TMessage = unknown>(sessionId: string): Promise<LocalSessionSnapshot<TMessage> | null>;
  list(options?: ListLocalSessionsOptions): Promise<LocalSession[]>;
  commit<TMessage = unknown>(input: CommitLocalSessionInput<TMessage>): Promise<LocalSession>;
  archive(sessionId: string): Promise<LocalSession>;
  close(): Promise<void>;
}

export type LocalSessionStoreOptions = {
  /** An absolute SQLite file URL. */
  databaseUrl: string;
  /** Allows deterministic timestamps in tests and embedding applications. */
  now?: () => number;
};

export type LocalSessionStoreBootstrapOptions = {
  databaseUrl?: string;
  homeDirectory?: string;
  now?: () => number;
};

export type BootstrappedLocalSessionStore = {
  databaseUrl: string;
  store: LocalSessionStore;
};
