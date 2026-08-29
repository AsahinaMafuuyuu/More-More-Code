import { describe, expect, test } from "bun:test";
import type { SessionUsageSummary } from "@more-more-code/harness";
import {
  formatActiveRuntimeLabel,
  projectConversationView,
  projectActiveRuntimeView,
  projectComposerRuntimeView,
  projectInteractionQueueView,
  projectRecoveryUiView,
  projectSessionStatusView,
} from "../src/ui/session/projections/session-ui-projections";

function emptyUsage(): SessionUsageSummary {
  return {
    completedStepCount: 0,
    tokens: {},
    cache: { coverage: "none" },
    cost: { coverage: "none" },
    integrity: "valid",
  };
}

describe("Session UI projections", () => {
  test("projects exact terminal Run elapsed time for the once-per-round footer", () => {
    const conversation = projectConversationView({
      messages: [],
      toolUses: {},
      run: {
        id: "run-1",
        sessionId: "session-1",
        status: "completed",
        startedAt: 1_000,
        endedAt: 6_250,
        turns: [{
          id: "turn-1",
          runId: "run-1",
          index: 0,
          cause: "initial",
          inputMessageId: "user-1",
          status: "completed",
          startedAt: 1_000,
          endedAt: 6_250,
          steps: [],
        }],
      },
    });

    expect(conversation.currentRun).toEqual({
      inputMessageId: "user-1",
      status: "completed",
      durationMs: 5_250,
    });
  });

  test("projects narrow composer runtime facts instead of raw AgentRun", () => {
    expect(projectComposerRuntimeView({
      busy: true,
      runStatus: "running",
      chatStatus: "streaming",
    })).toEqual({
      disabled: false,
      runActive: true,
      canInterrupt: true,
      followUpAvailable: true,
    });

    expect(projectComposerRuntimeView({
      busy: true,
      runStatus: null,
      chatStatus: "ready",
    })).toMatchObject({
      disabled: true,
      runActive: false,
      canInterrupt: false,
    });
  });

  test("projects pending interaction queue separately from durable conversation state", () => {
    expect(projectInteractionQueueView({
      pending: [{
        id: "follow-up-1",
        kind: "follow-up",
        text: "check the tests",
        createdAt: 10,
      }],
      outcomes: [{
        interaction: {
          id: "steer-1",
          kind: "steering",
          text: "change direction",
          createdAt: 9,
        },
        reason: "run-interrupted",
      }],
    })).toEqual({
      pending: [{
        id: "follow-up-1",
        kind: "follow-up",
        text: "check the tests",
        createdAt: 10,
      }],
      outcomes: [{
        id: "steer-1",
        kind: "steering",
        text: "change direction",
        reason: "run-interrupted",
      }],
    });
  });

  test("projects active runtime phases and complete Tool Batch counts from the latest assistant message", () => {
    const run = {
      id: "run-active",
      sessionId: "session-1",
      status: "running" as const,
      startedAt: 1_000,
      turns: [],
    };
    const toolMessages = [{
      id: "assistant-tools",
      role: "assistant" as const,
      parts: [
        { type: "tool-readFile" as const, toolCallId: "call-1", state: "input-available" as const, input: {} },
        { type: "tool-grep" as const, toolCallId: "call-2", state: "input-available" as const, input: {} },
        { type: "tool-bash" as const, toolCallId: "call-3", state: "input-available" as const, input: {} },
      ],
    }];

    expect(projectActiveRuntimeView({
      busy: true,
      run,
      chatStatus: "ready",
      messages: toolMessages,
      toolUses: {
        "call-1": { toolCallId: "call-1", toolName: "readFile", status: "completed" },
        "call-2": { toolCallId: "call-2", toolName: "grep", status: "running" },
        "call-3": { toolCallId: "call-3", toolName: "bash", status: "requested" },
      },
    })).toEqual({
      phase: "tools",
      runId: "run-active",
      startedAt: 1_000,
      tools: { total: 3, active: 2, completed: 1, failed: 0 },
      compaction: null,
    });

    expect(projectActiveRuntimeView({
      busy: true,
      run,
      chatStatus: "streaming",
      messages: [{
        id: "assistant-text",
        role: "assistant",
        parts: [{ type: "text", text: "answer", state: "streaming" }],
      }],
      toolUses: {},
    }).phase).toBe("responding");

    expect(projectActiveRuntimeView({
      busy: true,
      run,
      chatStatus: "streaming",
      messages: [{
        id: "assistant-reasoning",
        role: "assistant",
        parts: [{ type: "reasoning", text: "working", state: "streaming" }],
      }],
      toolUses: {},
    }).phase).toBe("thinking");

    expect(projectActiveRuntimeView({
      busy: true,
      run: { ...run, status: "completed" as const, endedAt: 2_000 },
      chatStatus: "ready",
      messages: [],
      toolUses: {},
    }).phase).toBe("settling");
  });

  test("projects Compaction Runtime Activity into the single active runtime row", () => {
    const run = {
      id: "run-compaction",
      sessionId: "session-1",
      status: "running" as const,
      startedAt: 1_000,
      turns: [],
    };
    const reducing = projectActiveRuntimeView({
      busy: true,
      run,
      chatStatus: "submitted",
      messages: [],
      toolUses: {},
      contextCompactionActivity: {
        operationId: "operation-1",
        compactionPlanId: "plan-1",
        phase: "compaction-reducing",
        startedAt: 1_200,
        inputTokensBefore: 101_900,
      },
    });
    expect(reducing).toEqual({
      phase: "compaction",
      runId: "run-compaction",
      startedAt: 1_200,
      tools: null,
      compaction: {
        planId: "plan-1",
        phase: "compaction-reducing",
        inputTokensBefore: 101_900,
      },
    });
    expect(formatActiveRuntimeLabel(reducing)).toBe("Summarizing older context…");

    const rebased = projectActiveRuntimeView({
      busy: true,
      run,
      chatStatus: "submitted",
      messages: [],
      toolUses: {},
      contextCompactionActivity: {
        operationId: "operation-1",
        compactionPlanId: "plan-1",
        phase: "compaction-rebased",
        startedAt: 1_200,
        inputTokensBefore: 101_900,
        inputTokensAfter: 72_400,
      },
    });
    expect(formatActiveRuntimeLabel(rebased)).toBe("Context compacted · 101.9k → 72.4k");

    const providerStreaming = projectActiveRuntimeView({
      busy: true,
      run,
      chatStatus: "streaming",
      messages: [{
        id: "assistant-streaming",
        role: "assistant",
        parts: [{ type: "text", text: "continuing", state: "streaming" }],
      }],
      toolUses: {},
      contextCompactionActivity: {
        operationId: "operation-1",
        compactionPlanId: "plan-1",
        phase: "compaction-rebased",
        startedAt: 1_200,
        inputTokensBefore: 101_900,
        inputTokensAfter: 72_400,
      },
    });
    expect(providerStreaming.phase).toBe("responding");
    expect(providerStreaming.compaction).toBeNull();
  });

  test("projects mode/model and observability into one status view", () => {
    expect(projectSessionStatusView({
      mode: "PLAN",
      model: { providerId: "openai", modelId: "gpt-test" },
      observability: {
        context: null,
        usage: emptyUsage(),
        usagePersistenceIncomplete: false,
      },
    })).toEqual({
      mode: "PLAN",
      modelLabel: "openai/gpt-test",
      contextLabel: "—",
      contextUtilizationRatio: null,
      costLabel: "$—",
      cacheLabel: "Cache —",
    });
  });

  test("recovery view is keyed and disappears when there is no user-facing notice", () => {
    expect(projectRecoveryUiView(null)).toBeNull();
    expect(projectRecoveryUiView({
      sessionId: "session-1",
      recoveredEventOffset: 8,
      replayedEventCount: 0,
      incompleteRunIds: [],
      pendingExternalOperations: [],
    })).toBeNull();
  });
});
