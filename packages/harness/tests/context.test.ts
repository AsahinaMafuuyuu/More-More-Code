import { describe, expect, test } from "bun:test";
import { ContextManager, type ContextRecord } from "../src";

function record(
  id: string,
  estimatedTokens: number,
  required = false,
  groupId?: string,
): ContextRecord<string> {
  return {
    id,
    kind: "history",
    payload: id,
    estimatedTokens,
    ...(required ? { required: true } : {}),
    ...(groupId ? { groupId } : {}),
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

  test("keeps complete turn groups instead of splitting a turn", () => {
    const manager = new ContextManager<string>();
    const projection = manager.project(
      [
        record("u1", 3, false, "turn-1"),
        record("a1", 3, false, "turn-1"),
        record("u2", 3, false, "turn-2"),
        record("a2", 3, false, "turn-2"),
      ],
      { contextWindowTokens: 9, reservedOutputTokens: 0 },
    );

    expect(projection.records.map((item) => item.id)).toEqual(["u2", "a2"]);
    expect(projection.omittedRecords.map((item) => item.id)).toEqual(["u1", "a1"]);
  });

  test("compacts omitted complete history into a bounded summary", async () => {
    const manager = new ContextManager<string>();
    const projection = await manager.projectWithCompaction(
      [
        record("u1", 5, false, "turn-1"),
        record("a1", 5, false, "turn-1"),
        record("u2", 3, true, "turn-2"),
        record("a2", 3, true, "turn-2"),
      ],
      { contextWindowTokens: 14, reservedOutputTokens: 0 },
      {
        compact({ records, targetTokens }) {
          expect(records.map((item) => item.id)).toEqual(["u1", "a1"]);
          expect(targetTokens).toBe(4);
          return {
            id: "summary",
            kind: "summary",
            payload: "summary",
            estimatedTokens: 4,
          };
        },
      },
      { maxSummaryTokens: 4 },
    );

    expect(projection.records.map((item) => item.id)).toEqual(["summary", "u2", "a2"]);
    expect(projection.estimatedInputTokens).toBe(10);
    expect(projection.truncated).toBe(false);
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
