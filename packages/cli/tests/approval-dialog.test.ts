import { describe, expect, test } from "bun:test";
import { formatApprovalRequirement } from "../src/components/dialogs/approval-dialog";

describe("approval dialog formatting", () => {
  test("shows ephemeral operation value and bounds long text", () => {
    expect(formatApprovalRequirement({
      capability: "process.execute",
      resource: {
        kind: "command",
        value: "git push origin main",
        scope: "workspace",
      },
    })).toContain("git push origin main");

    const formatted = formatApprovalRequirement({
      capability: "filesystem.write",
      resource: {
        kind: "path",
        value: "a".repeat(500),
        scope: "workspace",
      },
    });
    expect(formatted).toContain("filesystem.write · path/workspace");
    expect(formatted.length).toBeLessThan(180);
    expect(formatted.endsWith("…")).toBe(true);
  });
});
