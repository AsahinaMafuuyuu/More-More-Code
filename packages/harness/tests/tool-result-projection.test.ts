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

  test("projects an oversized result identically before and after its freshness changes", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const fresh = manager.project([candidate("stable", 80, "fresh", true)], 1_000, projector);
    const cold = manager.project([candidate("stable", 80, "cold")], 1_000, projector);

    expect(fresh.fullResultThresholdTokens).toBe(60);
    expect(fresh.results[0]?.mode).toBe("truncated");
    expect(fresh.results[0]?.reason).toBe("oversized-result");
    expect(cold.results[0]?.mode).toBe(fresh.results[0]?.mode);
    expect(cold.results[0]?.projectedPayload).toBe(fresh.results[0]?.projectedPayload);
    expect(cold.results[0]?.projectedTokens).toBe(fresh.results[0]?.projectedTokens);
  });

  test("bounds an oversized fresh result immediately and reports aggregate pressure after projection", () => {
    const manager = new ToolResultWorkingSetManager<string>();
    const projection = manager.project(
      [candidate("old", 50, "cold"), candidate("fresh", 230, "fresh", true)],
      800,
      projector,
    );

    expect(projection.budgetTokens).toBe(200);
    expect(projection.results[1]?.mode).toBe("truncated");
    expect(projection.results[1]?.reason).toBe("oversized-result");
    expect(projection.results[1]?.projectedTokens).toBeLessThanOrEqual(60);
    expect(projection.overBudget).toBe(false);
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
    expect(projection.projectedTokens).toBeGreaterThan(projection.budgetTokens);
    expect(projection.overBudget).toBe(true);
  });
});
