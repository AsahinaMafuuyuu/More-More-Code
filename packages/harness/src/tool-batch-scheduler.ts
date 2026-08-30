import type {
  AgentToolBatchExecution,
  ToolExecutionMode,
} from "./types";

export const DEFAULT_TOOL_BATCH_EXECUTION: AgentToolBatchExecution = Object.freeze({
  mode: "serial",
  maxConcurrency: 4,
});

export const MAX_TOOL_BATCH_CONCURRENCY = 16;

export type ToolBatchWave<T> = readonly T[];

/**
 * Provider-independent Tool Batch planner.
 *
 * It deliberately does not infer resource dependencies. Parallel mode only
 * groups calls explicitly declared safe by the caller; unsafe/unknown calls
 * are isolated behind a wave barrier. Wave order and item order are stable.
 */
export class ToolBatchScheduler {
  readonly mode: ToolExecutionMode;
  readonly maxConcurrency: number;

  constructor(config: Partial<AgentToolBatchExecution> = {}) {
    this.mode = config.mode ?? DEFAULT_TOOL_BATCH_EXECUTION.mode;
    this.maxConcurrency = config.maxConcurrency ?? DEFAULT_TOOL_BATCH_EXECUTION.maxConcurrency;

    if (this.mode !== "serial" && this.mode !== "parallel") {
      throw new Error(`Unsupported Tool execution mode: ${String(this.mode)}`);
    }
    if (
      !Number.isInteger(this.maxConcurrency)
      || this.maxConcurrency < 1
      || this.maxConcurrency > MAX_TOOL_BATCH_CONCURRENCY
    ) {
      throw new Error(
        `Tool execution maxConcurrency must be an integer between 1 and ${MAX_TOOL_BATCH_CONCURRENCY}`,
      );
    }
  }

  plan<T>(items: readonly T[], isParallelSafe: (item: T) => boolean): ToolBatchWave<T>[] {
    if (this.mode === "serial") return items.map((item) => [item]);

    const waves: T[][] = [];
    let safeWave: T[] = [];
    const flushSafeWave = () => {
      if (safeWave.length === 0) return;
      waves.push(safeWave);
      safeWave = [];
    };

    for (const item of items) {
      if (!isParallelSafe(item)) {
        flushSafeWave();
        waves.push([item]);
        continue;
      }

      safeWave.push(item);
      if (safeWave.length >= this.maxConcurrency) flushSafeWave();
    }
    flushSafeWave();
    return waves;
  }
}
