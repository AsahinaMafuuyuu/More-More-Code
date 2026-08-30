import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadAgentConfig,
  mergeAgentConfig,
  saveAgentConfigToolExecution,
} from "../src/lib/agent-config";
import { ToolRegistry } from "../src/lib/tool-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("Agent Config Tool execution", () => {
  test("omitted execution config resolves to serial with bounded default concurrency", () => {
    const resolved = mergeAgentConfig({}, {});
    expect(resolved.tools.execution).toEqual({
      mode: "serial",
      maxConcurrency: 4,
    });
  });

  test("project execution config overrides global values field-by-field", () => {
    const resolved = mergeAgentConfig(
      {
        tools: {
          execution: {
            mode: "parallel",
            maxConcurrency: 8,
          },
        },
      },
      {
        tools: {
          execution: {
            maxConcurrency: 3,
          },
        },
      },
    );

    expect(resolved.tools.execution).toEqual({
      mode: "parallel",
      maxConcurrency: 3,
    });
  });

  test("invalid execution mode and concurrency fail config loading", async () => {
    const root = await mkdtemp(join(tmpdir(), "mmc-config-execution-"));
    temporaryDirectories.push(root);
    const globalHome = join(root, "home");
    const workspaceRoot = join(root, "workspace");
    const globalDir = join(globalHome, ".more-more-code");
    const projectDir = join(workspaceRoot, ".more-more-code");
    await Promise.all([
      mkdir(globalDir, { recursive: true }),
      mkdir(projectDir, { recursive: true }),
    ]);
    await writeFile(join(globalDir, "config.json"), JSON.stringify({
      tools: { execution: { mode: "unsafe-fast", maxConcurrency: 4 } },
    }));
    await writeFile(join(projectDir, "config.json"), "{}");

    await expect(loadAgentConfig({
      globalHome,
      workspaceRoot,
      ensureLayout: false,
    })).rejects.toThrow("Invalid MORE-MORE-CODE config");

    await writeFile(join(globalDir, "config.json"), JSON.stringify({
      tools: { execution: { mode: "parallel", maxConcurrency: 0 } },
    }));
    await expect(loadAgentConfig({
      globalHome,
      workspaceRoot,
      ensureLayout: false,
    })).rejects.toThrow("Invalid MORE-MORE-CODE config");

    await writeFile(join(globalDir, "config.json"), JSON.stringify({
      tools: { execution: { mode: "parallel", maxConcurrency: 17 } },
    }));
    await expect(loadAgentConfig({
      globalHome,
      workspaceRoot,
      ensureLayout: false,
    })).rejects.toThrow("Invalid MORE-MORE-CODE config");
  });

  test("persists project Tool execution patches without replacing sibling Tool config", async () => {
    const root = await mkdtemp(join(tmpdir(), "mmc-config-execution-save-"));
    temporaryDirectories.push(root);
    const globalHome = join(root, "home");
    const workspaceRoot = join(root, "workspace");
    const projectDir = join(workspaceRoot, ".more-more-code");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "config.json"), JSON.stringify({
      tools: {
        native: { enabled: false },
        execution: { mode: "serial", maxConcurrency: 2 },
        mcp: {
          servers: {
            docs: {
              enabled: true,
              transport: "http",
              url: "https://mcp.example.test",
            },
          },
        },
      },
    }));

    const modeUpdate = await saveAgentConfigToolExecution({
      execution: { mode: "parallel" },
      workspaceRoot,
      globalHome,
    });
    expect(modeUpdate.resolved.tools.execution).toEqual({
      mode: "parallel",
      maxConcurrency: 2,
    });

    const concurrencyUpdate = await saveAgentConfigToolExecution({
      execution: { maxConcurrency: 6 },
      workspaceRoot,
      globalHome,
    });
    expect(concurrencyUpdate.resolved.tools.execution).toEqual({
      mode: "parallel",
      maxConcurrency: 6,
    });

    const persisted = JSON.parse(await readFile(join(projectDir, "config.json"), "utf8"));
    expect(persisted.tools.native).toEqual({ enabled: false });
    expect(persisted.tools.execution).toEqual({ mode: "parallel", maxConcurrency: 6 });
    expect(persisted.tools.mcp.servers.docs).toEqual({
      enabled: true,
      transport: "http",
      url: "https://mcp.example.test",
    });
  });

  test("rejects empty or out-of-range Tool execution writes before persistence", async () => {
    const root = await mkdtemp(join(tmpdir(), "mmc-config-execution-invalid-save-"));
    temporaryDirectories.push(root);
    const globalHome = join(root, "home");
    const workspaceRoot = join(root, "workspace");

    await expect(saveAgentConfigToolExecution({
      execution: {},
      workspaceRoot,
      globalHome,
    })).rejects.toThrow();
    await expect(saveAgentConfigToolExecution({
      execution: { maxConcurrency: 17 },
      workspaceRoot,
      globalHome,
    })).rejects.toThrow();
  });

  test("only explicitly read-only native tools are parallel-safe", () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    expect(registry.getToolDefinition("readFile", "BUILD")?.executionSafety).toEqual({
      parallelSafe: true,
      effect: "read",
    });
    expect(registry.getToolDefinition("grep", "BUILD")?.executionSafety).toEqual({
      parallelSafe: true,
      effect: "read",
    });
    expect(registry.getToolDefinition("writeFile", "BUILD")?.executionSafety).toEqual({
      parallelSafe: false,
      effect: "write",
    });
    expect(registry.getToolDefinition("bash", "BUILD")?.executionSafety).toEqual({
      parallelSafe: false,
      effect: "process",
    });
  });
});
