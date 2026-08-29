import { describe, expect, test } from "bun:test";
import {
  assertRehydratedCheckpointEquivalent,
  createCompactionCheckpointV2,
  createEmptyCompactionCheckpointState,
  renderCompactionCheckpointState,
  validateCompactionCheckpointV2,
  type CompactionPlan,
} from "../src";

function plan(): CompactionPlan {
  return {
    version: 1,
    planId: "plan-1",
    policyVersion: "policy-v2",
    trigger: "hard-limit",
    baseCheckpointId: null,
    sourceRecordIds: ["r1", "r2"],
    sourceDigest: "source-digest",
    provenanceRecordIds: ["r1", "r2"],
    retainedRecordIds: ["r3"],
    compactedThroughRecordId: "r2",
    retainedFromRecordId: "r3",
    splitGroup: false,
    inputTokensBefore: 100,
    targetInputTokens: 70,
    maxCheckpointTokens: 100,
    requiredAnchors: [
      {
        id: "goal-anchor",
        priority: "P0",
        kind: "goal",
        text: "Keep the active goal",
        sourceRecordIds: ["r2"],
      },
      {
        id: "artifact-anchor",
        priority: "P1",
        kind: "artifact",
        text: "packages/harness/src/context.ts",
        sourceRecordIds: ["r1"],
      },
    ],
  };
}

describe("CompactionCheckpointV2", () => {
  test("derives deterministic rendering and validates source/provenance/anchors", () => {
    const state = createEmptyCompactionCheckpointState();
    state.currentGoal.push({
      id: "goal-1",
      text: "Keep the active goal",
      sourceRecordIds: ["r2"],
    });
    state.artifacts.push({
      id: "artifact-1",
      text: "packages/harness/src/context.ts",
      sourceRecordIds: ["r1"],
    });
    const checkpoint = createCompactionCheckpointV2({
      plan: plan(),
      state,
      quality: "verified",
      coveredAnchorIds: ["goal-anchor", "artifact-anchor"],
    });

    expect(checkpoint.renderedSummary).toBe(renderCompactionCheckpointState(state));
    expect(checkpoint.validation.requiredAnchorIds).toEqual(["goal-anchor"]);
    expect(checkpoint.checkpointId).toHaveLength(64);
    expect(validateCompactionCheckpointV2({
      checkpoint,
      plan: plan(),
      countRenderedTokens: () => 50,
    })).toEqual({ valid: true });
  });

  test("rejects a candidate that misses a P0 required anchor", () => {
    const checkpoint = createCompactionCheckpointV2({
      plan: plan(),
      state: createEmptyCompactionCheckpointState(),
      quality: "verified",
      coveredAnchorIds: [],
    });
    const result = validateCompactionCheckpointV2({ checkpoint, plan: plan() });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid checkpoint");
    expect(result.errors).toContain("missing required anchor: goal-anchor");
  });

  test("rejects hallucinated provenance", () => {
    const state = createEmptyCompactionCheckpointState();
    state.currentState.push({ id: "bad", text: "invented", sourceRecordIds: ["unknown"] });
    const checkpoint = createCompactionCheckpointV2({
      plan: plan(),
      state,
      quality: "verified",
      coveredAnchorIds: ["goal-anchor"],
    });
    const result = validateCompactionCheckpointV2({ checkpoint, plan: plan() });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid checkpoint");
    expect(result.errors).toContain("checkpoint fact bad references unknown source: unknown");
  });

  test("fails rehydration equivalence when persisted checkpoint differs", () => {
    const candidate = createCompactionCheckpointV2({
      plan: plan(),
      state: createEmptyCompactionCheckpointState(),
      quality: "deterministic-degraded",
      coveredAnchorIds: ["goal-anchor"],
    });
    const rehydrated = structuredClone(candidate);
    rehydrated.renderedSummary += "\nmutated";
    expect(() => assertRehydratedCheckpointEquivalent(candidate, rehydrated)).toThrow(
      "Persisted compaction checkpoint rendering mismatch",
    );
  });
});
