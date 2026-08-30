import { describe, expect, test } from "bun:test";
import {
  MAX_TOOL_BATCH_CONCURRENCY,
  ToolBatchScheduler,
} from "../src";

describe("ToolBatchScheduler", () => {
  test("defaults to deterministic serial waves", () => {
    const scheduler = new ToolBatchScheduler();
    expect(scheduler.plan(["a", "b", "c"], () => true)).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  test("parallel mode chunks safe Tools and isolates unsafe Tools", () => {
    const scheduler = new ToolBatchScheduler({ mode: "parallel", maxConcurrency: 2 });
    const waves = scheduler.plan(
      ["a", "b", "unsafe", "c", "d", "e"],
      (item) => item !== "unsafe",
    );
    expect(waves).toEqual([
      ["a", "b"],
      ["unsafe"],
      ["c", "d"],
      ["e"],
    ]);
  });

  test("rejects invalid concurrency", () => {
    expect(() => new ToolBatchScheduler({ mode: "parallel", maxConcurrency: 0 })).toThrow();
    expect(() => new ToolBatchScheduler({
      mode: "parallel",
      maxConcurrency: MAX_TOOL_BATCH_CONCURRENCY + 1,
    })).toThrow();
  });
});
