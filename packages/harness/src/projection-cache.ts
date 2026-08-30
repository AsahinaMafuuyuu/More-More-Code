export interface ProjectionCacheEntry<T = unknown> {
  key: string;
  state: T;
  eventOffset: number;
  updatedAt: number;
}

/**
 * Runtime hot state cache. Durable truth remains EventStore.
 */
export class ProjectionCache<T = unknown> {
  private readonly entries = new Map<string, ProjectionCacheEntry<T>>();

  get(key: string): ProjectionCacheEntry<T> | undefined {
    const value = this.entries.get(key);
    return value ? { ...value } : undefined;
  }

  set(key: string, state: T, eventOffset: number): ProjectionCacheEntry<T> {
    assertValidOffset(eventOffset);

    const previous = this.entries.get(key);
    if (previous && previous.eventOffset > eventOffset) {
      return { ...previous };
    }

    const entry = {
      key,
      state,
      eventOffset,
      updatedAt: Date.now(),
    };
    this.entries.set(key, entry);
    return { ...entry };
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

function assertValidOffset(eventOffset: number): void {
  if (!Number.isSafeInteger(eventOffset) || eventOffset < 0) {
    throw new RangeError(`Projection cache offset must be a non-negative integer: ${eventOffset}`);
  }
}
