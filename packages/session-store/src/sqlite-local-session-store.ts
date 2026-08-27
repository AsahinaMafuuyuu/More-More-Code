import { createClient, type Client } from "@libsql/client";
import {
  SESSION_TREE_VERSION,
  type SessionEntry,
  type SessionTreeState,
} from "@more-more-code/harness";
import {
  LocalSessionArchivedError,
  LocalSessionConflictError,
  LocalSessionNotFoundError,
  LocalSessionStoreError,
} from "./errors";
import {
  canonicalEntry,
  canonicalizeJson,
  cloneJson,
  normalizeMetadata,
  normalizeSessionTreeState,
  parseCanonicalJson,
} from "./json";
import type {
  CommitLocalSessionInput,
  CreateLocalSessionInput,
  ListLocalSessionsOptions,
  LocalSession,
  LocalSessionEntry,
  LocalSessionMetadata,
  LocalSessionSnapshot,
  LocalSessionStore,
  LocalSessionStoreOptions,
} from "./types";

type SqlExecutor = Pick<Client, "execute">;

type StoredLocalSessionEntry<TMessage = unknown> = LocalSessionEntry<TMessage> & {
  entryJson: string;
};

/**
 * SQLite implementation of the semantic Session authority. Runtime lifecycle
 * events intentionally remain in runtime-store; this adapter only owns the
 * durable Harness Session Tree and its session-level metadata.
 */
