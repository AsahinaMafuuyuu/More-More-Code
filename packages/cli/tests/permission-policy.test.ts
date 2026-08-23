import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "node:path";
import { mergeAgentConfig } from "../src/lib/agent-config";
import { executeNativeTool } from "../src/lib/local-tools";
import { createEffectivePermissionPolicy } from "../src/lib/permission-policy";
import { ProcessSandbox } from "../src/lib/process-sandbox";
import { ToolRegistry } from "../src/lib/tool-registry";
import { ToolRuntime } from "../src/lib/tool-runtime";

const directProcessSandbox = new ProcessSandbox({
  mode: "off",
  network: "inherit",
  environment: "inherit",
  envAllow: [],
});

const allowApprovalBroker = {
  async request() {
    return { decision: "allow" as const };
  },
};

describe("permission configuration and policy", () => {
  test("merges global rules before project rules so project overrides win", async () => {
    const resolved = mergeAgentConfig(
      {
        permissions: {
          default: "deny",
          rules: [{
            effect: "deny",
            capabilities: ["filesystem.read"],
            paths: ["shared/**"],
            scopes: ["workspace"],
          }],
        },
      },
      {
        permissions: {
          default: "allow",
          rules: [{
            effect: "allow",
            capabilities: ["filesystem.read"],
            paths: ["shared/**"],
            scopes: ["workspace"],
          }],
        },
      },
    );

    expect(resolved.permissions.rules.map((rule) => rule.effect)).toEqual([
      "deny",
      "deny",
      "allow",
      "allow",
    ]);

    const policy = createEffectivePermissionPolicy(resolved);
    expect(await policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "shared/file.txt", scope: "workspace" },
    })).toEqual({ effect: "allow", policy: "configured" });
    expect(await policy.decide({
      capability: "filesystem.write",
      resource: { kind: "path", value: "other/file.txt", scope: "workspace" },
    })).toEqual({ effect: "allow", policy: "configured" });
  });

  test("matches configured command, path, resource and scope constraints", async () => {
    const resolved = mergeAgentConfig({}, {
      permissions: {
        default: "deny",
        rules: [
          {
            effect: "allow",
            capabilities: ["process.execute"],
            commands: ["git status*"],
            scopes: ["workspace"],
          },
          {
            effect: "allow",
            capabilities: ["filesystem.read"],
            paths: ["src/**"],
            scopes: ["workspace"],
          },
          {
            effect: "allow",
            capabilities: ["agent.skill.read"],
            resources: ["skill:trusted-*"],
            scopes: ["agent-config"],
          },
        ],
      },
    });
    const policy = createEffectivePermissionPolicy(resolved);

    expect((await policy.decide({
      capability: "process.execute",
      resource: { kind: "command", value: "git status --short", scope: "workspace" },
    })).effect).toBe("allow");
    expect((await policy.decide({
      capability: "process.execute",
      resource: { kind: "command", value: "git push", scope: "workspace" },
    })).effect).toBe("deny");
    expect((await policy.decide({
      capability: "process.execute",
      resource: { kind: "command", value: "git status", scope: "external" },
    })).effect).toBe("deny");

    expect((await policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "src/index.ts", scope: "workspace" },
    })).effect).toBe("allow");
    expect((await policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "docs/index.ts", scope: "workspace" },
    })).effect).toBe("deny");

    expect((await policy.decide({
      capability: "agent.skill.read",
      resource: { kind: "resource", value: "skill:trusted-review", scope: "agent-config" },
    })).effect).toBe("allow");
    expect((await policy.decide({
      capability: "agent.skill.read",
      resource: { kind: "resource", value: "skill:private-review", scope: "agent-config" },
    })).effect).toBe("deny");
  });

  test("keeps outside-workspace containment non-overridable", async () => {
    const policy = createEffectivePermissionPolicy(mergeAgentConfig({}, {
      permissions: {
        default: "allow",
        rules: [{
          effect: "allow",
          capabilities: ["filesystem.*"],
          scopes: ["outside-workspace"],
        }],
      },
    }));

    expect(await policy.decide({
      capability: "filesystem.read",
      resource: {
        kind: "path",
        value: "C:/outside/secret.txt",
        scope: "outside-workspace",
        caseSensitive: false,
      },
    })).toEqual({
      effect: "deny",
      policy: "default",
      reason: "Tool resources outside the workspace are not allowed",
    });
  });
});

