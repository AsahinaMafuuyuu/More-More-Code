import { describe, expect, test } from "bun:test";
import {
  ToolResultWorkingSetManager,
  type ToolResultProjectionCandidate,
  type ToolResultProjector,
} from "../src";

function candidate(
  id: string,
  estimatedTokens: number,
  freshness: "fresh" | "warm" | "cold",
  required = false,
): ToolResultProjectionCandidate<string> {
  return {
    id,
    toolCallId: `call-${id}`,
    toolName: "bash",
    payload: `payload-${id}`,
    estimatedTokens,
    freshness,
    required,
    sourceEntryId: `entry-${id}`,
  };
}

const projector: ToolResultProjector<string> = {
  project({ candidate, targetTokens, reason }) {
    return {
      ...candidate,
      mode: reason === "reference-eligible" ? "reference" : "truncated",
      projectedPayload: `projected:${candidate.id}:${candidate.sourceEntryId}`,
      projectedTokens: Math.max(1, Math.min(targetTokens, 6)),
      reason,
    };
  },
};

describe("ToolResultWorkingSetManager", () => {
  test("keeps small results full when the working set is within budget", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const projection = manager.project(
      [candidate("old", 10, "cold"), candidate("new", 12, "fresh", true)],
      1_000,
      projector,
    );

    expect(projection.budgetTokens).toBe(250);
    expect(projection.pruned).toBe(false);
    expect(projection.results.map((result) => result.mode)).toEqual(["full", "full"]);
    expect(projection.projectedTokens).toBe(22);
  });

  test("preserves the fresh continuation result and prunes older results first", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const original = [
      candidate("cold", 110, "cold"),
      candidate("warm", 90, "warm"),
      candidate("fresh", 80, "fresh", true),
    ];
    const snapshot = structuredClone(original);
    const projection = manager.project(original, 800, projector);

    expect(projection.budgetTokens).toBe(200);
    expect(projection.results[2]?.mode).toBe("full");
    expect(projection.results[0]?.mode).not.toBe("full");
    expect(projection.results[0]?.sourceEntryId).toBe("entry-cold");
    expect(projection.projectedTokens).toBeLessThan(projection.originalTokens);
    expect(original).toEqual(snapshot);
  });

  test("surfaces overBudget when non-prunable fresh results alone exceed the tool budget", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const projection = manager.project(
      [candidate("old", 50, "cold"), candidate("fresh", 230, "fresh", true)],
      800,
      projector,
    );

    expect(projection.budgetTokens).toBe(200);
    expect(projection.overBudget).toBe(true);
    expect(projection.results[1]?.mode).toBe("full");
    expect(projection.results[1]?.projectedTokens).toBe(230);
  });

  test("proactively prunes an individually oversized warm result even without aggregate pressure", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const projection = manager.project(
      [candidate("warm", 80, "warm")],
      1_000,
      projector,
    );

    expect(projection.originalTokens).toBeLessThan(projection.budgetTokens);
    expect(projection.fullResultThresholdTokens).toBe(60);
    expect(projection.results[0]?.mode).toBe("truncated");
    expect(projection.results[0]?.reason).toBe("oversized-result");
  });

  test("surfaces overBudget when even minimum eligible projections cannot fit the working-set cap", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const projection = manager.project(
      Array.from({ length: 30 }, (_, index) => candidate(`cold-${index}`, 100, "cold")),
      100,
      projector,
    );

    expect(projection.budgetTokens).toBe(25);
    expect(projection.projectedTokens).toBe(30);
    expect(projection.overBudget).toBe(true);
  });
});
