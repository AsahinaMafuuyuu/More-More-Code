import { describe, expect, test } from "bun:test";
import { isApprovalResolution } from "../src";

describe("approval contracts", () => {
  test("accepts only explicit one-time allow or deny resolutions", () => {
    expect(isApprovalResolution({ decision: "allow" })).toBe(true);
    expect(isApprovalResolution({ decision: "deny" })).toBe(true);
    expect(isApprovalResolution({ decision: "ask" })).toBe(false);
    expect(isApprovalResolution({ decision: "allow", persistent: true })).toBe(false);
  });
});