export class SqliteLocalSessionStore implements LocalSessionStore {
  private readonly client: Client;
  private readonly now: () => number;
  /** Resolves after the last write transaction; reads wait for this boundary. */
  private writeTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: LocalSessionStoreOptions) {
    this.client = createClient({ url: options.databaseUrl });
    this.now = options.now ?? Date.now;
  }

  async create<TMessage = unknown>(
    input: CreateLocalSessionInput<TMessage>,
  ): Promise<LocalSession> {
    this.assertOpen();
    const id = assertIdentifier(input.id, "Local Session id");
    const title = assertTitle(input.title);
    const state = normalizeSessionTreeState(input.state);
    const metadata = normalizeMetadata(input.metadata === undefined ? {} : input.metadata);
    const now = this.nextTimestamp();

    return this.withWriteTransaction(async (transaction) => {
      const existing = await this.readSession(transaction, id);
      if (existing) {
        const entries = await this.readEntries<TMessage>(transaction, id);
        this.assertExactExistingCreate(existing, entries, { title, state, metadata });
        return cloneSession(existing);
      }

      await this.assertEntryIdsAvailable(transaction, state.entries.map((entry) => entry.id), id);
      const session: LocalSession = {
        id,
        title,
        metadata,
        rootEntryId: state.rootEntryId,
        activeEntryId: state.activeEntryId,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        revision: 0,
      };

      await transaction.execute({
        sql: `
          INSERT INTO "LocalSession" (
            "id", "title", "metadataJson", "rootEntryId", "activeEntryId",
            "createdAt", "updatedAt", "archivedAt", "revision"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          session.id,
          session.title,
          canonicalizeJson(session.metadata, `Local Session ${id} metadata`),
          session.rootEntryId,
          session.activeEntryId,
          session.createdAt,
          session.updatedAt,
          null,
          session.revision,
        ],
      });
      await this.insertEntries(transaction, id, state.entries, 1);
      return cloneSession(session);
    });
  }

  async get(sessionId: string): Promise<LocalSession | null> {
    this.assertOpen();
    await this.waitForWrites();
    return this.readSession(this.client, assertIdentifier(sessionId, "Local Session id"));
  }

  async load<TMessage = unknown>(sessionId: string): Promise<LocalSessionSnapshot<TMessage> | null> {
    this.assertOpen();
    await this.waitForWrites();
    const id = assertIdentifier(sessionId, "Local Session id");
    const session = await this.readSession(this.client, id);
    if (!session) return null;

    const entries = await this.readEntries<TMessage>(this.client, id);
    const state = normalizeSessionTreeState<TMessage>({
      version: SESSION_TREE_VERSION,
      rootEntryId: session.rootEntryId,
      activeEntryId: session.activeEntryId,
      entries: entries.map((stored) => cloneJson(stored.entry, `Local Session entry ${stored.entry.id}`)),
    });

    return {
      session: cloneSession(session),
      state,
      entries: entries.map((stored) => ({
        sessionId: stored.sessionId,
        sequence: stored.sequence,
        entry: cloneJson(stored.entry, `Local Session entry ${stored.entry.id}`),
      })),
    };
  }

  async list(options: ListLocalSessionsOptions = {}): Promise<LocalSession[]> {
    this.assertOpen();
    await this.waitForWrites();
    const result = await this.client.execute({
      sql: `
        SELECT * FROM "LocalSession"
        ${options.includeArchived ? "" : "WHERE \"archivedAt\" IS NULL"}
        ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" ASC
      `,
      args: [],
    });
    return result.rows.map((row) => mapSessionRow(row as Record<string, unknown>));
  }

  async commit<TMessage = unknown>(
    input: CommitLocalSessionInput<TMessage>,
  ): Promise<LocalSession> {
    this.assertOpen();
    const sessionId = assertIdentifier(input.sessionId, "Local Session id");
    const state = normalizeSessionTreeState(input.state);
    const requestedTitle = input.title === undefined ? undefined : assertTitle(input.title);
    const requestedMetadata = input.metadata === undefined
      ? undefined
      : normalizeMetadata(input.metadata);

    return this.withWriteTransaction(async (transaction) => {
      const session = await this.readSession(transaction, sessionId);
      if (!session) throw new LocalSessionNotFoundError(sessionId);
      if (session.archivedAt !== null) throw new LocalSessionArchivedError(sessionId);
      if (session.rootEntryId !== state.rootEntryId) {
        throw new LocalSessionConflictError(
          `Local Session ${sessionId} rootEntryId cannot change after creation`,
        );
      }

      const storedEntries = await this.readEntries<TMessage>(transaction, sessionId);
      const storedById = new Map(storedEntries.map((stored) => [stored.entry.id, stored]));
      const incomingById = new Map(state.entries.map((entry) => [entry.id, entry]));

      for (const stored of storedEntries) {
        const incoming = incomingById.get(stored.entry.id);
        if (!incoming) {
          throw new LocalSessionConflictError(
            `Commit for Local Session ${sessionId} omitted persisted entry ${stored.entry.id}`,
          );
        }
        if (canonicalEntry(incoming) !== stored.entryJson) {
          throw new LocalSessionConflictError(
            `Session entry ${stored.entry.id} conflicts with its already persisted content`,
          );
        }
      }

      const newEntries = state.entries.filter((entry) => !storedById.has(entry.id));
      // Do all collision checks before inserting any record. This keeps a retry
      // with a bad batch observationally atomic even on a shared database.
      await this.assertEntryIdsAvailable(
        transaction,
        newEntries.map((entry) => entry.id),
        sessionId,
      );

      const title = requestedTitle ?? session.title;
      const metadata = requestedMetadata ?? session.metadata;
      const metadataChanged = canonicalizeJson(metadata, "Local Session metadata")
        !== canonicalizeJson(session.metadata, "Local Session metadata");
      const changed = newEntries.length > 0
        || state.activeEntryId !== session.activeEntryId
        || title !== session.title
        || metadataChanged;

      if (!changed) return cloneSession(session);

      const updatedAt = this.nextTimestampAfter(session.updatedAt);
      const next: LocalSession = {
        ...session,
        title,
        metadata,
        activeEntryId: state.activeEntryId,
        updatedAt,
        revision: session.revision + 1,
      };

      await this.insertEntries(
        transaction,
        sessionId,
        newEntries,
        storedEntries.length + 1,
      );
      await transaction.execute({
        sql: `
          UPDATE "LocalSession"
          SET "title" = ?, "metadataJson" = ?, "activeEntryId" = ?,
              "updatedAt" = ?, "revision" = ?
          WHERE "id" = ?
        `,
        args: [
          next.title,
          canonicalizeJson(next.metadata, `Local Session ${sessionId} metadata`),
          next.activeEntryId,
          next.updatedAt,
          next.revision,
          sessionId,
        ],
      });

      return cloneSession(next);
    });
  }

  async archive(sessionId: string): Promise<LocalSession> {
    this.assertOpen();
    const id = assertIdentifier(sessionId, "Local Session id");

    return this.withWriteTransaction(async (transaction) => {
      const session = await this.readSession(transaction, id);
      if (!session) throw new LocalSessionNotFoundError(id);
      if (session.archivedAt !== null) return cloneSession(session);

      const archivedAt = this.nextTimestampAfter(session.updatedAt);
      const next: LocalSession = {
        ...session,
        archivedAt,
        updatedAt: archivedAt,
        revision: session.revision + 1,
      };
      await transaction.execute({
        sql: `
          UPDATE "LocalSession"
          SET "archivedAt" = ?, "updatedAt" = ?, "revision" = ?
          WHERE "id" = ?
        `,
        args: [next.archivedAt, next.updatedAt, next.revision, id],
      });
      return cloneSession(next);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.waitForWrites();
    this.client.close();
  }

  private async withWriteTransaction<TResult>(
    operation: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    let release!: () => void;
    const currentWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousWrite = this.writeTail;
    this.writeTail = currentWrite;
    await previousWrite;

    let transactionOpen = false;
    try {
      await this.client.execute("BEGIN IMMEDIATE");
      transactionOpen = true;
      const result = await operation(this.client);
      await this.client.execute("COMMIT");
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try {
          await this.client.execute("ROLLBACK");
        } catch {
          // The original error contains the meaningful database/domain failure.
        }
      }
      throw error;
    } finally {
      release();
    }
  }

  private async readSession(executor: SqlExecutor, sessionId: string): Promise<LocalSession | null> {
    const result = await executor.execute({
      sql: 'SELECT * FROM "LocalSession" WHERE "id" = ?',
      args: [sessionId],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapSessionRow(row) : null;
  }

  private async readEntries<TMessage>(
    executor: SqlExecutor,
    sessionId: string,
  ): Promise<StoredLocalSessionEntry<TMessage>[]> {
    const result = await executor.execute({
      sql: `
        SELECT * FROM "LocalSessionEntry"
        WHERE "sessionId" = ?
        ORDER BY "sequence" ASC
      `,
      args: [sessionId],
    });

    let previousSequence = 0;
    return result.rows.map((row) => {
      const stored = mapEntryRow<TMessage>(row as Record<string, unknown>);
      if (stored.sessionId !== sessionId) {
        throw new LocalSessionStoreError(
          `Stored Session entry ${stored.entry.id} belongs to the wrong Local Session`,
        );
      }
      if (stored.sequence <= previousSequence) {
        throw new LocalSessionStoreError(
          `Stored Session entry ${stored.entry.id} has a non-monotonic sequence`,
        );
      }
      previousSequence = stored.sequence;
      return stored;
    });
  }

  private async assertEntryIdsAvailable(
    transaction: SqlExecutor,
    entryIds: readonly string[],
    sessionId: string,
  ): Promise<void> {
    for (const entryId of entryIds) {
      const result = await transaction.execute({
        sql: 'SELECT "sessionId" FROM "LocalSessionEntry" WHERE "id" = ?',
        args: [entryId],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) continue;
      const owner = requiredString(row.sessionId, `Session entry ${entryId} owner`);
      const relationship = owner === sessionId ? "already exists" : `belongs to Local Session ${owner}`;
      throw new LocalSessionConflictError(`Session entry ${entryId} ${relationship}`);
    }
  }

  private async insertEntries<TMessage>(
    transaction: SqlExecutor,
    sessionId: string,
    entries: readonly SessionEntry<TMessage>[],
    firstSequence: number,
  ): Promise<void> {
    for (const [index, entry] of entries.entries()) {
      await transaction.execute({
        sql: `
          INSERT INTO "LocalSessionEntry" (
            "id", "sessionId", "sequence", "parentId", "type", "createdAt", "entryJson"
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          entry.id,
          sessionId,
          firstSequence + index,
          entry.parentId,
          entry.type,
          entry.createdAt,
          canonicalEntry(entry),
        ],
      });
    }
  }

  private assertExactExistingCreate<TMessage>(
    session: LocalSession,
    storedEntries: readonly StoredLocalSessionEntry<TMessage>[],
    input: {
      title: string;
      state: SessionTreeState<TMessage>;
      metadata: LocalSessionMetadata;
    },
  ): void {
    if (session.archivedAt !== null) {
      throw new LocalSessionConflictError(`Local Session ${session.id} is already archived`);
    }
    if (session.title !== input.title
      || session.rootEntryId !== input.state.rootEntryId
      || session.activeEntryId !== input.state.activeEntryId
      || canonicalizeJson(session.metadata, "Local Session metadata")
        !== canonicalizeJson(input.metadata, "Local Session metadata")
      || storedEntries.length !== input.state.entries.length) {
      throw new LocalSessionConflictError(`Local Session ${session.id} already exists with different content`);
    }

    const storedById = new Map(storedEntries.map((stored) => [stored.entry.id, stored]));
    for (const entry of input.state.entries) {
      const stored = storedById.get(entry.id);
      if (!stored || canonicalEntry(entry) !== stored.entryJson) {
        throw new LocalSessionConflictError(`Local Session ${session.id} already exists with different content`);
      }
    }
  }

  private nextTimestamp(): number {
    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new LocalSessionStoreError("Local Session Store clock must return a non-negative safe integer");
    }
    return timestamp;
  }

  private nextTimestampAfter(previous: number): number {
    const next = this.nextTimestamp();
    return Math.max(next, previous + 1);
  }

  private assertOpen(): void {
    if (this.closed) throw new LocalSessionStoreError("Local Session Store is closed");
  }

  private async waitForWrites(): Promise<void> {
    await this.writeTail;
  }
}