describe("ToolRegistry permission request classification", () => {
  const registry = new ToolRegistry(mergeAgentConfig({}, {}));
  const workspaceRoot = process.cwd();

  function tool(name: string) {
    const definition = registry.getToolDefinition(name, "BUILD");
    if (!definition) throw new Error(`Expected native BUILD tool ${name}`);
    return definition;
  }

  test("classifies workspace and outside-workspace path requests", async () => {
    const inside = await registry.getPermissionRequests(
      tool("readFile"),
      { path: "src/index.ts" },
      workspaceRoot,
    );
    const outside = await registry.getPermissionRequests(
      tool("readFile"),
      { path: "../secrets.txt" },
      workspaceRoot,
    );

    expect(inside).toEqual([{
      capability: "filesystem.read",
      resource: {
        kind: "path",
        value: "src/index.ts",
        scope: "workspace",
        caseSensitive: process.platform !== "win32",
      },
    }]);
    expect(outside[0]?.capability).toBe("filesystem.read");
    expect(outside[0]?.resource).toEqual({
      kind: "path",
      value: resolve(workspaceRoot, "../secrets.txt").replace(/\\/g, "/"),
      scope: "outside-workspace",
      caseSensitive: process.platform !== "win32",
    });
  });

  test("classifies bash commands as workspace-scoped command resources", async () => {
    expect(await registry.getPermissionRequests(
      tool("bash"),
      { command: "git status --short", description: "inspect" },
      workspaceRoot,
    )).toEqual([{
      capability: "process.execute",
      resource: {
        kind: "command",
        value: "git status --short",
        scope: "workspace",
      },
    }]);
  });

  test("classifies loadSkill as an agent-config resource", async () => {
    expect(await registry.getPermissionRequests(
      tool("loadSkill"),
      { name: "code-review" },
      workspaceRoot,
    )).toEqual([{
      capability: "agent.skill.read",
      resource: {
        kind: "resource",
        value: "skill:code-review",
        scope: "agent-config",
      },
    }]);
  });

  test("classifies linked external directories as outside and blocks file operations", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "more-more-code-policy-workspace-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "more-more-code-policy-outside-"));
    const linkedDirectory = join(workspace, "linked");
    const secretPath = join(outsideRoot, "secret.txt");
    await mkdir(workspace, { recursive: true });
    await writeFile(secretPath, "secret", "utf8");
    await symlink(
      outsideRoot,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    try {
      const requests = await registry.getPermissionRequests(
        tool("readFile"),
        { path: "linked/secret.txt" },
        workspace,
      );
      expect(requests[0]?.resource?.scope).toBe("outside-workspace");

      const context = {
        workspaceRoot: workspace,
        signal: new AbortController().signal,
        processSandbox: directProcessSandbox,
      };
      await expect(executeNativeTool(
        "readFile",
        { path: "linked/secret.txt" },
        context,
      )).rejects.toThrow("outside the project directory");
      await expect(executeNativeTool(
        "writeFile",
        { path: "linked/new.txt", content: "escaped" },
        context,
      )).rejects.toThrow("outside the project directory");
      await expect(executeNativeTool(
        "editFile",
        { path: "linked/secret.txt", oldString: "secret", newString: "escaped" },
        context,
      )).rejects.toThrow("outside the project directory");

      expect(await readFile(secretPath, "utf8")).toBe("secret");
      await expect(readFile(join(outsideRoot, "new.txt"), "utf8")).rejects.toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("ToolRuntime permission enforcement", () => {
  test("blocks configured command rules before executor invocation", async () => {
    const resolved = mergeAgentConfig({}, {
      permissions: {
        rules: [{
          effect: "deny",
          capabilities: ["process.execute"],
          commands: ["rm *"],
          scopes: ["workspace"],
        }],
      },
    });
    const registry = new ToolRegistry(resolved);
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: createEffectivePermissionPolicy(resolved),
      approvalBroker: allowApprovalBroker,
      executors: [{
        source: "native",
        async execute() {
          executorCalls += 1;
          return null;
        },
      }],
    });

    const result = await runtime.run({
      toolName: "bash",
      input: { command: "rm -rf build" },
      context: {
        sessionId: "session-one",
        runId: "run-one",
        turnId: "turn-one",
        stepId: "step-one",
        toolCallId: "tool-one",
        workspaceRoot: process.cwd(),
        mode: "BUILD",
        signal: new AbortController().signal,
      },
    });

    expect(result.status).toBe("denied");
    expect(executorCalls).toBe(0);
  });

  test("fails closed when a policy adapter returns an invalid decision", async () => {
    const resolved = mergeAgentConfig({}, {});
    const registry = new ToolRegistry(resolved);
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: {
        decide: () => ({ effect: "unexpected", policy: "default" }) as never,
      },
      approvalBroker: allowApprovalBroker,
      executors: [{
        source: "native",
        async execute() {
          executorCalls += 1;
          return null;
        },
      }],
    });

    await expect(runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: {
        sessionId: "session-one",
        runId: "run-one",
        turnId: "turn-one",
        stepId: "step-one",
        toolCallId: "tool-one",
        workspaceRoot: process.cwd(),
        mode: "BUILD",
        signal: new AbortController().signal,
      },
    })).rejects.toThrow("invalid decision");
    expect(executorCalls).toBe(0);
  });
});
