import type {
  EventStore,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeEventType,
  RuntimeJsonValue,
  RuntimeSnapshot,
  RuntimeSnapshotInput,
  RuntimeStore,
} from "@more-more-code/harness";
import {
  isRuntimeEventPayload,
  isRuntimeEventType,
  isRuntimeJsonValue,
} from "@more-more-code/harness";
import type {
  RuntimeEvent as PrismaRuntimeEvent,
  RuntimeSnapshot as PrismaRuntimeSnapshot,
} from "../generated/prisma/client.ts";
import { createRuntimeStoreClient } from "./client";

export interface RuntimeStoreOptions {
  /** A caller-supplied SQLite `file:` URL. No process-cwd default is used. */
  databaseUrl: string;
}

export class RuntimeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeStoreError";
  }
}

/**
 * SQLite-backed durable Runtime Store. The generated Prisma model types remain
 * private to this adapter; callers only see the provider-independent Harness
 * contracts.
 */
export class SqliteRuntimeStore<TState extends RuntimeJsonValue = RuntimeJsonValue>
  implements RuntimeStore<TState>
{
  private readonly client;

  constructor(options: RuntimeStoreOptions) {
    this.client = createRuntimeStoreClient(options.databaseUrl);
  }

  async append<TType extends RuntimeEventType>(
    input: RuntimeEventInput<TType>,
  ): Promise<RuntimeEvent<TType>> {
    assertSessionId(input.sessionId);
    if (!isRuntimeEventType(input.type)) {
      throw new RuntimeStoreError(`Unknown Runtime Event type: ${String(input.type)}`);
    }
    if (!isRuntimeEventPayload(input.type, input.payload)) {
      throw new RuntimeStoreError(`Invalid ${input.type} Runtime Event payload`);
    }
    assertRuntimeJson(input.payload, "Runtime event payload");

    const row = await this.client.runtimeEvent.create({
      data: {
        sessionId: input.sessionId,
        type: input.type,
        payloadJson: serializeRuntimeJson(input.payload),
      },
    });
    const event = mapRuntimeEvent(row);

    if (event.type !== input.type) {
      throw new RuntimeStoreError("Stored Runtime Event type did not match appended type");
    }

    return event as RuntimeEvent<TType>;
  }

  async listAfter(sessionId: string, eventOffset: number): Promise<RuntimeEvent[]> {
    assertSessionId(sessionId);
    assertEventOffset(eventOffset, "eventOffset");

    const rows = await this.client.runtimeEvent.findMany({
      where: {
        sessionId,
        offset: { gt: eventOffset },
      },
      orderBy: { offset: "asc" },
    });

    return rows.map(mapRuntimeEvent);
  }

  async saveSnapshot(input: RuntimeSnapshotInput<TState>): Promise<RuntimeSnapshot<TState>> {
    assertSessionId(input.sessionId);
    assertEventOffset(input.eventOffset, "eventOffset");
    assertRuntimeJson(input.state, "Runtime Snapshot state");

    if (input.eventOffset > 0) {
      const boundaryEvent = await this.client.runtimeEvent.findFirst({
        where: {
          sessionId: input.sessionId,
          offset: input.eventOffset,
        },
        select: { offset: true },
      });

      if (!boundaryEvent) {
        throw new RuntimeStoreError(
          `Cannot save Runtime Snapshot at offset ${input.eventOffset}: no event belongs to session ${input.sessionId}`,
        );
      }
    }

    const row = await this.client.runtimeSnapshot.create({
      data: {
        sessionId: input.sessionId,
        eventOffset: input.eventOffset,
        stateJson: serializeRuntimeJson(input.state),
      },
    });

    return mapRuntimeSnapshot<TState>(row);
  }

  async latestSnapshot(sessionId: string): Promise<RuntimeSnapshot<TState> | null> {
    assertSessionId(sessionId);

    const row = await this.client.runtimeSnapshot.findFirst({
      where: { sessionId },
      orderBy: { sequence: "desc" },
    });

    return row ? mapRuntimeSnapshot<TState>(row) : null;
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}

function mapRuntimeEvent(row: PrismaRuntimeEvent): RuntimeEvent {
  if (!isRuntimeEventType(row.type)) {
    throw new RuntimeStoreError(`Unknown Runtime Event type in storage: ${row.type}`);
  }

  const payload = deserializeRuntimeJson(row.payloadJson, `Runtime Event ${row.id} payload`);
  if (!isRuntimeEventPayload(row.type, payload)) {
    throw new RuntimeStoreError(`Runtime Event ${row.id} contained an invalid ${row.type} payload`);
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    type: row.type,
    payload,
    offset: row.offset,
    timestamp: row.createdAt.getTime(),
  } as RuntimeEvent;
}

function mapRuntimeSnapshot<TState extends RuntimeJsonValue>(
  row: PrismaRuntimeSnapshot,
): RuntimeSnapshot<TState> {
  return {
    id: row.id,
    sessionId: row.sessionId,
    eventOffset: row.eventOffset,
    state: deserializeRuntimeJson(row.stateJson, `Runtime Snapshot ${row.id} state`) as TState,
    timestamp: row.createdAt.getTime(),
  };
}

function serializeRuntimeJson(value: RuntimeJsonValue): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeStoreError(`Runtime Store value could not be serialized: ${message}`);
  }
}

function deserializeRuntimeJson(serialized: string, label: string): RuntimeJsonValue {
  let value: unknown;

  try {
    value = JSON.parse(serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeStoreError(`${label} contained invalid JSON: ${message}`);
  }

  if (!isRuntimeJsonValue(value)) {
    throw new RuntimeStoreError(`${label} was not a JSON-safe Runtime value`);
  }

  return value;
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new RuntimeStoreError("Runtime Store sessionId must be a non-empty string");
  }
}

function assertEventOffset(offset: number, field: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RuntimeStoreError(`${field} must be a non-negative integer: ${offset}`);
  }
}

function assertRuntimeJson(value: unknown, label: string): asserts value is RuntimeJsonValue {
  if (!isRuntimeJsonValue(value)) {
    throw new RuntimeStoreError(`${label} must be JSON-safe`);
  }
}
