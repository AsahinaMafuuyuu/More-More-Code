import { describe, expect, test } from "bun:test";
import type { SessionUsageSummary } from "@more-more-code/harness";
import {
  projectConversationView,
  projectComposerRuntimeView,
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
      submitMode: "steer",
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
      submitMode: "submit",
    });
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
