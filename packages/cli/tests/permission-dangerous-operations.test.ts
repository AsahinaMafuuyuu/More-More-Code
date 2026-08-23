import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { mergeAgentConfig } from "../src/lib/agent-config";
import { createEffectivePermissionPolicy } from "../src/lib/permission-policy";
import { ToolRegistry } from "../src/lib/tool-registry";
import { ToolRuntime, type ToolRuntimeObserver } from "../src/lib/tool-runtime";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })));
});

async function tempRoot(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(path);
  return path;
}

function toolContext(workspaceRoot: string, toolCallId: string) {
  return {
    sessionId: "session-dangerous",
    runId: "run-dangerous",
    turnId: "turn-dangerous",
    stepId: `step-${toolCallId}`,
    toolCallId,
    workspaceRoot,
    mode: "BUILD" as const,
    signal: new AbortController().signal,
  };
}

function fakeRuntime(options: {
  registry: ToolRegistry;
  permissionPolicy?: ConstructorParameters<typeof ToolRuntime>[0]["permissionPolicy"];
  observer?: ToolRuntimeObserver;
  onExecute: () => void;
}) {
  return new ToolRuntime({
    registry: options.registry,
    permissionPolicy: options.permissionPolicy
      ?? createEffectivePermissionPolicy(mergeAgentConfig({}, {})),
    executors: [{
      source: "native",
      async execute() {
        options.onExecute();
        return null;
      },
    }],
    observer: options.observer,
  });
}

describe("dangerous permission operations", () => {
  test("blocks representative composed git-push command strings before execution", async () => {
    const config = mergeAgentConfig({}, {
      permissions: {
        rules: [{
          effect: "deny",
          capabilities: ["process.execute"],
          commands: ["*git*push*"],
          scopes: ["workspace"],
        }],
      },
    });
    const registry = new ToolRegistry(config);
    let executorCalls = 0;
    const runtime = fakeRuntime({
      registry,
      permissionPolicy: createEffectivePermissionPolicy(config),
      onExecute: () => { executorCalls += 1; },
    });

    for (const [index, command] of [
      "git push origin main",
      "git   push --force origin main",
      "echo inspected && git push origin main",
    ].entries()) {
      const result = await runtime.run({
        toolName: "bash",
        input: { command },
        context: toolContext(process.cwd(), `command-${index}`),
      });
      expect(result.status).toBe("denied");
    }

    expect(executorCalls).toBe(0);
  });

  test("one blocked capability prevents multi-capability tools from invoking an executor", async () => {
    const config = mergeAgentConfig({}, {
      permissions: {
        rules: [
          {
            effect: "deny",
            capabilities: ["filesystem.write"],
            paths: ["**"],
            scopes: ["workspace"],
          },
          {
            effect: "deny",
            capabilities: ["process.execute"],
            scopes: ["workspace"],
          },
        ],
      },
    });
    const registry = new ToolRegistry(config);
    let executorCalls = 0;
    const runtime = fakeRuntime({
      registry,
      permissionPolicy: createEffectivePermissionPolicy(config),
      onExecute: () => { executorCalls += 1; },
    });

    const edit = await runtime.run({
      toolName: "editFile",
      input: { path: "README.md", oldString: "a", newString: "b" },
      context: toolContext(process.cwd(), "edit"),
    });
    const grep = await runtime.run({
      toolName: "grep",
      input: { path: ".", pattern: "permission" },
      context: toolContext(process.cwd(), "grep"),
    });

    expect(edit.status).toBe("denied");
    expect(grep.status).toBe("denied");
    expect(executorCalls).toBe(0);
  });

  test("nested junction and absolute outside paths are denied before executor invocation", async () => {
    const workspace = await tempRoot("more-more-code-danger-workspace-");
    const outside = await tempRoot("more-more-code-danger-outside-");
    const safeDirectory = join(workspace, "safe");
    await mkdir(safeDirectory, { recursive: true });
    await symlink(
      outside,
      join(safeDirectory, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const config = mergeAgentConfig({}, {});
    const registry = new ToolRegistry(config);
    let executorCalls = 0;
    const runtime = fakeRuntime({
      registry,
      permissionPolicy: createEffectivePermissionPolicy(config),
      onExecute: () => { executorCalls += 1; },
    });

    const linked = await runtime.run({
      toolName: "writeFile",
      input: { path: "safe/linked/new.txt", content: "blocked" },
      context: toolContext(workspace, "linked"),
    });
    const absolute = await runtime.run({
      toolName: "writeFile",
      input: { path: join(outside, "absolute.txt"), content: "blocked" },
      context: toolContext(workspace, "absolute"),
    });

    expect(linked.status).toBe("denied");
    expect(absolute.status).toBe("denied");
    expect(executorCalls).toBe(0);
  });

  test("permission observer persistence failures fail closed at request and decision boundaries", async () => {
    const config = mergeAgentConfig({}, {});
    const registry = new ToolRegistry(config);
    let executorCalls = 0;

    for (const failAt of ["permission_requested", "permission_decided"] as const) {
      const runtime = fakeRuntime({
        registry,
        permissionPolicy: createEffectivePermissionPolicy(config),
        onExecute: () => { executorCalls += 1; },
        observer(event) {
          if (event.type === failAt) throw new Error(`observer failed at ${failAt}`);
        },
      });

      await expect(runtime.run({
        toolName: "readFile",
        input: { path: "README.md" },
        context: toolContext(process.cwd(), failAt),
      })).rejects.toThrow(`observer failed at ${failAt}`);
    }

    expect(executorCalls).toBe(0);
  });

  test("a throwing permission policy fails closed before executor invocation", async () => {
    const config = mergeAgentConfig({}, {});
    const registry = new ToolRegistry(config);
    let executorCalls = 0;
    const runtime = fakeRuntime({
      registry,
      permissionPolicy: {
        decide() {
          throw new Error("permission policy unavailable");
        },
      },
      onExecute: () => { executorCalls += 1; },
    });

    await expect(runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: toolContext(process.cwd(), "policy-throw"),
    })).rejects.toThrow("permission policy unavailable");
    expect(executorCalls).toBe(0);
  });
});
