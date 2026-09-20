import { describe, expect, test } from "bun:test";
import {
  projectInspectorContextView,
  projectInspectorTreeView,
  projectInspectorUsageView,
} from "../src/ui/session/inspector/inspector-projections";

describe("Session Inspector projections", () => {
  test("projects Current Context without re-estimating authority data", () => {
    expect(projectInspectorContextView({
      estimatedInputTokens: 42_800,
      contextWindowTokens: 128_000,
      inputBudgetTokens: 112_000,
      reservedOutputTokens: 12_000,
      safetyMarginTokens: 4_000,
      utilizationRatio: 0.334375,
      tokenCounterId: "heuristic-v1",
      tokenCountQuality: "estimated",
    })).toEqual({
      available: true,
      currentInput: "42.8k",
      contextWindow: "128k",
      utilization: "33.4%",
      utilizationRatio: 0.334375,
      inputBudget: "112k",
      reservedOutput: "12k",
      safetyMargin: "4k",
      counterId: "heuristic-v1",
      quality: "estimated",
    });

    expect(projectInspectorContextView(null)).toEqual({
      available: false,
      currentInput: "—",
      contextWindow: "—",
      utilization: "—",
      utilizationRatio: null,
      inputBudget: "—",
      reservedOutput: "—",
      safetyMargin: "—",
      counterId: "—",
      quality: "unavailable",
    });
  });

  test("preserves unknown versus explicit zero and partial Usage coverage", () => {
    expect(projectInspectorUsageView({
      usage: {
        completedStepCount: 3,
        tokens: {
          inputTotal: 10_000,
          inputNoCache: 0,
          cacheRead: 7_500,
          outputTotal: 800,
          reasoning: 200,
        },
        cache: { hitRate: 0.75, coverage: "complete" },
        cost: { totalUsd: 0.012345, coverage: "complete" },
        integrity: "valid",
      },
      usagePersistenceIncomplete: false,
    })).toMatchObject({
      inputTotal: "10k",
      inputNoCache: "0",
      cacheRead: "7.5k",
      cacheWrite: "—",
      outputTotal: "800",
      outputText: "—",
      outputReasoning: "200",
      cacheHit: "75.0%",
      cacheCoverage: "complete",
      apiCost: "$0.0123",
      costCoverage: "complete",
      completedSteps: "3",
      integrity: "valid",
      persistenceIncomplete: false,
    });

    expect(projectInspectorUsageView({
      usage: {
        completedStepCount: 2,
        tokens: { inputTotal: 2_000, cacheRead: 1_000 },
        cache: { hitRate: 0.5, coverage: "complete" },
        cost: { totalUsd: 0.004, coverage: "complete" },
        integrity: "valid",
      },
      usagePersistenceIncomplete: true,
    })).toMatchObject({
      cacheHit: "50.0%",
      cacheCoverage: "partial",
      apiCost: "$0.0040+",
      costCoverage: "partial",
      persistenceIncomplete: true,
    });

    expect(projectInspectorUsageView({
      usage: {
        completedStepCount: 0,
        tokens: {},
        cache: { coverage: "none" },
        cost: { coverage: "none" },
        integrity: "valid",
      },
      usagePersistenceIncomplete: false,
    })).toMatchObject({
      inputTotal: "—",
      cacheHit: "—",
      apiCost: "—",
      completedSteps: "0",
    });
  });

  test("keeps semantic Tree navigation identity while bounding previews", () => {
    const longPreview = "x".repeat(300);
    const view = projectInspectorTreeView({
      nodes: [
        {
          id: "user-1",
          parentId: null,
          type: "user_message",
          depth: 0,
          createdAt: 1,
          preview: "inspect this",
          navigationTargetEntryId: "entry-user-1",
          selectable: true,
          active: false,
        },
        {
          id: "tool-use:call-entry",
          parentId: "user-1",
          type: "tool_use",
          depth: 1,
          createdAt: 2,
          preview: longPreview,
          navigationTargetEntryId: "result-entry",
          selectable: true,
          active: true,
          toolCallId: "call-1",
          status: "completed",
        },
        {
          id: "tool-use:pending",
          parentId: "user-1",
          type: "tool_use",
          depth: 1,
          createdAt: 3,
          preview: "[grep]",
          navigationTargetEntryId: "call-entry-pending",
          selectable: false,
          active: false,
          toolCallId: "call-2",
          status: "pending",
        },
      ],
    });

    expect(view.entries[0]).toMatchObject({
      id: "user-1",
      label: "User",
      navigationTargetEntryId: "entry-user-1",
      activePath: true,
    });
    expect(view.entries[1]).toMatchObject({
      label: "ToolUse",
      depth: 1,
      navigationTargetEntryId: "result-entry",
      selectable: true,
      active: true,
      activePath: true,
      status: "completed",
    });
    expect(view.entries[1]!.preview.length).toBeLessThanOrEqual(123);
    expect(view.entries[2]).toMatchObject({
      label: "ToolUse",
      selectable: false,
      activePath: false,
      status: "pending",
    });
  });
});
