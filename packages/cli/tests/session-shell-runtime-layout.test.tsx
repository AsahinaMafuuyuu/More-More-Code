import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { testRender } from "@opentui/react/test-utils";
import { RootLayout } from "../src/layouts/root-layout";
import { SessionShell } from "../src/components/session-shell";
import { bootstrapAgentEnvironment } from "../src/lib/agent-environment";
import type { AgentActivityView } from "../src/lib/agent-activity-projection";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function activity(): AgentActivityView {
  return {
    runId: "run-layout",
    status: "running",
    elapsedMs: 1_000,
    activeStepId: "step-model",
    turns: [{
      id: "turn-layout",
      index: 0,
      cause: "initial",
      status: "running",
      elapsedMs: 900,
      active: true,
      steps: [{
        id: "step-model",
        index: 0,
        kind: "model",
        label: "Model",
        status: "running",
        elapsedMs: 800,
        active: true,
      }],
    }],
  };
}

function Probe() {
  return (
    <SessionShell
      onSubmit={() => {}}
      activity={activity()}
      loading
      interruptible
    >
      <box><text>Conversation sentinel</text></box>
    </SessionShell>
  );
}

describe("SessionShell runtime hierarchy", () => {
  test("keeps Conversation -> Activity -> Input/StatusBar -> secondary hints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-runtime-layout-"));
    tempDirectories.push(root);
    await bootstrapAgentEnvironment({
      globalHome: path.join(root, "home"),
      workspaceRoot: path.join(root, "workspace"),
    });

    const router = createMemoryRouter([{
      path: "/",
      element: <RootLayout />,
      children: [{ index: true, element: <Probe /> }],
    }], { initialEntries: ["/"] });
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<RouterProvider router={router} />, {
        width: 100,
        height: 32,
      });
    });

    try {
      await act(async () => {
        await setup.flush({ maxPasses: 10 });
      });
      const frame = setup.captureCharFrame();
      const conversationIndex = frame.indexOf("Conversation sentinel");
      const activityIndex = frame.indexOf("Agent Activity");
      const inputIndex = frame.indexOf("Ask anything");
      const statusIndex = frame.indexOf("Build");
      const hintsIndex = frame.indexOf("enter steer");

      expect(conversationIndex).toBeGreaterThanOrEqual(0);
      expect(activityIndex).toBeGreaterThan(conversationIndex);
      expect(inputIndex).toBeGreaterThan(activityIndex);
      expect(statusIndex).toBeGreaterThan(inputIndex);
      expect(hintsIndex).toBeGreaterThan(statusIndex);
    } finally {
      setup.renderer.destroy();
    }
  });
});
