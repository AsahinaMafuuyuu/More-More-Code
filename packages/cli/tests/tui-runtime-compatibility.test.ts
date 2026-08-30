import { describe, expect, test } from "bun:test";
import {
  assertSupportedBunRuntime,
  classifyBunRuntime,
  parseBunVersion,
} from "../src/tui/runtime-compatibility";

describe("TUI Bun runtime compatibility", () => {
  test("parses a semantic Bun version without loading OpenTUI", () => {
    expect(parseBunVersion("1.4.0")).toEqual({ major: 1, minor: 4, patch: 0 });
    expect(parseBunVersion("1.4.12")).toEqual({ major: 1, minor: 4, patch: 12 });
  });

  test("rejects Bun versions below the 1.4 baseline", () => {
    expect(classifyBunRuntime("1.3.14").status).toBe("unsupported");
    expect(classifyBunRuntime("1.3.99").status).toBe("unsupported");
  });

  test("classifies the validated 1.4 family separately from newer runtimes", () => {
    expect(classifyBunRuntime("1.4.0").status).toBe("validated-family");
    expect(classifyBunRuntime("1.4.9").status).toBe("validated-family");
    expect(classifyBunRuntime("1.5.0").status).toBe("newer-unvalidated");
    expect(classifyBunRuntime("2.0.0").status).toBe("newer-unvalidated");
  });

  test("fails closed for malformed runtime versions", () => {
    expect(() => classifyBunRuntime("1.4")).toThrow(/valid Bun version/i);
    expect(() => classifyBunRuntime("native")).toThrow(/valid Bun version/i);
  });

  test("startup guard rejects unsupported Bun with an actionable upgrade message", () => {
    expect(() => assertSupportedBunRuntime("1.3.14", "old-revision")).toThrow(
      /Bun 1\.4\.0 or newer.*1\.3\.14.*upgrade/i,
    );
    expect(() => assertSupportedBunRuntime("1.4.0", "validated")).not.toThrow();
  });
});
