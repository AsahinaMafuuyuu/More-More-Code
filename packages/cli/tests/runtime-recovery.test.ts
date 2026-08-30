import { describe, expect, test } from "bun:test";
import { formatRuntimeRecoveryNotice } from "../src/lib/runtime-recovery";

describe("Runtime recovery notice", () => {
  test("reports incomplete work without suggesting automatic replay", () => {
    const message = formatRuntimeRecoveryNotice({
      sessionId: "session-one",
      recoveredEventOffset: 42,
      replayedEventCount: 3,
      incompleteRunIds: ["run-one"],
      pendingExternalOperations: [{
        id: "step-one",
        eventOffset: 42,
        kind: "tool",
      }],
    });

    expect(message).toContain("1 incomplete run(s)");
    expect(message).toContain("Nothing was replayed");
  });

  test("stays silent when recovery found no unfinished work", () => {
    expect(formatRuntimeRecoveryNotice({
      sessionId: "session-one",
      recoveredEventOffset: 0,
      replayedEventCount: 0,
      incompleteRunIds: [],
      pendingExternalOperations: [],
    })).toBeNull();
  });
});
