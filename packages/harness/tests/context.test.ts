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

const RELAXED_MANUAL_ELIGIBILITY = {
  manualMinCompactableTokens: 0,
  manualMinCompactableRatio: 0,
  manualMinTurnsSinceCheckpoint: 0,
  manualMinEstimatedGainTokens: 0,
  manualMinEstimatedGainInputRatio: 0,
  manualMinEstimatedGainRatio: 0,
} as const;

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

  test("proactively compacts older complete turns at the soft limit and leaves headroom", async () => {
    const manager = new ContextManager<string>();
    const projection = await manager.projectWithCompaction(
      [
        record("u1", 4, false, "turn-1"),
        record("a1", 4, false, "turn-1"),
        record("u2", 3, false, "turn-2"),
        record("a2", 3, false, "turn-2"),
        record("u3", 2, true, "turn-3"),
        record("a3", 2, true, "turn-3"),
      ],
      { contextWindowTokens: 20, reservedOutputTokens: 0 },
      {
        compact({ records, newlyCompactedRecords, trigger, targetTokens }) {
          expect(trigger).toBe("soft-limit");
          expect(records.map((item) => item.id)).toEqual(["u1", "a1"]);
          expect(newlyCompactedRecords.map((item) => item.id)).toEqual(["u1", "a1"]);
          expect(targetTokens).toBe(3);
          return {
            id: "summary-soft",
            kind: "summary",
            payload: "summary",
            estimatedTokens: 3,
          };
        },
      },
      {
        maxSummaryTokens: 3,
        softLimitRatio: 0.8,
        hardLimitRatio: 0.95,
        targetUtilizationRatio: 0.7,
      },
    );

    expect(projection.records.map((item) => item.id)).toEqual([
      "summary-soft",
      "u2",
      "a2",
      "u3",
      "a3",
    ]);
    expect(projection.truncated).toBe(false);
    expect(projection.compaction).toMatchObject({
      trigger: "soft-limit",
      inputTokensBefore: 18,
      inputTokensAfter: 13,
      compactedRecordIds: ["u1", "a1"],
      compactedThroughRecordId: "a1",
    });
  });

  test("classifies proactive compaction above the hard threshold separately from overflow", async () => {
    const manager = new ContextManager<string>();
    let observedTrigger = "";
    const projection = await manager.projectWithCompaction(
      [
        record("old", 8, false, "turn-1"),
        record("middle", 6, false, "turn-2"),
        record("tail", 4, true, "turn-3"),
      ],
      { contextWindowTokens: 20, reservedOutputTokens: 0 },
      {
        compact({ trigger }) {
          observedTrigger = trigger;
          return {
            id: "summary-hard",
            kind: "summary",
            payload: "summary",
            estimatedTokens: 2,
          };
        },
      },
      {
        maxSummaryTokens: 2,
        softLimitRatio: 0.75,
        hardLimitRatio: 0.85,
        targetUtilizationRatio: 0.65,
      },
    );

    expect(observedTrigger).toBe("hard-limit");
    expect(projection.compaction?.trigger).toBe("hard-limit");
    expect(projection.overBudget).toBe(false);
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

  test("manually compacts eligible history below automatic thresholds", async () => {
    const manager = new ContextManager<string>();
    const result = await manager.compactManually(
      [
        record("old-user", 4, false, "turn-1"),
        record("old-assistant", 4, false, "turn-1"),
        {
          ...record("recent-user", 3, true, "turn-2"),
          category: "retained-turn",
        },
        {
          ...record("recent-assistant", 3, true, "turn-2"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 100, reservedOutputTokens: 0 },
      {
        compact({ records, trigger }) {
          expect(trigger).toBe("manual");
          expect(records.map((item) => item.id)).toEqual(["old-user", "old-assistant"]);
          return {
            id: "manual-summary",
            kind: "summary",
            payload: "manual summary",
            estimatedTokens: 2,
          };
        },
      },
      { maxSummaryTokens: 8, ...RELAXED_MANUAL_ELIGIBILITY },
    );

    expect(result.status).toBe("compacted");
    if (result.status !== "compacted") throw new Error("expected compaction");
    expect(result.projection.compaction?.trigger).toBe("manual");
    expect(result.projection.records.map((item) => item.id)).toEqual([
      "manual-summary",
      "recent-user",
      "recent-assistant",
    ]);
  });

  test("manual compaction chains the previous checkpoint into one replacement checkpoint", async () => {
    const manager = new ContextManager<string>();
    const result = await manager.compactManually(
      [
        { id: "checkpoint-old", kind: "summary", payload: "old", estimatedTokens: 2, required: true },
        record("newly-old", 5, false, "turn-2"),
        {
          ...record("tail", 4, true, "turn-3"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 50, reservedOutputTokens: 0 },
      {
        compact({ previousCheckpointRecords, newlyCompactedRecords, records, trigger }) {
          expect(trigger).toBe("manual");
          expect(previousCheckpointRecords.map((item) => item.id)).toEqual(["checkpoint-old"]);
          expect(newlyCompactedRecords.map((item) => item.id)).toEqual(["newly-old"]);
          expect(records.map((item) => item.id)).toEqual(["checkpoint-old", "newly-old"]);
          return {
            id: "checkpoint-new",
            kind: "summary",
            payload: "new",
            estimatedTokens: 3,
          };
        },
      },
      { maxSummaryTokens: 8, ...RELAXED_MANUAL_ELIGIBILITY },
    );

    expect(result.status).toBe("compacted");
    if (result.status !== "compacted") throw new Error("expected compaction");
    expect(result.projection.records.map((item) => item.id)).toEqual(["checkpoint-new", "tail"]);
  });

  test("manual compaction returns a typed no-op when only retained history exists", async () => {
    const manager = new ContextManager<string>();
    let calls = 0;
    const result = await manager.compactManually(
      [
        {
          ...record("current-user", 4, true, "turn-1"),
          category: "retained-turn",
        },
        {
          ...record("current-assistant", 4, true, "turn-1"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 100, reservedOutputTokens: 0 },
      {
        compact() {
          calls += 1;
          return null;
        },
      },
    );

    expect(result).toMatchObject({ status: "noop", reason: "nothing-compactable" });
    expect(calls).toBe(0);
  });

  test("rejects manual compaction when eligible history is too small", async () => {
    const manager = new ContextManager<string>();
    let calls = 0;
    const result = await manager.compactManually(
      [
        record("old-user", 1_200, false, "turn-1"),
        record("old-assistant", 1_200, false, "turn-1"),
        {
          ...record("tail", 500, true, "turn-2"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 100_000, reservedOutputTokens: 0 },
      {
        compact() {
          calls += 1;
          return null;
        },
      },
    );

    expect(result).toMatchObject({
      status: "noop",
      reason: "insufficient-history",
      eligibility: {
        eligible: false,
        compactableTokens: 2_400,
        minCompactableTokens: 3_000,
      },
    });
    expect(calls).toBe(0);
  });

  test("treats retained records from the previous checkpoint as pre-checkpoint turns", async () => {
    const manager = new ContextManager<string>();
    let calls = 0;
    const result = await manager.compactManually(
      [
        { id: "checkpoint", kind: "summary", payload: "old", estimatedTokens: 1_000, required: true },
        record("previous-tail", 4_000, false, "turn-3"),
        {
          ...record("new-turn", 1_000, true, "turn-4"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 100_000, reservedOutputTokens: 0 },
      {
        compact() {
          calls += 1;
          return null;
        },
      },
      {},
      { previousRetainedRecordIds: ["previous-tail"] },
    );

    expect(result).toMatchObject({
      status: "noop",
      reason: "recent-compaction",
      eligibility: {
        eligible: false,
        compactableTokens: 4_000,
        newTurnsSinceCheckpoint: 1,
        minNewTurnsSinceCheckpoint: 2,
      },
    });
    expect(calls).toBe(0);
  });

  test("rejects manual compaction when the conservative estimated gain is too small", async () => {
    const manager = new ContextManager<string>();
    let calls = 0;
    const result = await manager.compactManually(
      [
        record("old-user", 2_000, false, "turn-1"),
        record("old-assistant", 2_000, false, "turn-1"),
        {
          ...record("tail", 500, true, "turn-2"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 100_000, reservedOutputTokens: 0 },
      {
        compact() {
          calls += 1;
          return null;
        },
      },
      { maxSummaryTokens: 3_500 },
    );

    expect(result).toMatchObject({
      status: "noop",
      reason: "insufficient-gain",
      eligibility: {
        eligible: false,
        compactableTokens: 4_000,
        estimatedGainTokens: 500,
        minEstimatedGainTokens: 2_000,
      },
    });
    expect(calls).toBe(0);
  });

  test("allows repeat manual compaction after enough new turns and estimated savings", async () => {
    const manager = new ContextManager<string>();
    const result = await manager.compactManually(
      [
        { id: "checkpoint", kind: "summary", payload: "old", estimatedTokens: 1_000, required: true },
        record("previous-tail", 2_000, false, "turn-3"),
        record("new-turn-1", 1_500, false, "turn-4"),
        record("new-turn-2", 1_500, false, "turn-5"),
        {
          ...record("current-tail", 500, true, "turn-6"),
          category: "retained-turn",
        },
      ],
      { contextWindowTokens: 100_000, reservedOutputTokens: 0 },
      {
        compact({ trigger }) {
          expect(trigger).toBe("manual");
          return {
            id: "checkpoint-next",
            kind: "summary",
            payload: "next",
            estimatedTokens: 1_500,
          };
        },
      },
      { maxSummaryTokens: 2_048 },
      { previousRetainedRecordIds: ["previous-tail"] },
    );

    expect(result.status).toBe("compacted");
    if (result.status !== "compacted") throw new Error("expected compaction");
    expect(result.eligibility).toMatchObject({
      eligible: true,
      compactableTokens: 5_000,
      newTurnsSinceCheckpoint: 3,
    });
  });
});
