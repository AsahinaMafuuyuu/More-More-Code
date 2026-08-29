import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  createInitialSessionUiState,
  createSessionUiStore,
} from "../src/ui/session/store/session-ui-store";
import {
  SessionUiStoreProvider,
  useSessionUiSelector,
} from "../src/ui/session/store/react-session-ui";
import {
  selectActivity,
  selectComposerRuntime,
  selectConversation,
  selectInteractionQueue,
  selectStatus,
} from "../src/ui/session/store/session-ui-selectors";

describe("Session UI render isolation", () => {
  test("activity and status updates rerender only their selected probes", async () => {
    const store = createSessionUiStore(createInitialSessionUiState());
    const renders = {
      conversation: 0,
      activity: 0,
      status: 0,
      composer: 0,
      queue: 0,
    };

    function ConversationProbe() {
      renders.conversation += 1;
      const value = useSessionUiSelector(selectConversation);
      return <text>{value.messages.length}</text>;
    }
    function ActivityProbe() {
      renders.activity += 1;
      const value = useSessionUiSelector(selectActivity);
      return <text>{value?.status ?? "idle"}</text>;
    }
    function StatusProbe() {
      renders.status += 1;
      const value = useSessionUiSelector(selectStatus);
      return <text>{value.contextLabel}</text>;
    }
    function ComposerProbe() {
      renders.composer += 1;
      const value = useSessionUiSelector(selectComposerRuntime);
      return <text>{value.runActive ? "active" : "idle"}</text>;
    }
    function QueueProbe() {
      renders.queue += 1;
      const value = useSessionUiSelector(selectInteractionQueue);
      return <text>{value.pending.length}</text>;
    }

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <SessionUiStoreProvider store={store}>
          <box flexDirection="column">
            <ConversationProbe />
            <ActivityProbe />
            <StatusProbe />
            <ComposerProbe />
            <QueueProbe />
          </box>
        </SessionUiStoreProvider>,
        { width: 80, height: 20 },
      );
      await setup.flush({ maxPasses: 10 });
    });

    try {
      const initial = { ...renders };
      await act(async () => {
        store.setSlice("activity", {
          runId: "run-1",
          status: "running",
          turns: [],
        });
        await setup.flush({ maxPasses: 10 });
      });
      expect(renders.activity).toBe(initial.activity + 1);
      expect(renders.conversation).toBe(initial.conversation);
      expect(renders.status).toBe(initial.status);
      expect(renders.composer).toBe(initial.composer);
      expect(renders.queue).toBe(initial.queue);

      const afterActivity = { ...renders };
      await act(async () => {
        store.setSlice("status", {
          ...store.getSnapshot().status,
          contextLabel: "64k/128k",
          contextUtilizationRatio: 0.5,
        });
        await setup.flush({ maxPasses: 10 });
      });
      expect(renders.status).toBe(afterActivity.status + 1);
      expect(renders.conversation).toBe(afterActivity.conversation);
      expect(renders.activity).toBe(afterActivity.activity);
      expect(renders.composer).toBe(afterActivity.composer);
      expect(renders.queue).toBe(afterActivity.queue);

      const afterStatus = { ...renders };
      await act(async () => {
        store.setSlice("interactionQueue", {
          pending: [{
            id: "pending-1",
            kind: "follow-up",
            text: "queued",
            createdAt: 1,
          }],
          outcomes: [],
        });
        await setup.flush({ maxPasses: 10 });
      });
      expect(renders.queue).toBe(afterStatus.queue + 1);
      expect(renders.conversation).toBe(afterStatus.conversation);
      expect(renders.activity).toBe(afterStatus.activity);
      expect(renders.status).toBe(afterStatus.status);
      expect(renders.composer).toBe(afterStatus.composer);
    } finally {
      setup.renderer.destroy();
      store.destroy();
    }
  });
});
