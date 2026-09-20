import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { testRender } from "@opentui/react/test-utils";
import type { SessionController } from "../src/app/session/session-controller";
import { RootLayout } from "../src/layouts/root-layout";
import { bootstrapAgentEnvironment } from "../src/lib/agent-environment";
import { InspectorSurface } from "../src/ui/session/workspace/inspector-surface";
import { SessionUiStoreProvider } from "../src/ui/session/store/react-session-ui";
import {
  createInitialSessionUiState,
  createSessionUiStore,
  type SessionUiStore,
} from "../src/ui/session/store/session-ui-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

async function renderInspector(width = 100) {
  const root = await mkdtemp(path.join(tmpdir(), "more-more-code-inspector-"));
  temporaryDirectories.push(root);
  await bootstrapAgentEnvironment({
    globalHome: path.join(root, "home"),
    workspaceRoot: path.join(root, "workspace"),
  });

  const store = createSessionUiStore(createInitialSessionUiState({
    inspector: { open: true, section: "tree" },
    inspectorContext: {
      available: true,
      currentInput: "42.8k",
      contextWindow: "128k",
      utilization: "33.4%",
      utilizationRatio: 0.334,
      inputBudget: "112k",
      reservedOutput: "12k",
      safetyMargin: "4k",
      counterId: "heuristic-v1",
      quality: "estimated",
    },
    inspectorUsage: {
      inputTotal: "10k",
      inputNoCache: "2.5k",
      cacheRead: "7.5k",
      cacheWrite: "—",
      outputTotal: "800",
      outputText: "600",
      outputReasoning: "200",
      cacheHit: "75.0%",
      cacheCoverage: "complete",
      apiCost: "$0.0123",
      costCoverage: "complete",
      completedSteps: "3",
      integrity: "valid",
      persistenceIncomplete: false,
    },
    inspectorTree: {
      entries: [
        {
          id: "user-1",
          label: "User",
          preview: "Inspect the current stage",
          depth: 0,
          createdAt: 1,
          navigationTargetEntryId: "entry-user-1",
          selectable: true,
          active: true,
          activePath: true,
        },
        {
          id: "assistant-2",
          label: "Assistant",
          preview: "Unrelated historical answer",
          depth: 0,
          createdAt: 2,
          navigationTargetEntryId: "entry-assistant-2",
          selectable: true,
          active: false,
          activePath: false,
        },
      ],
    },
  }));
  const controller = {} as SessionController;

  function Probe() {
    return (
      <SessionUiStoreProvider store={store}>
        <box><text>Session background</text></box>
        <InspectorSurface controller={controller} />
      </SessionUiStoreProvider>
    );
  }

  const router = createMemoryRouter([{
    path: "/",
    element: <RootLayout />,
    children: [{ index: true, element: <Probe /> }],
  }], { initialEntries: ["/"] });

  const setup = await testRender(<RouterProvider router={router} />, {
    width,
    height: 28,
  });
  return { setup, store };
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.flush({ maxPasses: 10 });
  });
}

describe("Session Inspector surface", () => {
  test("renders Tree, Context and Usage in one shell", async () => {
    const { setup, store } = await renderInspector();
    try {
      await flush(setup);
      expect(setup.captureCharFrame()).toContain("SESSION INSPECTOR");
      expect(setup.captureCharFrame()).toContain("Inspect the current stage");

      await act(async () => {
        store.setSlice("inspector", { open: true, section: "context" });
      });
      await flush(setup);
      expect(setup.captureCharFrame()).toContain("Current model context");
      expect(setup.captureCharFrame()).toContain("heuristic-v1");

      await act(async () => {
        store.setSlice("inspector", { open: true, section: "usage" });
      });
      await flush(setup);
      expect(setup.captureCharFrame()).toContain("Provider usage and calculated cost");
      expect(setup.captureCharFrame()).toContain("$0.0123");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("renders the compact Inspector hierarchy on a narrow terminal", async () => {
    const { setup, store } = await renderInspector(60);
    try {
      await act(async () => {
        store.setSlice("inspector", { open: true, section: "context" });
      });
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("SESSION INSPECTOR");
      expect(frame).toContain("Current input");
      expect(frame).toContain("42.8k");
      expect(frame).toContain("Safety margin");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("Tab changes sections and Tree typing filters without a focused input", async () => {
    const { setup, store } = await renderInspector();
    try {
      await flush(setup);
      expect(store.getSnapshot().inspector.section).toBe("tree");

      await act(async () => {
        setup.mockInput.pressTab();
      });
      await flush(setup);
      expect(store.getSnapshot().inspector.section).toBe("context");
      expect(setup.captureCharFrame()).toContain("Current model context");

      await act(async () => {
        setup.mockInput.pressTab({ shift: true });
      });
      await flush(setup);
      expect(store.getSnapshot().inspector.section).toBe("tree");

      await act(async () => {
        await setup.mockInput.typeText("inspect");
      });
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Inspect the current stage");
      expect(frame).not.toContain("Unrelated historical answer");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("Escape closes Inspector before the base Session layer can act", async () => {
    const { setup, store } = await renderInspector();
    try {
      await flush(setup);
      expect(store.getSnapshot().inspector.open).toBe(true);
      await act(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      await flush(setup);
      expect(store.getSnapshot().inspector.open).toBe(false);
      expect(setup.captureCharFrame()).not.toContain("SESSION INSPECTOR");
      expect(setup.captureCharFrame()).toContain("Session background");
    } finally {
      setup.renderer.destroy();
    }
  });
});
