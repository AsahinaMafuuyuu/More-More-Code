import { describe, expect, test } from "bun:test";
import { createSessionTree, type SessionTreeState } from "@more-more-code/harness";
import type { Message } from "../src/lib/chat-types";
import {
  SessionController,
  type SessionControllerServices,
} from "../src/app/session/session-controller";

function createServices(state: SessionTreeState<Message>) {
  const commits: SessionTreeState<Message>[] = [];
  let interruptCount = 0;
  let disposedHandle = false;
  const listeners = new Set<(event: never) => void>();

  const services = {
    runtimeSession: {
      getUsageSummary: () => ({
        completedStepCount: 0,
        tokens: {},
        cache: { coverage: "none" },
        cost: { coverage: "none" },
        integrity: "valid",
      }),
      ready: async () => null,
      record: async () => undefined,
    },
    localSessionAuthority: {
      commit: async ({ state: nextState }: { state: SessionTreeState<Message> }) => {
        commits.push(nextState);
        return {
          session: {
            id: "session-1",
            title: "test",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
            archivedAt: null,
            revision: commits.length,
          },
          state: nextState,
        };
      },
    },
    runLifecycle: {
      assertCanStartWork: () => undefined,
      register: () => () => {
        disposedHandle = true;
      },
    },
    approvalBroker: {
      getPending: () => [],
      subscribe: () => () => undefined,
      resolve: () => true,
      cancel: () => true,
      cancelAll: () => undefined,
    },
    agentLoop: {
      isBusy: false,
      isRunning: false,
      interrupt: () => {
        interruptCount += 1;
        return true;
      },
      waitForIdle: async () => undefined,
      subscribe: (listener: (event: never) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    getAgentEnvironment: () => ({
      loadedAt: 1,
      config: {
        resolved: {
          session: { branchSummaryOnJump: "ask" },
        },
      },
    }),
    subscribeAgentEnvironment: () => () => undefined,
  } as unknown as SessionControllerServices;

  return {
    services,
    commits,
    getInterruptCount: () => interruptCount,
    getDisposedHandle: () => disposedHandle,
  };
}

describe("SessionController", () => {
  test("coordinates durable prompt selection outside React", async () => {
    const state = createSessionTree<Message>([]);
    const fixture = createServices(state);
    const controller = new SessionController({
      sessionId: "session-1",
      persistedSessionState: state,
      services: fixture.services,
    });

    await controller.recordPromptSelection({
      mode: "PLAN",
      model: { providerId: "openai", modelId: "gpt-test" },
    });

    expect(fixture.commits).toHaveLength(1);
    expect(controller.getSnapshot().sessionTree.entries.map((entry) => entry.type)).toEqual([
      "session_start",
      "model_change",
      "mode_change",
    ]);
  });

  test("interrupt and dispose reuse the injected runtime lifecycle", async () => {
    const state = createSessionTree<Message>([]);
    const fixture = createServices(state);
    const controller = new SessionController({
      sessionId: "session-1",
      persistedSessionState: state,
      services: fixture.services,
    });

    await controller.attach();
    controller.interrupt();
    await controller.dispose();

    expect(fixture.getInterruptCount()).toBe(2);
    expect(fixture.getDisposedHandle()).toBe(true);
  });
});
