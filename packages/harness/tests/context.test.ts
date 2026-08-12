import { describe, expect, test } from "bun:test";
import { ContextManager, type ContextRecord } from "../src";

function record(id: string, estimatedTokens: number, required = false): ContextRecord<string> {
  return {
    id,
    kind: "history",
    payload: id,
    estimatedTokens,
    ...(required ? { required: true } : {}),
  };
}

describe("ContextManager", () => {
  test("keeps the newest optional records that fit the input budget", () => {
    const manager = new ContextManager<string>();
    const projection = manager.project(
      [record("old", 4), record("middle", 4), record("new", 4)],
      {
        contextWindowTokens: 10,
        reservedOutputTokens: 2,
      },
    );

    expect(projection.inputBudgetTokens).toBe(8);
    expect(projection.records.map((item) => item.id)).toEqual(["middle", "new"]);
    expect(projection.estimatedInputTokens).toBe(8);
    expect(projection.truncated).toBe(true);
    expect(projection.overBudget).toBe(false);
  });

  test("keeps required records even when they exceed the safe input budget", () => {
    const manager = new ContextManager<string>();
    const projection = manager.project(
      [record("system", 7, true), record("new", 4, true), record("optional", 1)],
      {
        contextWindowTokens: 10,
        reservedOutputTokens: 2,
        safetyMarginTokens: 1,
      },
    );

    expect(projection.inputBudgetTokens).toBe(7);
    expect(projection.records.map((item) => item.id)).toEqual(["system", "new"]);
    expect(projection.estimatedInputTokens).toBe(11);
    expect(projection.overBudget).toBe(true);
  });
});
