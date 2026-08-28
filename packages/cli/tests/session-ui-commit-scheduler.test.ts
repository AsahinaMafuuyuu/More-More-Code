import { describe, expect, test } from "bun:test";
import {
  createInitialSessionUiState,
  createSessionUiStore,
  type SessionUiState,
} from "../src/ui/session/store/session-ui-store";
import { createSessionUiCommitScheduler } from "../src/ui/session/runtime/session-ui-commit-scheduler";

function createManualTimers() {
  let callback: (() => void) | null = null;
  let scheduled = 0;
  let cleared = 0;
  return {
    schedule(next: () => void, delayMs: number) {
      expect(delayMs).toBe(50);
      scheduled += 1;
      callback = next;
      return scheduled;
    },
    clear() {
      cleared += 1;
      callback = null;
    },
    fire() {
      const next = callback;
      callback = null;
      next?.();
    },
    get scheduled() {
      return scheduled;
    },
    get cleared() {
      return cleared;
    },
  };
}

function conversation(label: string): SessionUiState["conversation"] {
  return {
    messages: [{ id: label, role: "assistant", parts: [{ type: "text", text: label }] } as never],
    toolUses: {},
    errorMessage: null,
    runErrorMessage: null,
  };
}

describe("Session UI commit scheduler", () => {
  test("coalesces a 100-patch burst into one latest-value store notification", () => {
    const store = createSessionUiStore(createInitialSessionUiState());
    const timers = createManualTimers();
    let notifications = 0;
    store.subscribe(() => notifications += 1);
    const scheduler = createSessionUiCommitScheduler({
      store,
      commitHz: 20,
      scheduleTimeout: timers.schedule,
      clearTimeout: timers.clear,
    });

    for (let index = 1; index <= 100; index += 1) {
      scheduler.enqueuePresentation({ conversation: conversation(`chunk-${index}`) });
    }

    expect(timers.scheduled).toBe(1);
    expect(notifications).toBe(0);
    timers.fire();
    expect(notifications).toBe(1);
    expect(store.getSnapshot().conversation.messages[0]?.id).toBe("chunk-100");
  });

  test("merges latest conversation, activity and status into one presentation commit", () => {
    const store = createSessionUiStore(createInitialSessionUiState());
    const timers = createManualTimers();
    let notifications = 0;
    store.subscribe(() => notifications += 1);
    const scheduler = createSessionUiCommitScheduler({
      store,
      commitHz: 20,
      scheduleTimeout: timers.schedule,
      clearTimeout: timers.clear,
    });
    const status = { ...store.getSnapshot().status, modelLabel: "model-b" };

    scheduler.enqueuePresentation({ conversation: conversation("first") });
    scheduler.enqueuePresentation({ status });
    scheduler.enqueuePresentation({ activity: null, conversation: conversation("latest") });
    timers.fire();

    expect(notifications).toBe(1);
    expect(store.getSnapshot().conversation.messages[0]?.id).toBe("latest");
    expect(store.getSnapshot().status.modelLabel).toBe("model-b");
  });

  test("flushes pending presentation before latency-sensitive immediate state", () => {
    const store = createSessionUiStore(createInitialSessionUiState());
    const timers = createManualTimers();
    const observations: string[] = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      observations.push(`${snapshot.conversation.messages[0]?.id ?? "empty"}:${snapshot.approval ? "approval" : "none"}`);
    });
    const scheduler = createSessionUiCommitScheduler({
      store,
      commitHz: 20,
      scheduleTimeout: timers.schedule,
      clearTimeout: timers.clear,
    });

    scheduler.enqueuePresentation({ conversation: conversation("final-visible") });
    scheduler.commitImmediate({ approval: { id: "approval-1" } as never });

    expect(observations).toEqual([
      "final-visible:none",
      "final-visible:approval",
    ]);
  });

  test("terminal commit flushes the last streaming text before composer becomes idle", () => {
    const initial = createInitialSessionUiState({
      composerRuntime: {
        disabled: true,
        runActive: true,
        canInterrupt: true,
        submitMode: "steer",
        followUpAvailable: true,
      },
    });
    const store = createSessionUiStore(initial);
    const timers = createManualTimers();
    const observations: string[] = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      observations.push(`${snapshot.conversation.messages[0]?.id ?? "empty"}:${snapshot.composerRuntime.runActive}`);
    });
    const scheduler = createSessionUiCommitScheduler({
      store,
      commitHz: 20,
      scheduleTimeout: timers.schedule,
      clearTimeout: timers.clear,
    });

    scheduler.enqueuePresentation({ conversation: conversation("last-chunk") });
    scheduler.commitImmediate({
      composerRuntime: {
        disabled: false,
        runActive: false,
        canInterrupt: false,
        submitMode: "submit",
        followUpAvailable: false,
      },
    });

    expect(observations).toEqual(["last-chunk:true", "last-chunk:false"]);
  });

  test("dispose cancels pending work, is idempotent and isolates session schedulers", () => {
    const firstStore = createSessionUiStore(createInitialSessionUiState());
    const secondStore = createSessionUiStore(createInitialSessionUiState());
    const firstTimers = createManualTimers();
    const secondTimers = createManualTimers();
    let firstNotifications = 0;
    let secondNotifications = 0;
    firstStore.subscribe(() => firstNotifications += 1);
    secondStore.subscribe(() => secondNotifications += 1);
    const first = createSessionUiCommitScheduler({
      store: firstStore,
      commitHz: 20,
      scheduleTimeout: firstTimers.schedule,
      clearTimeout: firstTimers.clear,
    });
    const second = createSessionUiCommitScheduler({
      store: secondStore,
      commitHz: 20,
      scheduleTimeout: secondTimers.schedule,
      clearTimeout: secondTimers.clear,
    });

    first.enqueuePresentation({ conversation: conversation("first") });
    second.enqueuePresentation({ conversation: conversation("second") });
    first.dispose();
    first.dispose();
    first.enqueuePresentation({ conversation: conversation("ignored") });
    first.commitImmediate({ recovery: { key: "ignored", message: "ignored" } });
    firstTimers.fire();
    secondTimers.fire();

    expect(firstTimers.cleared).toBe(1);
    expect(firstNotifications).toBe(0);
    expect(secondNotifications).toBe(1);
    expect(secondStore.getSnapshot().conversation.messages[0]?.id).toBe("second");
  });
});
