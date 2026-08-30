import { describe, expect, test } from "bun:test";
import {
  createInitialSessionUiState,
  createSessionUiStore,
} from "../src/ui/session/store/session-ui-store";
import {
  selectActivity,
  selectConversation,
  selectInspector,
  selectStatus,
} from "../src/ui/session/store/session-ui-selectors";

describe("Session UI Store", () => {
  test("isolates selector subscriptions to the slice that actually changes", () => {
    const store = createSessionUiStore(createInitialSessionUiState());
    let activityNotifications = 0;
    let conversationNotifications = 0;

    const unsubscribeActivity = store.subscribeSelector(
      selectActivity,
      () => activityNotifications += 1,
    );
    const unsubscribeConversation = store.subscribeSelector(
      selectConversation,
      () => conversationNotifications += 1,
    );

    store.setSlice("activity", {
      runId: "run-1",
      status: "running",
      turns: [],
    });

    expect(activityNotifications).toBe(1);
    expect(conversationNotifications).toBe(0);

    unsubscribeActivity();
    unsubscribeConversation();
  });

  test("uses selector equality to suppress equivalent selected values", () => {
    const store = createSessionUiStore(createInitialSessionUiState());
    let notifications = 0;
    const unsubscribe = store.subscribeSelector(
      selectStatus,
      () => notifications += 1,
      (left, right) => left.mode === right.mode && left.modelLabel === right.modelLabel,
    );

    store.setSlice("status", {
      ...store.getSnapshot().status,
      contextLabel: "1k/128k",
    });
    expect(notifications).toBe(0);

    store.setSlice("status", {
      ...store.getSnapshot().status,
      mode: "PLAN",
    });
    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("keeps stores isolated and disposal prevents later listener updates", () => {
    const first = createSessionUiStore(createInitialSessionUiState());
    const second = createSessionUiStore(createInitialSessionUiState());
    let firstInspectorNotifications = 0;
    let secondInspectorNotifications = 0;

    first.subscribeSelector(selectInspector, () => firstInspectorNotifications += 1);
    second.subscribeSelector(selectInspector, () => secondInspectorNotifications += 1);

    first.setSlice("inspector", { open: true, section: "tree" });
    expect(firstInspectorNotifications).toBe(1);
    expect(secondInspectorNotifications).toBe(0);
    expect(second.getSnapshot().inspector.open).toBe(false);

    const snapshotBeforeDestroy = first.getSnapshot();
    first.destroy();
    first.setSlice("inspector", { open: false, section: "context" });

    expect(firstInspectorNotifications).toBe(1);
    expect(first.getSnapshot()).toBe(snapshotBeforeDestroy);
    expect(Object.isFrozen(first.getSnapshot())).toBe(true);
  });
});
