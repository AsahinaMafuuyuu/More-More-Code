import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ThemeProvider } from "../src/providers/theme";
import { TerminalDimensionsProvider } from "../src/providers/terminal-dimensions";
import { SessionWorkspace } from "../src/ui/session/workspace/session-workspace";
import { ToolUse } from "../src/components/messages/tool-use";

describe("UI Architecture renderer stress", () => {
  test("does not add one resize listener per historical ToolUse", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <TerminalDimensionsProvider>
          <ThemeProvider>
            <SessionWorkspace
              conversation={(
                <box flexDirection="column">
                  {Array.from({ length: 16 }, (_, index) => (
                    <ToolUse
                      key={`historical-tool-${index}`}
                      view={{
                        toolCallId: `historical-call-${index}`,
                        toolName: "bash",
                        status: "completed",
                        input: { command: `echo ${index}` },
                        output: "ok",
                        durationMs: 25,
                      }}
                    />
                  ))}
                </box>
              )}
              composer={<text>Composer</text>}
              status={<text>Status</text>}
              hints={<text>Hints</text>}
            />
          </ThemeProvider>
        </TerminalDimensionsProvider>,
        { width: 100, height: 30 },
      );
    });
    try {
      await act(async () => { await setup.flush({ maxPasses: 10 }); });
      expect(setup.renderer.listenerCount("resize")).toBeLessThanOrEqual(2);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("repeatedly mounts/destroys ToolUse, Conversation and responsive workspace", async () => {
    const sizes = [[60, 20], [72, 24], [100, 30], [120, 30], [160, 40]] as const;
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const [width, height] = sizes[iteration % sizes.length]!;
      let setup!: Awaited<ReturnType<typeof testRender>>;
      await act(async () => {
        setup = await testRender(
          <TerminalDimensionsProvider>
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
                composer={<text>Composer</text>}
                status={<text>Status</text>}
                hints={<text>Hints</text>}
              />
            </ThemeProvider>
          </TerminalDimensionsProvider>,
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
