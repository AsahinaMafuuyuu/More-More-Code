import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ActivityView } from "../src/components/activity-view";
import { ToolUse } from "../src/components/messages/tool-use";
import { ThemeProvider } from "../src/providers/theme";
import type { AgentActivityView } from "../src/lib/agent-activity-projection";
import type { ToolUseView } from "../src/lib/tool-use-projection";

function activity(): AgentActivityView {
  return {
    runId: "run-1",
    status: "running",
    elapsedMs: 2_000,
    activeStepId: "step-bash",
    turns: [{
      id: "turn-1",
      index: 0,
      cause: "initial",
      status: "completed",
      elapsedMs: 1_000,
      active: false,
      steps: [{
        id: "step-model",
        index: 0,
        kind: "model",
        label: "Model",
        status: "completed",
        elapsedMs: 1_000,
        active: false,
      }],
    }, {
      id: "turn-2",
      index: 1,
      cause: "tool-continuation",
      status: "running",
      elapsedMs: 900,
      active: true,
      steps: [{
        id: "step-bash",
        index: 0,
        kind: "tool",
        label: "Bash",
        status: "running",
        elapsedMs: 800,
        active: true,
        toolCallId: "call-bash",
        toolName: "bash",
        progress: { message: "compiling workspace", completed: 2, total: 5 },
      }],
    }],
  };
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.flush({ maxPasses: 10 });
  });
}

describe("Runtime Activity UI", () => {
  test("advances elapsed time inside ActivityView without rerendering its parent", async () => {
    const startedAt = Date.now() - 1_000;
    const tickingActivity = activity();
    tickingActivity.startedAt = startedAt;
    tickingActivity.elapsedMs = 1_000;
    tickingActivity.turns[1]!.startedAt = startedAt + 100;
    tickingActivity.turns[1]!.elapsedMs = 900;
    tickingActivity.turns[1]!.steps[0]!.startedAt = startedAt + 200;
    tickingActivity.turns[1]!.steps[0]!.elapsedMs = 800;

    let parentRenders = 0;
    function Probe() {
      parentRenders += 1;
      return <ThemeProvider><ActivityView activity={tickingActivity} /></ThemeProvider>;
    }

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<Probe />, { width: 100, height: 30 });
    });

    try {
      await flush(setup);
      const initialParentRenders = parentRenders;
      const before = setup.captureCharFrame();
      const beforeSeconds = Number(before.match(/Agent Activity · running · ([0-9.]+)s/)?.[1]);
      expect(Number.isFinite(beforeSeconds)).toBe(true);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        await setup.flush({ maxPasses: 10 });
      });

      const after = setup.captureCharFrame();
      const afterSeconds = Number(after.match(/Agent Activity · running · ([0-9.]+)s/)?.[1]);
      expect(afterSeconds).toBeGreaterThan(beforeSeconds + 0.5);
      expect(parentRenders).toBe(initialParentRenders);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("safe TUI profile disables the presentation-only elapsed timer", async () => {
    const previous = process.env.MORE_MORE_CODE_TUI_PROFILE;
    process.env.MORE_MORE_CODE_TUI_PROFILE = "safe";
    const startedAt = Date.now() - 1_000;
    const tickingActivity = activity();
    tickingActivity.startedAt = startedAt;
    tickingActivity.elapsedMs = 1_000;

    let setup!: Awaited<ReturnType<typeof testRender>>;
    try {
      await act(async () => {
        setup = await testRender(
          <ThemeProvider><ActivityView activity={tickingActivity} /></ThemeProvider>,
          { width: 100, height: 30 },
        );
      });
      await flush(setup);
      const before = setup.captureCharFrame();
      const beforeSeconds = Number(before.match(/Agent Activity · running · ([0-9.]+)s/)?.[1]);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        await setup.flush({ maxPasses: 10 });
      });

      const after = setup.captureCharFrame();
      const afterSeconds = Number(after.match(/Agent Activity · running · ([0-9.]+)s/)?.[1]);
      expect(afterSeconds).toBe(beforeSeconds);
    } finally {
      setup?.renderer.destroy();
      if (previous === undefined) delete process.env.MORE_MORE_CODE_TUI_PROFILE;
      else process.env.MORE_MORE_CODE_TUI_PROFILE = previous;
    }
  });

  test("renders Activity with width-aware density", async () => {
    let medium!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      medium = await testRender(
        <ThemeProvider><ActivityView activity={activity()} /></ThemeProvider>,
        { width: 100, height: 30 },
      );
    });
    try {
      await flush(medium);
      const frame = medium.captureCharFrame();
      expect(frame).toContain("Agent Activity · running · 2.0s");
      expect(frame).toContain("Turn 1 · initial · completed");
      expect(frame).toContain("Bash · running · 0.8s · compiling workspace 2/5");
    } finally {
      medium.renderer.destroy();
    }

    let narrow!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      narrow = await testRender(
        <ThemeProvider><ActivityView activity={activity()} /></ThemeProvider>,
        { width: 60, height: 24 },
      );
    });
    try {
      await flush(narrow);
      const frame = narrow.captureCharFrame();
      expect(frame).toContain("Activity · running");
      expect(frame).toContain("Bash · running");
      expect(frame).not.toContain("compiling workspace");
    } finally {
      narrow.renderer.destroy();
    }
  });

  test("renders semantic ToolUse status instead of the old ellipsis-only row", async () => {
    const view: ToolUseView = {
      toolCallId: "call-1",
      toolName: "bash",
      status: "completed",
      input: { command: "bun test packages/cli" },
      output: "191 pass",
      durationMs: 2_400,
      source: "native",
    };
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <ThemeProvider><ToolUse view={view} /></ThemeProvider>,
        { width: 90, height: 20 },
      );
    });
    try {
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("✓");
      expect(frame).toContain("Bash · bun test packages/cli · completed · 2.4s");
      expect(frame).not.toContain("...");
    } finally {
      setup.renderer.destroy();
    }
  });
});
