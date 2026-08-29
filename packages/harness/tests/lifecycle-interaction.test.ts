import { describe, expect, test } from "bun:test";
import {
  AgentLoop,
  type AgentLifecycleEvent,
  type AgentTurnCause,
} from "../src";

function createLoop(options: { maxSteps?: number; maxTurns?: number } = {}) {
  let id = 0;
  let now = 4000;

  return new AgentLoop({
    ...options,
    createId: () => `lifecycle-${++id}`,
    now: () => ++now,
  });
}

describe("Run / Turn / Step lifecycle", () => {
  test("emits awaited pi-style lifecycle events while keeping progress ephemeral", async () => {
    const loop = createLoop();
    const lifecycle: string[] = [];
    const progressMessages: string[] = [];
    let modelInvocation = 0;

    loop.subscribe(async (event) => {
      lifecycle.push(event.type);
      if (event.type === "step_update" && event.update.message) {
        progressMessages.push(event.update.message);
      }
    });

    const run = await loop.run({
      sessionId: "session-lifecycle",
      adapter: {
        async runModelStep(context) {
          modelInvocation += 1;
          await context.reportProgress({ message: `model-${modelInvocation}` });

          if (modelInvocation === 1) {
            return {
              toolCalls: [
                {
                  toolCallId: "call-lifecycle",
                  toolName: "readFile",
                  input: { path: "README.md" },
                },
              ],
            };
          }

          return { toolCalls: [] };
        },
        async runToolStep(_toolCall, context) {
          await context.reportProgress({ message: "tool-progress" });
        },
      },
    });

    expect(run.turns.map((turn) => turn.cause)).toEqual([
      "initial",
      "tool-continuation",
    ]);
    expect(lifecycle).toEqual([
      "run_start",
      "turn_start",
      "step_start",
      "step_update",
      "step_end",
      "step_start",
      "step_update",
      "step_end",
      "turn_end",
      "turn_start",
      "step_start",
      "step_update",
      "step_end",
      "turn_end",
      "run_end",
    ]);
    expect(progressMessages).toEqual(["model-1", "tool-progress", "model-2"]);
    expect(loop.getExecutionEvents(run.id).some((event) => event.type === "step.updated" as never)).toBe(false);
  });

  test("run_end listeners are part of settlement and waitForIdle waits for them", async () => {
    const loop = createLoop();
    let releaseRunEnd!: () => void;
    let enterRunEnd!: () => void;
    const runEndEntered = new Promise<void>((resolve) => {
      enterRunEnd = resolve;
    });
    const runEndBarrier = new Promise<void>((resolve) => {
      releaseRunEnd = resolve;
    });

    loop.subscribe(async (event) => {
      if (event.type !== "run_end") return;
      enterRunEnd();
      await runEndBarrier;
    });

    const runPromise = loop.run({
      sessionId: "session-settlement",
      adapter: {
        async runModelStep() {
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    await runEndEntered;
    expect(loop.currentRun?.status).toBe("completed");
    expect(loop.isRunning).toBe(false);
    expect(loop.isBusy).toBe(true);

    let idleSettled = false;
    const idlePromise = loop.waitForIdle().then(() => {
      idleSettled = true;
    });
    await Promise.resolve();
    expect(idleSettled).toBe(false);

    releaseRunEnd();
    const run = await runPromise;
    await idlePromise;

    expect(run.status).toBe("completed");
    expect(loop.isBusy).toBe(false);
    expect(idleSettled).toBe(true);
  });

  test("a lifecycle listener can interrupt at step_start before provider execution begins", async () => {
    const loop = createLoop();
    let modelCalls = 0;

    loop.subscribe((event) => {
      if (event.type === "step_start" && event.step.kind === "model") {
        loop.interrupt();
      }
    });

    const run = await loop.run({
      sessionId: "session-listener-interrupt",
      adapter: {
        async runModelStep() {
          modelCalls += 1;
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(modelCalls).toBe(0);
    expect(run.status).toBe("interrupted");
    expect(run.turns[0]?.status).toBe("interrupted");
    expect(run.turns[0]?.steps[0]?.status).toBe("interrupted");
  });

  test("exposes the active Turn and Step projections for lifecycle inspection", async () => {
    const loop = createLoop();
    const observations: Array<[string, string | undefined, string | undefined]> = [];

    loop.subscribe((event: AgentLifecycleEvent) => {
      observations.push([
        event.type,
        loop.currentTurn?.id,
        loop.currentStep?.id,
      ]);
    });

    await loop.run({
      sessionId: "session-inspect",
      adapter: {
        async runModelStep() {
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    const stepStart = observations.find(([type]) => type === "step_start");
    expect(stepStart?.[1]).toBeDefined();
    expect(stepStart?.[2]).toBeDefined();

    const turnEnd = observations.find(([type]) => type === "turn_end");
    expect(turnEnd?.[1]).toBeUndefined();
    expect(turnEnd?.[2]).toBeUndefined();
  });
});

describe("Turn-safe interactions", () => {
  test("turn_end listeners can queue steering for the next safe Turn", async () => {
    const loop = createLoop();
    const causes: AgentTurnCause[] = [];
    let queued = false;

    loop.subscribe((event) => {
      if (event.type === "turn_end" && !queued) {
        queued = loop.steer({ text: "queued from turn_end" });
      }
    });

    const run = await loop.run({
      sessionId: "session-listener-steering",
      adapter: {
        async runModelStep(context) {
          causes.push(context.cause);
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(queued).toBe(true);
    expect(causes).toEqual(["initial", "steering"]);
    expect(run.turns.map((turn) => turn.cause)).toEqual(causes);
  });

  test("consumes steering after the active Turn and makes it the next Turn cause", async () => {
    const loop = createLoop();
    const causes: AgentTurnCause[] = [];
    const interactionTexts: Array<string | undefined> = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-steering",
      inputMessageId: "initial-message",
      adapter: {
        async runModelStep(context) {
          invocation += 1;
          causes.push(context.cause);
          interactionTexts.push(context.interaction?.text);

          if (invocation === 1) {
            expect(loop.steer({
              text: "change direction",
              inputMessageId: "steering-message",
            })).toBe(true);
          }

          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(causes).toEqual(["initial", "steering"]);
    expect(interactionTexts).toEqual([undefined, "change direction"]);
    expect(run.turns.map((turn) => turn.cause)).toEqual(["initial", "steering"]);
    expect(run.turns[1]?.inputMessageId).toBe("steering-message");
    expect(run.turns[1]?.interactionId).toBeDefined();
    expect(loop.pendingSteering).toHaveLength(0);
  });

  test("steering takes priority over automatic tool continuation", async () => {
    const loop = createLoop();
    const causes: AgentTurnCause[] = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-steer-tool",
      adapter: {
        async runModelStep(context) {
          causes.push(context.cause);
          invocation += 1;

          if (invocation === 1) {
            loop.steer({ text: "inspect a different file" });
            return {
              toolCalls: [
                {
                  toolCallId: "call-steer-tool",
                  toolName: "readFile",
                  input: {},
                },
              ],
            };
          }

          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(causes).toEqual(["initial", "steering"]);
    expect(run.turns).toHaveLength(2);
  });

  test("follow-up waits until the tool continuation chain would otherwise become idle", async () => {
    const loop = createLoop();
    const causes: AgentTurnCause[] = [];
    const interactionTexts: Array<string | undefined> = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-follow-up",
      adapter: {
        async runModelStep(context) {
          causes.push(context.cause);
          interactionTexts.push(context.interaction?.text);
          invocation += 1;

          if (invocation === 1) {
            expect(loop.followUp({ text: "summarize everything" })).toBe(true);
            return {
              toolCalls: [
                {
                  toolCallId: "call-follow-up",
                  toolName: "readFile",
                  input: {},
                },
              ],
            };
          }

          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(causes).toEqual([
      "initial",
      "tool-continuation",
      "follow-up",
    ]);
    expect(interactionTexts).toEqual([undefined, undefined, "summarize everything"]);
    expect(run.turns.map((turn) => turn.cause)).toEqual(causes);
    expect(loop.pendingFollowUps).toHaveLength(0);
  });

  test("resets the Step budget when follow-up starts a new interaction epoch", async () => {
    const loop = createLoop({ maxSteps: 3 });
    const causes: AgentTurnCause[] = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-follow-up-step-budget",
      adapter: {
        async runModelStep(context) {
          causes.push(context.cause);
          invocation += 1;

          if (invocation === 1) {
            expect(loop.followUp({ text: "continue after the first loop" })).toBe(true);
            return {
              toolCalls: [
                {
                  toolCallId: "call-follow-up-step-budget",
                  toolName: "readFile",
                  input: {},
                },
              ],
            };
          }

          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("completed");
    expect(causes).toEqual(["initial", "tool-continuation", "follow-up"]);
  });

  test("resets the Turn budget when follow-up starts a new interaction epoch", async () => {
    const loop = createLoop({ maxTurns: 2 });
    const causes: AgentTurnCause[] = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-follow-up-turn-budget",
      adapter: {
        async runModelStep(context) {
          causes.push(context.cause);
          invocation += 1;

          if (invocation === 1) {
            expect(loop.followUp({ text: "continue after the first loop" })).toBe(true);
            return {
              toolCalls: [
                {
                  toolCallId: "call-follow-up-turn-budget",
                  toolName: "readFile",
                  input: {},
                },
              ],
            };
          }

          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("completed");
    expect(causes).toEqual(["initial", "tool-continuation", "follow-up"]);
  });

  test("rejects queued interactions when no Run is active", () => {
    const loop = createLoop();
    expect(loop.steer({ text: "late steering" })).toBe(false);
    expect(loop.followUp({ text: "late follow-up" })).toBe(false);
  });

  test("queued follow-up can be cancelled before consumption without creating a Turn", async () => {
    const loop = createLoop();
    let releaseModel!: () => void;
    let modelStarted!: () => void;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const barrier = new Promise<void>((resolve) => { releaseModel = resolve; });

    const runPromise = loop.run({
      sessionId: "session-cancel-follow-up",
      adapter: {
        async runModelStep() {
          modelStarted();
          await barrier;
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    await started;
    const queued = loop.enqueueFollowUp({ text: "do not consume me" });
    expect(queued?.kind).toBe("follow-up");
    expect(loop.pendingInteractions).toHaveLength(1);
    expect(loop.cancelPendingInteraction(queued!.id)).toBe(true);
    expect(loop.pendingInteractions).toHaveLength(0);
    releaseModel();

    const run = await runPromise;
    expect(run.status).toBe("completed");
    expect(run.turns).toHaveLength(1);
  });

  test("promotes an exact follow-up to steering atomically", async () => {
    const loop = createLoop();
    const causes: AgentTurnCause[] = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-promote-follow-up",
      adapter: {
        async runModelStep(context) {
          causes.push(context.cause);
          invocation += 1;
          if (invocation === 1) {
            const queued = loop.enqueueFollowUp({ text: "promote this" });
            expect(queued).not.toBeNull();
            expect(loop.promoteFollowUpToSteering(queued!.id)).toBe(true);
            expect(loop.pendingInteractions).toEqual([
              expect.objectContaining({ id: queued!.id, kind: "steering" }),
            ]);
          }
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("completed");
    expect(causes).toEqual(["initial", "steering"]);
  });

  test("commits a consumed interaction exactly once before the next Provider call", async () => {
    const loop = createLoop();
    const trace: string[] = [];
    let invocation = 0;

    const run = await loop.run({
      sessionId: "session-durable-on-consume",
      adapter: {
        async commitInteraction(interaction) {
          trace.push(`commit:${interaction.id}`);
          return { ...interaction, inputMessageId: `durable-${interaction.id}` };
        },
        async runModelStep(context) {
          invocation += 1;
          trace.push(`model:${context.cause}:${context.interaction?.inputMessageId ?? "initial"}`);
          if (invocation === 1) {
            expect(loop.enqueueFollowUp({ text: "committed later" })).not.toBeNull();
          }
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("completed");
    expect(trace).toHaveLength(3);
    expect(trace[0]).toBe("model:initial:initial");
    expect(trace[1]?.startsWith("commit:")).toBe(true);
    expect(trace[2]).toContain("model:follow-up:durable-");
  });

  test("failed interaction commit prevents the follow-up Provider side effect", async () => {
    const loop = createLoop();
    let modelCalls = 0;
    let commitCalls = 0;
    const outcomes: string[] = [];

    const run = await loop.run({
      sessionId: "session-commit-failure",
      onPendingInteractionOutcome(outcome) {
        outcomes.push(`${outcome.reason}:${outcome.interaction.text}`);
      },
      adapter: {
        async commitInteraction() {
          commitCalls += 1;
          throw new Error("session commit rejected");
        },
        async runModelStep() {
          modelCalls += 1;
          if (modelCalls === 1) {
            expect(loop.enqueueFollowUp({ text: "must not reach provider" })).not.toBeNull();
          }
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(commitCalls).toBe(1);
    expect(modelCalls).toBe(1);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("session commit rejected");
    expect(outcomes).toEqual(["run-failed:must not reach provider"]);
  });

  test("closes interaction acceptance before run settlement to avoid stranded queue entries", async () => {
    const loop = createLoop();
    const acceptedDuringRunEnd: boolean[] = [];
    loop.subscribe((event) => {
      if (event.type === "run_end") {
        acceptedDuringRunEnd.push(loop.followUp({ text: "too late for old run" }));
      }
    });

    const run = await loop.run({
      sessionId: "session-close-gate",
      adapter: {
        async runModelStep() {
          return { toolCalls: [] };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("completed");
    expect(acceptedDuringRunEnd).toEqual([false]);
    expect(loop.pendingInteractions).toHaveLength(0);
  });

  test("reports pending queue outcomes when an interrupted Run cannot consume them", async () => {
    const loop = createLoop();
    const outcomes: string[] = [];

    const run = await loop.run({
      sessionId: "session-interrupt-queue-outcome",
      onPendingInteractionOutcome(outcome) {
        outcomes.push(`${outcome.reason}:${outcome.interaction.text}`);
      },
      adapter: {
        async runModelStep() {
          expect(loop.enqueueFollowUp({ text: "queued while active" })).not.toBeNull();
          loop.interrupt();
          throw new Error("aborted");
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("interrupted");
    expect(outcomes).toEqual(["run-interrupted:queued while active"]);
    expect(loop.pendingInteractions).toHaveLength(0);
  });

  test("enforces the Turn budget within an interaction epoch", async () => {
    const loop = createLoop({ maxTurns: 1 });

    const run = await loop.run({
      sessionId: "session-turn-budget",
      adapter: {
        async runModelStep() {
          return {
            toolCalls: [
              {
                toolCallId: "call-turn-budget",
                toolName: "readFile",
                input: {},
              },
            ],
          };
        },
        async runToolStep() {},
      },
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("maximum of 1 turns");
    expect(run.turns).toHaveLength(1);
    expect(run.turns[0]?.status).toBe("completed");
  });
});