function mapSessionRow(row: Record<string, unknown>): LocalSession {
  const id = requiredString(row.id, "Local Session id");
  const title = assertTitle(requiredString(row.title, `Local Session ${id} title`));
  const rootEntryId = assertIdentifier(
    requiredString(row.rootEntryId, `Local Session ${id} rootEntryId`),
    "Local Session rootEntryId",
  );
  const activeEntryId = assertIdentifier(
    requiredString(row.activeEntryId, `Local Session ${id} activeEntryId`),
    "Local Session activeEntryId",
  );
  return {
    id,
    title,
    metadata: normalizeMetadata(
      parseCanonicalJson(
        requiredString(row.metadataJson, `Local Session ${id} metadata`),
        `Local Session ${id} metadata`,
      ),
      `Local Session ${id} metadata`,
    ),
    rootEntryId,
    activeEntryId,
    createdAt: requiredTimestamp(row.createdAt, `Local Session ${id} createdAt`),
    updatedAt: requiredTimestamp(row.updatedAt, `Local Session ${id} updatedAt`),
    archivedAt: row.archivedAt === null || row.archivedAt === undefined
      ? null
      : requiredTimestamp(row.archivedAt, `Local Session ${id} archivedAt`),
    revision: requiredNonNegativeInteger(row.revision, `Local Session ${id} revision`),
  };
}

