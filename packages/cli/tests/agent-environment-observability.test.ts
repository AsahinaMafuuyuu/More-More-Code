import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bootstrapAgentEnvironment,
  reloadAgentEnvironment,
  subscribeAgentEnvironment,
} from "../src/lib/agent-environment";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Agent environment observability invalidation", () => {
  test("publishes bootstrap/reload so Context observability can recompute ToolSet and Agent sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mmc-observability-env-"));
    roots.push(root);
    await bootstrapAgentEnvironment({
      globalHome: path.join(root, "home"),
      workspaceRoot: path.join(root, "workspace"),
    });
    let emissions = 0;
    const unsubscribe = subscribeAgentEnvironment(() => { emissions += 1; });
    try {
      expect(emissions).toBe(1);
      await reloadAgentEnvironment();
      expect(emissions).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});
