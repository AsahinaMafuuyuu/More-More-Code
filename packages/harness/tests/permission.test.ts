import { describe, expect, test } from "bun:test";
import {
  DefaultPermissionPolicy,
  RulePermissionPolicy,
  canExecute,
} from "../src/permission";

describe("permission policy", () => {
  test("uses one allow/deny/ask decision contract", () => {
    const policy = new DefaultPermissionPolicy(new Set(["filesystem.write"]));

    expect(policy.decide({ capability: "filesystem.read" })).toEqual({
      effect: "allow",
      policy: "default",
    });
    expect(policy.decide({ capability: "filesystem.write" })).toEqual({
      effect: "deny",
      policy: "default",
    });
    expect(canExecute(policy.decide({ capability: "filesystem.read" }))).toBe(true);
    expect(canExecute("ask")).toBe(false);
  });

  test("matches capability, command, path, resource and scope rules", () => {
    const policy = new RulePermissionPolicy({
      defaultEffect: "allow",
      rules: [
        {
          effect: "deny",
          capabilities: ["process.*"],
          commands: ["rm *", "git push*"],
          scopes: ["workspace"],
          policy: "configured",
        },
        {
          effect: "ask",
          capabilities: ["filesystem.write"],
          paths: ["docs/**"],
          policy: "configured",
        },
        {
          effect: "deny",
          resources: ["skill:private-*"],
          scopes: ["agent-config"],
          policy: "configured",
        },
      ],
    });

    expect(policy.decide({
      capability: "process.execute",
      resource: { kind: "command", value: "rm -rf build", scope: "workspace" },
    }).effect).toBe("deny");
    expect(policy.decide({
      capability: "filesystem.write",
      resource: { kind: "path", value: "docs\\guide.md", scope: "workspace" },
    }).effect).toBe("ask");
    expect(policy.decide({
      capability: "agent.skill.read",
      resource: { kind: "resource", value: "skill:private-release", scope: "agent-config" },
    }).effect).toBe("deny");
  });

  test("lets later configured rules override code defaults deterministically", () => {
    const policy = new RulePermissionPolicy({
      defaultEffect: "deny",
      rules: [
        {
          effect: "allow",
          capabilities: ["filesystem.read"],
          scopes: ["workspace"],
          policy: "default",
        },
        {
          effect: "ask",
          capabilities: ["filesystem.read"],
          paths: ["secrets/**"],
          policy: "configured",
          reason: "Explicit approval is required for protected files",
        },
      ],
    });

    expect(policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "README.md", scope: "workspace" },
    })).toEqual({ effect: "allow", policy: "default" });
    expect(policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "secrets/key.txt", scope: "workspace" },
    })).toEqual({
      effect: "ask",
      policy: "configured",
      reason: "Explicit approval is required for protected files",
    });
  });

  test("uses segment-aware path globs and configurable path casing", () => {
    const policy = new RulePermissionPolicy({
      defaultEffect: "deny",
      rules: [{
        effect: "allow",
        paths: ["src/*", "Secrets/**"],
        policy: "configured",
      }],
    });

    expect(policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "src/index.ts", scope: "workspace" },
    }).effect).toBe("allow");
    expect(policy.decide({
      capability: "filesystem.read",
      resource: { kind: "path", value: "src/deep/index.ts", scope: "workspace" },
    }).effect).toBe("deny");
    expect(policy.decide({
      capability: "filesystem.read",
      resource: {
        kind: "path",
        value: "secrets/deep/key.txt",
        scope: "workspace",
        caseSensitive: false,
      },
    }).effect).toBe("allow");
  });
});