function mapEntryRow<TMessage>(row: Record<string, unknown>): StoredLocalSessionEntry<TMessage> {
  const id = assertIdentifier(requiredString(row.id, "Stored Session entry id"), "Session entry id");
  const sessionId = assertIdentifier(
    requiredString(row.sessionId, `Stored Session entry ${id} sessionId`),
    "Local Session id",
  );
  const sequence = requiredPositiveInteger(row.sequence, `Stored Session entry ${id} sequence`);
  const parentId = row.parentId === null || row.parentId === undefined
    ? null
    : assertIdentifier(requiredString(row.parentId, `Stored Session entry ${id} parentId`), "Session entry parentId");
  const type = requiredString(row.type, `Stored Session entry ${id} type`);
  const createdAt = requiredTimestamp(row.createdAt, `Stored Session entry ${id} createdAt`);
  const entryJson = requiredString(row.entryJson, `Stored Session entry ${id} JSON`);
  const parsed = parseCanonicalJson(entryJson, `Stored Session entry ${id}`);
  if (!isRecord(parsed)) {
    throw new LocalSessionStoreError(`Stored Session entry ${id} is not a JSON object`);
  }
  if (canonicalizeJson(parsed, `Stored Session entry ${id}`) !== entryJson) {
    throw new LocalSessionStoreError(`Stored Session entry ${id} is not canonical JSON`);
  }
  if (parsed.id !== id
    || parsed.parentId !== parentId
    || parsed.type !== type
    || parsed.createdAt !== createdAt) {
    throw new LocalSessionStoreError(`Stored Session entry ${id} disagrees with its indexed fields`);
  }

  return {
    sessionId,
    sequence,
    entry: parsed as SessionEntry<TMessage>,
    entryJson,
  };
}

function cloneSession(session: LocalSession): LocalSession {
  return {
    ...session,
    metadata: cloneJson(session.metadata, `Local Session ${session.id} metadata`),
  };
}

function assertIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LocalSessionStoreError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertTitle(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LocalSessionStoreError("Local Session title must be a non-empty string");
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new LocalSessionStoreError(`${label} must be a string`);
  return value;
}

function requiredTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LocalSessionStoreError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  return requiredTimestamp(value, label);
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const number = requiredTimestamp(value, label);
  if (number < 1) throw new LocalSessionStoreError(`${label} must be a positive safe integer`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
