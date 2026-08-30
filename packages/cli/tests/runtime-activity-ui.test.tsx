import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ActivityView } from "../src/components/activity-view";
import { BotMessage } from "../src/components/messages/bot-message";
import { ToolUse } from "../src/components/messages/tool-use";
import { ThemeProvider } from "../src/providers/theme";
import { TerminalDimensionsProvider } from "../src/providers/terminal-dimensions";
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

function UiProviders({ children }: { children: React.ReactNode }) {
  return (
    <TerminalDimensionsProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </TerminalDimensionsProvider>
  );
}

describe("Runtime Activity UI", () => {
  test("collapses long reasoning to two rows by default", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <UiProviders>
          <BotMessage
            parts={[{
              type: "reasoning",
              text: `FIRST reasoning ${"context ".repeat(50)}\nSECOND reasoning ${"detail ".repeat(50)}\nLATE_REASONING_MARKER`,
            } as never]}
            toolUses={{}}
          />
        </UiProviders>,
        { width: 54, height: 40 },
      );
    });
    try {
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Thinking:");
      expect(frame).toContain("▸");
      expect(frame).not.toContain("LATE_REASONING_MARKER");

      await act(async () => {
        await setup.mockMouse.click(4, 0);
        await setup.flush({ maxPasses: 10 });
      });
      const expanded = setup.captureCharFrame();
      expect(expanded).toContain("▾");
      expect(expanded).toContain("LATE_REASONING_MARKER");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("collapsed streaming reasoning keeps an explicit active marker", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <UiProviders>
          <BotMessage
            parts={[{
              type: "reasoning",
              text: `Working ${"detail ".repeat(40)}`,
              state: "streaming",
            } as never]}
            toolUses={{}}
          />
        </UiProviders>,
        { width: 70, height: 20 },
      );
    });
    try {
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Thinking:");
      expect(frame).toContain("● active");
      expect(frame).toContain("▸");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("collapses consecutive tools into one aggregate status row", async () => {
    const parts = [
      { type: "tool-readFile", toolCallId: "call-1", state: "output-available", input: { path: "a.ts" }, output: "a" },
      { type: "tool-grep", toolCallId: "call-2", state: "output-available", input: { pattern: "x" }, output: "b" },
      { type: "tool-bash", toolCallId: "call-3", state: "output-error", input: { command: "bun test" }, errorText: "failed" },
    ] as never;
    const toolUses: Record<string, ToolUseView> = {
      "call-1": { toolCallId: "call-1", toolName: "readFile", status: "completed" },
      "call-2": { toolCallId: "call-2", toolName: "grep", status: "completed" },
      "call-3": { toolCallId: "call-3", toolName: "bash", status: "failed", error: "failed" },
    };
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <UiProviders><BotMessage parts={parts} toolUses={toolUses} /></UiProviders>,
        { width: 90, height: 20 },
      );
    });
    try {
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Tools 3");
      expect(frame).toContain("2 completed");
      expect(frame).toContain("1 failed");
      expect(frame).not.toContain("Read File");
      expect(frame).not.toContain("Grep");
      expect(frame).not.toContain("Bash");

      await act(async () => {
        await setup.mockMouse.click(4, 0);
        await setup.flush({ maxPasses: 10 });
      });
      const expanded = setup.captureCharFrame();
      expect(expanded).toContain("Read File");
      expect(expanded).toContain("Grep");
      expect(expanded).toContain("Bash");
    } finally {
      setup.renderer.destroy();
    }
  });

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
      return <UiProviders><ActivityView activity={tickingActivity} /></UiProviders>;
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
          <UiProviders><ActivityView activity={tickingActivity} /></UiProviders>,
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
        <UiProviders><ActivityView activity={activity()} /></UiProviders>,
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
        <UiProviders><ActivityView activity={activity()} /></UiProviders>,
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
        <UiProviders><ToolUse view={view} /></UiProviders>,
        { width: 90, height: 20 },
      );
    });
    try {
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("✓");
      expect(frame).toContain("Bash · bun test packages/cli · completed · 2.4s");
      expect(frame).not.toContain("...");

      await act(async () => {
        await setup.mockMouse.click(4, 0);
        await setup.flush({ maxPasses: 10 });
      });
      const expanded = setup.captureCharFrame();
      expect(expanded).toContain("input");
      expect(expanded).toContain("output");
      expect(expanded).toContain("191 pass");
    } finally {
      setup.renderer.destroy();
    }
  });
});
