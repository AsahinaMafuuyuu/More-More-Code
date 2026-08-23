import { describe, expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeNativeTool } from "../src/lib/local-tools";
import { ProcessSandbox } from "../src/lib/process-sandbox";

const directProcessSandbox = new ProcessSandbox({
  mode: "off",
  network: "inherit",
  environment: "inherit",
  envAllow: [],
});

describe("native shell cancellation", () => {
  test("does not return while a descendant still holds the workspace directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-process-tree-"));
    const controller = new AbortController();

    try {
      const execution = executeNativeTool(
        "bash",
        { command: "bash -c 'trap \"\" HUP TERM; sleep 0.5; printf survived > survivor.txt' & wait" },
        { workspaceRoot: root, signal: controller.signal, processSandbox: directProcessSandbox },
      );
      await Bun.sleep(50);
      controller.abort(new Error("cancelled"));
      await expect(execution).rejects.toThrow("cancelled");

      await Bun.sleep(700);
      await expect(access(path.join(root, "survivor.txt"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
