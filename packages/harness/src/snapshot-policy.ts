export interface SnapshotPolicyOptions {
  maxEvents: number;
  maxAgeMs: number;
}

export interface SnapshotPolicyInput {
  /**
   * Global durable cursor. It is useful for locating a snapshot, but cannot
   * be used to count one session's events because other sessions interleave.
   */
  currentEventOffset: number;
  previousSnapshotOffset?: number;
  /** Number of events for this session written since its last snapshot. */
  unsnapshottedEventCount: number;
  previousSnapshotAt?: number;
  /** Age origin before the very first snapshot has been written. */
  firstUnsnappedEventAt?: number;
  now?: number;
}

export class SnapshotPolicy {
  constructor(private readonly options: SnapshotPolicyOptions) {
    if (!Number.isSafeInteger(options.maxEvents) || options.maxEvents <= 0) {
      throw new RangeError(`Snapshot maxEvents must be a positive integer: ${options.maxEvents}`);
    }

    if (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs <= 0) {
      throw new RangeError(`Snapshot maxAgeMs must be a positive finite number: ${options.maxAgeMs}`);
    }
  }

  shouldSnapshot(input: SnapshotPolicyInput): boolean {
    assertOffset(input.currentEventOffset, "currentEventOffset");

    const previousSnapshotOffset = input.previousSnapshotOffset ?? 0;
    assertOffset(previousSnapshotOffset, "previousSnapshotOffset");

    if (previousSnapshotOffset > input.currentEventOffset) {
      throw new RangeError("previousSnapshotOffset cannot be greater than currentEventOffset");
    }

    assertEventCount(input.unsnapshottedEventCount);
    const eventCount = input.unsnapshottedEventCount;
    if (eventCount === 0) {
      return false;
    }

    const ageOrigin = input.previousSnapshotAt ?? input.firstUnsnappedEventAt;
    const age = ageOrigin === undefined ? 0 : (input.now ?? Date.now()) - ageOrigin;

    return eventCount >= this.options.maxEvents || age >= this.options.maxAgeMs;
  }
}

function assertOffset(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer: ${value}`);
  }
}

function assertEventCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`unsnapshottedEventCount must be a non-negative integer: ${value}`);
  }
}
