import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { act, useEffect, useRef } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { testRender } from "@opentui/react/test-utils";
import { RootLayout } from "../src/layouts/root-layout";
import {
  bootstrapAgentEnvironment,
  getAgentEnvironment,
} from "../src/lib/agent-environment";
import { useSessionCommandHandler } from "../src/ui/session/command/use-session-command-handler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

function OpenConfigCommand() {
  const execute = useSessionCommandHandler({});
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void execute({
      type: "command",
      commandName: "config",
      commandValue: "/config",
    });
  }, [execute]);

  return <text>config route</text>;
}

async function renderConfigRoute() {
  const root = await mkdtemp(path.join(tmpdir(), "more-more-code-config-dialog-"));
  temporaryDirectories.push(root);
  const globalHome = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  await bootstrapAgentEnvironment({ globalHome, workspaceRoot });

  const router = createMemoryRouter([
    {
      path: "/",
      element: <RootLayout />,
      errorElement: <box><text>route error</text></box>,
      children: [{ index: true, element: <OpenConfigCommand /> }],
    },
  ], { initialEntries: ["/"] });

  return {
    root,
    workspaceRoot,
    setup: await testRender(<RouterProvider router={router} />, {
      width: 100,
      height: 64,
    }),
  };
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.flush({ maxPasses: 10 });
  });
}

async function pressEnter(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    setup.mockInput.pressEnter();
  });
  await flush(setup);
}

async function clickLineContaining(
  setup: Awaited<ReturnType<typeof testRender>>,
  label: string,
) {
  const lines = setup.captureCharFrame().split("\n");
  const y = lines.findIndex((line) => line.includes(label));
  if (y < 0) throw new Error(`Cannot find rendered config row ${JSON.stringify(label)}`);
  const x = Math.max(0, lines[y]!.indexOf(label));
  await act(async () => {
    await setup.mockMouse.click(x, y);
    await setup.flush({ maxPasses: 10 });
  });
}

describe("/config Tool execution settings", () => {
  test("changes mode and max concurrency through the typed project config authority", async () => {
    const fixture = await renderConfigRoute();
    try {
      await flush(fixture.setup);
      expect(fixture.setup.captureCharFrame()).toContain("Configure tool execution");
      expect(fixture.setup.captureCharFrame()).toContain("tool execution: serial");

      await pressEnter(fixture.setup);
      expect(fixture.setup.captureCharFrame()).toContain("Mode: parallel");
      expect(getAgentEnvironment().config.resolved.tools.execution.maxConcurrency).toBe(4);

      await clickLineContaining(fixture.setup, "Mode: parallel");
      expect(getAgentEnvironment().config.resolved.tools.execution.mode).toBe("parallel");
      expect(fixture.setup.captureCharFrame()).toContain("tool execution: parallel · max concurrency 4");

      await clickLineContaining(fixture.setup, "Max concurrency: 3");
      expect(getAgentEnvironment().config.resolved.tools.execution).toEqual({
        mode: "parallel",
        maxConcurrency: 3,
      });

      const projectConfig = JSON.parse(await readFile(
        path.join(fixture.workspaceRoot, ".more-more-code", "config.json"),
        "utf8",
      ));
      expect(projectConfig.tools.execution).toEqual({
        mode: "parallel",
        maxConcurrency: 3,
      });
    } finally {
      fixture.setup.renderer.destroy();
    }
  });
});
