import { describe, expect, test } from "bun:test";
import { act, createRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import {
  SessionWorkspace,
  resolveSessionWorkspaceLayout,
} from "../src/ui/session/workspace/session-workspace";
import { TerminalDimensionsProvider } from "../src/providers/terminal-dimensions";

describe("SessionWorkspace layout", () => {
  test("uses explicit width/height classes without an 80% Composer constraint", () => {
    expect(resolveSessionWorkspaceLayout(60, 20)).toMatchObject({
      widthClass: "narrow",
      paddingX: 1,
      activityMaxRows: 4,
    });
    expect(resolveSessionWorkspaceLayout(72, 24).widthClass).toBe("medium");
    expect(resolveSessionWorkspaceLayout(100, 30).widthClass).toBe("medium");
    expect(resolveSessionWorkspaceLayout(120, 30).widthClass).toBe("wide");
    expect(resolveSessionWorkspaceLayout(160, 40).activityMaxRows).toBeGreaterThan(4);
  });

  test("renders Conversation -> Activity -> Composer -> Status -> Hints in every width class", async () => {
    for (const [width, height] of [[60, 20], [72, 24], [100, 30], [120, 30], [160, 40]] as const) {
      let setup!: Awaited<ReturnType<typeof testRender>>;
      await act(async () => {
        setup = await testRender(
          <TerminalDimensionsProvider>
            <SessionWorkspace
              conversation={<text>Conversation sentinel</text>}
              activity={<text>Activity sentinel</text>}
              composer={<text>Composer sentinel</text>}
              status={<text>Status sentinel</text>}
              hints={<text>Hints sentinel</text>}
            />
          </TerminalDimensionsProvider>,
          { width, height },
        );
      });
      try {
        await act(async () => { await setup.flush({ maxPasses: 10 }); });
        const frame = setup.captureCharFrame();
        const order = [
          frame.indexOf("Conversation sentinel"),
          frame.indexOf("Activity sentinel"),
          frame.indexOf("Composer sentinel"),
          frame.indexOf("Status sentinel"),
          frame.indexOf("Hints sentinel"),
        ];
        expect(order.every((index) => index >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
      } finally {
        setup.renderer.destroy();
      }
    }
  });

  test("unrelated Activity updates preserve a manually scrolled Conversation position", async () => {
    const scrollRef = createRef<ScrollBoxRenderable>();
    let bumpActivity!: () => void;

    function Probe() {
      const [tick, setTick] = useState(0);
      bumpActivity = () => setTick((value) => value + 1);
      return (
        <TerminalDimensionsProvider>
          <SessionWorkspace
            conversationScrollRef={scrollRef}
            conversation={(
              <box flexDirection="column">
                {Array.from({ length: 30 }, (_, index) => <text key={index}>Message {index}</text>)}
              </box>
            )}
            activity={<text>Activity {tick}</text>}
            composer={<text>Composer</text>}
            status={<text>Status</text>}
          />
        </TerminalDimensionsProvider>
      );
    }

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<Probe />, { width: 100, height: 18 });
    });
    try {
      await act(async () => { await setup.flush({ maxPasses: 10 }); });
      scrollRef.current?.scrollTo(4);
      const before = scrollRef.current?.scrollTop;
      expect(before).toBe(4);

      await act(async () => {
        bumpActivity();
        await setup.flush({ maxPasses: 10 });
      });
      expect(scrollRef.current?.scrollTop).toBe(before);
    } finally {
      setup.renderer.destroy();
    }
  });
});
