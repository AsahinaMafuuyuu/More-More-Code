import { describe, expect, test } from "bun:test";
import {
  AgentLoop,
  createSessionTree,
  type AgentInteraction,
  type SessionTreeState,
} from "@more-more-code/harness";
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
  const queueListeners = new Set<() => void>();
  const pendingInteractions: AgentInteraction[] = [];

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
      pendingInteractions,
      interrupt: () => {
        interruptCount += 1;
        return true;
      },
      waitForIdle: async () => undefined,
      subscribe: (listener: (event: never) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      subscribePendingInteractions: (listener: () => void) => {
        queueListeners.add(listener);
        return () => queueListeners.delete(listener);
      },
      enqueueSteering: () => null,
      enqueueFollowUp: () => null,
      cancelPendingInteraction: () => false,
      promoteFollowUpToSteering: () => false,
    },
    getAgentEnvironment: () => ({
      loadedAt: 1,
      config: {
        resolved: {
          session: { branchSummaryOnJump: "ask" },
          tools: { execution: { mode: "serial", maxConcurrency: 4 } },
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

  test("queues follow-up ephemerally, commits only when consumed, and never duplicates it", async () => {
    const state = createSessionTree<Message>([]);
    const commits: SessionTreeState<Message>[] = [];
    const loop = new AgentLoop();
    let controller!: SessionController;
    let firstModelEntered!: () => void;
    let releaseFirstModel!: () => void;
    const firstModelStarted = new Promise<void>((resolve) => { firstModelEntered = resolve; });
    const firstModelBarrier = new Promise<void>((resolve) => { releaseFirstModel = resolve; });
    let modelInvocation = 0;

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
              id: "session-queue",
              title: "queue",
              metadata: {},
              createdAt: 1,
              updatedAt: commits.length,
              archivedAt: null,
              revision: commits.length,
            },
            state: nextState,
          };
        },
      },
      runLifecycle: {
        assertCanStartWork: () => undefined,
        register: () => () => undefined,
      },
      approvalBroker: {
        getPending: () => [],
        subscribe: () => () => undefined,
        resolve: () => true,
        cancel: () => true,
        cancelAll: () => undefined,
      },
      agentLoop: loop,
      getAgentEnvironment: () => ({
        loadedAt: 1,
        config: {
          paths: { workspaceRoot: process.cwd() },
          resolved: {
            session: { branchSummaryOnJump: "ask" },
            tools: { execution: { mode: "serial", maxConcurrency: 4 } },
          },
        },
        tools: {
          getToolDefinition: () => null,
        },
      }),
      subscribeAgentEnvironment: () => () => undefined,
    } as unknown as SessionControllerServices;

    controller = new SessionController({
      sessionId: "session-queue",
      persistedSessionState: state,
      services,
    });
    controller.bindChatBridge({
      setMessages() {},
      async sendMessage() {
        modelInvocation += 1;
        if (modelInvocation === 1) {
          firstModelEntered();
          await firstModelBarrier;
        }
        controller.completeModelStep({
          message: {
            id: `assistant-${modelInvocation}`,
            role: "assistant",
            parts: [{ type: "text", text: `answer-${modelInvocation}` }],
          },
          isAbort: false,
          isDisconnect: false,
          isError: false,
        });
      },
      addToolOutput() {},
      stop() {},
    });

    const initialRun = controller.submit({
      userText: "initial",
      mode: "BUILD",
      model: { providerId: "openai", modelId: "gpt-test" },
    });
    await firstModelStarted;
    expect(commits).toHaveLength(1);

    const queued = await controller.followUp({
      userText: "follow-up later",
      mode: "BUILD",
      model: { providerId: "openai", modelId: "gpt-test" },
    });
    expect(queued).toEqual(expect.objectContaining({
      kind: "follow-up",
      text: "follow-up later",
    }));
    expect(commits).toHaveLength(1);
    expect(controller.getSnapshot().sessionTree.entries.filter(
      (entry) => entry.type === "user_message",
    )).toHaveLength(1);

    releaseFirstModel();
    const run = await initialRun;
    expect(run.status).toBe("completed");
    expect(modelInvocation).toBe(2);
    const userEntries = controller.getSnapshot().sessionTree.entries.filter(
      (entry) => entry.type === "user_message",
    );
    expect(userEntries).toHaveLength(2);
    const durableMessages = userEntries.map((entry) => entry.type === "user_message"
      ? entry.message.parts.find((part) => part.type === "text")?.text
      : null);
    expect(durableMessages).toEqual(["initial", "follow-up later"]);
  });
});
