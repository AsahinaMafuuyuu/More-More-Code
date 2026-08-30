import type { TuiRenderProfileName } from "./render-profile";

export type TuiStabilityStoreSlice =
  | "conversation"
  | "activity"
  | "status"
  | "composerRuntime"
  | "approval"
  | "recovery"
  | "inspector";

export type TuiStabilitySnapshot = Readonly<{
  bunVersion: string;
  bunRevision?: string;
  opentuiVersion: string;
  profile: TuiRenderProfileName;
  elapsedMs: number;
  storeCommits: Readonly<Record<TuiStabilityStoreSlice, number>>;
  coalescedCommits: number;
  activityTicks: number;
  rssBytes: number;
  heapUsedBytes: number;
  terminalWidth: number;
  terminalHeight: number;
}>;

export type TuiStabilityProbe = Readonly<{
  enabled: boolean;
  recordStoreCommit(slice: TuiStabilityStoreSlice): void;
  recordCoalescedCommit(): void;
  recordActivityTick(): void;
  snapshot(dimensions?: Readonly<{
    terminalWidth?: number;
    terminalHeight?: number;
  }>): TuiStabilitySnapshot | null;
}>;

export type TuiStabilityProbeOptions = Readonly<{
  enabled?: boolean;
  bunVersion: string;
  bunRevision?: string;
  opentuiVersion: string;
  profile: TuiRenderProfileName;
  startedAtMs?: number;
  now?: () => number;
  readMemory?: () => Readonly<{ rssBytes: number; heapUsedBytes: number }>;
}>;

const STORE_SLICES: readonly TuiStabilityStoreSlice[] = [
  "conversation",
  "activity",
  "status",
  "composerRuntime",
  "approval",
  "recovery",
  "inspector",
];

export function createTuiStabilityProbe(options: TuiStabilityProbeOptions): TuiStabilityProbe {
  const enabled = options.enabled ?? false;
  const now = options.now ?? Date.now;
  const startedAtMs = options.startedAtMs ?? now();
  const readMemory = options.readMemory ?? readProcessMemory;
  const storeCommits = createZeroStoreCommits();
  let coalescedCommits = 0;
  let activityTicks = 0;

  return Object.freeze({
    enabled,
    recordStoreCommit(slice) {
      if (!enabled) return;
      storeCommits[slice] += 1;
    },
    recordCoalescedCommit() {
      if (!enabled) return;
      coalescedCommits += 1;
    },
    recordActivityTick() {
      if (!enabled) return;
      activityTicks += 1;
    },
    snapshot(dimensions = {}) {
      if (!enabled) return null;
      const memory = readMemory();
      return Object.freeze({
        bunVersion: options.bunVersion,
        ...(options.bunRevision ? { bunRevision: options.bunRevision } : {}),
        opentuiVersion: options.opentuiVersion,
        profile: options.profile,
        elapsedMs: Math.max(0, now() - startedAtMs),
        storeCommits: Object.freeze({ ...storeCommits }),
        coalescedCommits,
        activityTicks,
        rssBytes: memory.rssBytes,
        heapUsedBytes: memory.heapUsedBytes,
        terminalWidth: dimensions.terminalWidth ?? process.stdout.columns ?? 0,
        terminalHeight: dimensions.terminalHeight ?? process.stdout.rows ?? 0,
      });
    },
  });
}

function createZeroStoreCommits(): Record<TuiStabilityStoreSlice, number> {
  return Object.fromEntries(STORE_SLICES.map((slice) => [slice, 0])) as Record<
    TuiStabilityStoreSlice,
    number
  >;
}

function readProcessMemory(): Readonly<{ rssBytes: number; heapUsedBytes: number }> {
  const memory = process.memoryUsage();
  return Object.freeze({
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
  });
}
