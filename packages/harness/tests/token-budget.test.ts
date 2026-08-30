import { describe, expect, test } from "bun:test";
import { createExactTokenCounter, createHeuristicTokenCounter } from "../src";

describe("token counters", () => {
  test("marks provider-calibrated counters as estimated", () => {
    const counter = createHeuristicTokenCounter({
      id: "test-provider",
      latinCharsPerToken: 4,
      cjkCharsPerToken: 1,
      structuralOverheadTokens: 2,
    });

    expect(counter.accuracy).toBe("estimated");
    expect(counter.countText("abcdefgh")).toBe(2);
    expect(counter.countText("你好世界")).toBe(4);
    expect(counter.countPayload({ text: "abcdefgh" })).toBeGreaterThan(2);
  });

  test("supports exact tokenizer adapters without changing the budgeting API", () => {
    const counter = createExactTokenCounter({
      id: "exact-test",
      countText: (text) => text.split(/\s+/).filter(Boolean).length,
    });

    expect(counter.accuracy).toBe("exact");
    expect(counter.countText("one two three")).toBe(3);
    expect(counter.countPayload("one two")).toBe(2);
  });
});
