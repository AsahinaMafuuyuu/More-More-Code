import { describe, expect, test } from "bun:test";
import {
  CTRL_C_EXIT_WINDOW_MS,
  resolveCtrlCExit,
} from "../src/lib/ctrl-c-exit-guard";

describe("Ctrl+C exit guard", () => {
  test("keeps the first press available for copy and exits on a second press inside the window", () => {
    const first = resolveCtrlCExit(null, 1000);
    expect(first.shouldExit).toBe(false);
    expect(first.nextPressedAt).toBe(1000);

    const second = resolveCtrlCExit(first.nextPressedAt, 1000 + CTRL_C_EXIT_WINDOW_MS - 1);
    expect(second.shouldExit).toBe(true);
    expect(second.nextPressedAt).toBeNull();
  });

  test("expires the pending exit gesture after the debounce window", () => {
    const first = resolveCtrlCExit(null, 1000);
    const expired = resolveCtrlCExit(
      first.nextPressedAt,
      1000 + CTRL_C_EXIT_WINDOW_MS + 1,
    );

    expect(expired.shouldExit).toBe(false);
    expect(expired.nextPressedAt).toBe(1000 + CTRL_C_EXIT_WINDOW_MS + 1);
  });
});
