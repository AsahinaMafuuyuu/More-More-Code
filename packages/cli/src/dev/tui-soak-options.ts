import type { TuiRenderProfileName } from "../tui/render-profile";

export type TuiSoakWorkload = "idle" | "stream" | "churn";

export type TuiSoakPressure = Readonly<{
  sourceIntervalMs: number | null;
  immediateIntervalMs: number | null;
  scrollIntervalMs: number | null;
  dialogIntervalMs: number | null;
  minSourceUpdatesPerSecond: number;
  minCoalescingRatio: number;
  minImmediateCommitsPerSecond: number;
  minScrollOperationsPerSecond: number;
  minDialogOperationsPerSecond: number;
}>;

export const DEFAULT_NATIVE_STRESS_MATRIX = Object.freeze([
  Object.freeze({ workload: "idle" as const, durationSeconds: 20 }),
  Object.freeze({ workload: "stream" as const, durationSeconds: 45 }),
  Object.freeze({ workload: "churn" as const, durationSeconds: 45 }),
]);

const PRESSURE_BY_WORKLOAD: Readonly<Record<TuiSoakWorkload, TuiSoakPressure>> = Object.freeze({
  idle: Object.freeze({
    sourceIntervalMs: null,
    immediateIntervalMs: null,
    scrollIntervalMs: null,
    dialogIntervalMs: null,
    minSourceUpdatesPerSecond: 0,
    minCoalescingRatio: 0,
    minImmediateCommitsPerSecond: 0,
    minScrollOperationsPerSecond: 0,
    minDialogOperationsPerSecond: 0,
  }),
  stream: Object.freeze({
    sourceIntervalMs: 1,
    immediateIntervalMs: null,
    scrollIntervalMs: null,
    dialogIntervalMs: null,
    minSourceUpdatesPerSecond: 100,
    minCoalescingRatio: 0.8,
    minImmediateCommitsPerSecond: 0,
    minScrollOperationsPerSecond: 0,
    minDialogOperationsPerSecond: 0,
  }),
  churn: Object.freeze({
    sourceIntervalMs: 2,
    immediateIntervalMs: 25,
    scrollIntervalMs: 10,
    dialogIntervalMs: 40,
    minSourceUpdatesPerSecond: 100,
    minCoalescingRatio: 0.75,
    minImmediateCommitsPerSecond: 15,
    minScrollOperationsPerSecond: 20,
    minDialogOperationsPerSecond: 8,
  }),
});

export type TuiSoakOptions = Readonly<{
  workload: TuiSoakWorkload;
  durationSeconds: number;
  renderProfile: TuiRenderProfileName;
}>;

export function resolveTuiSoakPressure(workload: TuiSoakWorkload): TuiSoakPressure {
  return PRESSURE_BY_WORKLOAD[workload];
}

export function parseTuiSoakOptions(args: readonly string[]): TuiSoakOptions {
  let workload: string | undefined;
  let duration: string | undefined;
  let renderProfile: string = "normal";

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--workload") {
      workload = value;
      index += 1;
    } else if (flag === "--duration") {
      duration = value;
      index += 1;
    } else if (flag === "--render-profile") {
      renderProfile = value ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown TUI soak argument ${JSON.stringify(flag)}.`);
    }
  }

  if (workload !== "idle" && workload !== "stream" && workload !== "churn") {
    throw new Error('TUI soak workload must be one of "idle", "stream", or "churn".');
  }
  const durationSeconds = Number(duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("TUI soak duration must be a positive number of seconds.");
  }
  if (renderProfile !== "normal" && renderProfile !== "safe") {
    throw new Error('TUI soak render profile must be "normal" or "safe".');
  }

  return Object.freeze({
    workload,
    durationSeconds,
    renderProfile,
  });
}
