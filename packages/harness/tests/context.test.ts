import { describe, expect, test } from "bun:test";
import {
  ContextManager,
  compileContextRecords,
  type ContextRecord,
} from "../src";

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

describe("canonical context compilation", () => {
  test("orders records from stable prefix to dynamic input deterministically", () => {
    const records: ContextRecord<string>[] = [
      { id: "input", kind: "runtime", category: "current-input", payload: "input", estimatedTokens: 1 },
      { id: "tool-b", kind: "instruction", category: "tool-definition", deterministicKey: "b", payload: "b", estimatedTokens: 1 },
      { id: "history", kind: "history", category: "historical-conversation", payload: "history", estimatedTokens: 1 },
      { id: "project", kind: "instruction", category: "project-instruction", payload: "project", estimatedTokens: 1 },
      { id: "core", kind: "instruction", category: "core-instruction", payload: "core", estimatedTokens: 1 },
      { id: "checkpoint", kind: "summary", payload: "checkpoint", estimatedTokens: 1 },
      { id: "tool-a", kind: "instruction", category: "tool-definition", deterministicKey: "a", payload: "a", estimatedTokens: 1 },
      { id: "retained", kind: "history", category: "retained-turn", payload: "retained", estimatedTokens: 1 },
      { id: "global", kind: "instruction", category: "global-instruction", payload: "global", estimatedTokens: 1 },
      { id: "skill", kind: "instruction", category: "skill-catalog", payload: "skill", estimatedTokens: 1 },
      { id: "runtime", kind: "runtime", payload: "runtime", estimatedTokens: 1 },
    ];

    expect(compileContextRecords(records).map((item) => item.id)).toEqual([
      "core",
      "global",
      "project",
      "skill",
      "tool-a",
      "tool-b",
      "checkpoint",
      "history",
      "retained",
      "runtime",
      "input",
    ]);
  });
});

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

  test("reuses a persisted checkpoint when no new compaction is required", async () => {
    const manager = new ContextManager<string>();
    let compactCalls = 0;
    const projection = await manager.projectWithCompaction(
      [
        { id: "checkpoint", kind: "summary", payload: "checkpoint", estimatedTokens: 2, required: true },
        record("u2", 2, false, "turn-2"),
        record("a2", 2, false, "turn-2"),
      ],
      { contextWindowTokens: 10, reservedOutputTokens: 0 },
      {
        compact() {
          compactCalls += 1;
          return null;
        },
      },
    );

    expect(compactCalls).toBe(0);
    expect(projection.records.map((item) => item.id)).toEqual(["checkpoint", "u2", "a2"]);
  });

  test("supersedes the persisted checkpoint only when new history requires compaction", async () => {
    const manager = new ContextManager<string>();
    const projection = await manager.projectWithCompaction(
      [
        { id: "checkpoint-old", kind: "summary", payload: "old summary", estimatedTokens: 2, required: true },
        record("old", 5),
        record("tail", 4, true, "tail"),
      ],
      { contextWindowTokens: 8, reservedOutputTokens: 0 },
      {
        compact({ records, targetTokens }) {
          expect(records.map((item) => item.id)).toEqual(["checkpoint-old", "old"]);
          expect(targetTokens).toBe(3);
          return {
            id: "checkpoint-new",
            kind: "summary",
            payload: "new summary",
            estimatedTokens: 3,
          };
        },
      },
      { maxSummaryTokens: 3 },
    );

    expect(projection.records.map((item) => item.id)).toEqual(["checkpoint-new", "tail"]);
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
