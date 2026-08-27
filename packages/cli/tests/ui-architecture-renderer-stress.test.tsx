import { describe, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ThemeProvider } from "../src/providers/theme";
import { SessionWorkspace } from "../src/ui/session/workspace/session-workspace";
import { ActivityView } from "../src/components/activity-view";
import { ToolUse } from "../src/components/messages/tool-use";
import type { AgentActivityView } from "../src/lib/agent-activity-projection";

const activity: AgentActivityView = {
  runId: "stress-run",
  status: "running",
  startedAt: Date.now() - 500,
  elapsedMs: 500,
  activeStepId: "stress-step",
  turns: [{
    id: "stress-turn",
    index: 0,
    cause: "initial",
    status: "running",
    startedAt: Date.now() - 400,
    elapsedMs: 400,
    active: true,
    steps: [{
      id: "stress-step",
      index: 0,
      kind: "tool",
      label: "Bash",
      status: "running",
      startedAt: Date.now() - 300,
      elapsedMs: 300,
      active: true,
      toolCallId: "stress-call",
      toolName: "bash",
    }],
  }],
};

describe("UI Architecture renderer stress", () => {
  test("repeatedly mounts/destroys Activity, ToolUse, Conversation and responsive workspace", async () => {
    const sizes = [[60, 20], [72, 24], [100, 30], [120, 30], [160, 40]] as const;
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const [width, height] = sizes[iteration % sizes.length]!;
      let setup!: Awaited<ReturnType<typeof testRender>>;
      await act(async () => {
        setup = await testRender(
          <ThemeProvider>
            <SessionWorkspace
              conversation={(
                <box flexDirection="column">
                  <text>Conversation {iteration}</text>
                  <ToolUse view={{
                    toolCallId: `call-${iteration}`,
                    toolName: "bash",
                    status: "completed",
                    input: { command: "bun test" },
                    output: "ok",
                    durationMs: 25,
                  }} />
                </box>
              )}
              activity={<ActivityView activity={activity} />}
              composer={<text>Composer</text>}
              status={<text>Status</text>}
              hints={<text>Hints</text>}
            />
          </ThemeProvider>,
          { width, height },
        );
      });
      try {
        await act(async () => { await setup.flush({ maxPasses: 10 }); });
      } finally {
        setup.renderer.destroy();
      }
    }
  });
});
