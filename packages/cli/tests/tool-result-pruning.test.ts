import { describe, expect, test } from "bun:test";
import {
  createHeuristicTokenCounter,
  type ModelContextProfile,
} from "@more-more-code/harness";
import { projectToolResultWorkingSet } from "../src/lib/tool-result-pruning";
import type { Message } from "../src/lib/chat-types";

const profile: ModelContextProfile = {
  contextWindowTokens: 2_000,
  reservedOutputTokens: 0,
  safetyMarginTokens: 0,
  retainedTailTurns: 2,
  maxSummaryTokens: 128,
  toolResultWorkingSetRatio: 0.25,
  toolResultFullThresholdRatio: 0.06,
  toolResultReferenceRatio: 0.006,
  tokenCounter: createHeuristicTokenCounter({
    id: "tool-pruning-test",
    latinCharsPerToken: 4,
    cjkCharsPerToken: 1.5,
    structuralOverheadTokens: 1,
  }),
};

function toolMessage(input: {
  id: string;
  toolName: string;
  toolCallId: string;
  toolInput?: unknown;
  output: unknown;
}): Message {
  return {
    id: input.id,
    role: "assistant",
    parts: [{
      type: `tool-${input.toolName}`,
      toolCallId: input.toolCallId,
      state: "output-available",
      input: input.toolInput ?? {},
      output: input.output,
    } as never],
  };
}

function projectionEnvelope(message: Message) {
  const part = message.parts[0] as unknown as { output?: unknown };
  return part.output as {
    type: string;
    mode: string;
    source: string;
    content: string;
  };
}

function freshTail(): Message {
  return toolMessage({
    id: "fresh-message",
    toolName: "listDirectory",
    toolCallId: "fresh-call",
    output: { entries: [{ name: "src", type: "directory" }] },
  });
}

describe("Tool Result pruning", () => {
  test("keeps an oversized Tool Result model projection stable as newer results are appended", () => {
    const oversized = toolMessage({
      id: "stable-message",
      toolName: "bash",
      toolCallId: "stable-call",
      toolInput: { command: "bun test" },
      output: {
        stdout: `${"PASS stable cache prefix\n".repeat(700)}FAIL retain this diagnostic\n`,
        stderr: "",
        exitCode: 1,
      },
    });

    const first = projectToolResultWorkingSet({
      messages: [oversized],
      profile,
      inputBudgetTokens: 10_000,
    });
    const later = projectToolResultWorkingSet({
      messages: [oversized, freshTail()],
      profile,
      inputBudgetTokens: 10_000,
      // A durable Session lookup may become available after first exposure;
      // that must not rewrite model-visible history.
      resolveSourceEntryId: () => "entry-stable-call",
    });

    const firstEnvelope = projectionEnvelope(first.messages[0]!);
    const laterEnvelope = projectionEnvelope(later.messages[0]!);
    expect(firstEnvelope.type).toBe("more-more-code.tool-result-projection");
    expect(laterEnvelope).toEqual(firstEnvelope);
    expect(firstEnvelope.source).toBe("tool-call:stable-call");
  });

  test("keeps a small newest result full and bounds an older oversized shell result without mutating canonical messages", () => {
    const old = toolMessage({
      id: "shell-message",
      toolName: "bash",
      toolCallId: "shell-call",
      toolInput: { command: "git diff --check" },
      output: {
        stdout: `${"noise line\n".repeat(500)}ERROR build failed at module A\n${"tail line\n".repeat(80)}`,
        stderr: "fatal: compilation failed\n",
        exitCode: 1,
      },
    });
    const messages = [old, freshTail()];
    const canonical = structuredClone(messages);
    const projected = projectToolResultWorkingSet({
      messages,
      profile,
      inputBudgetTokens: 10_000,
      resolveSourceEntryId: (toolCallId) => `entry-${toolCallId}`,
    });

    expect(projected.stats.prunedResults).toBe(1);
    expect(projected.messages[1]).toEqual(messages[1]);
    const envelope = projectionEnvelope(projected.messages[0]!);
    expect(envelope.type).toBe("more-more-code.tool-result-projection");
    expect(envelope.source).toBe("tool-call:shell-call");
    expect(envelope.content).toContain("ERROR build failed");
    expect(envelope.content).toContain("fatal: compilation failed");
    expect(messages).toEqual(canonical);
  });

  test("test/build projection prioritizes failure and warning lines", () => {
    const projected = projectToolResultWorkingSet({
      messages: [
        toolMessage({
          id: "test-message",
          toolName: "bash",
          toolCallId: "test-call",
          toolInput: { command: "bun test" },
          output: {
            stdout: `${"PASS routine\n".repeat(500)}FAIL context.test.ts\nwarning: snapshot mismatch\n`,
            stderr: "Error: expected 3, received 4",
            exitCode: 1,
          },
        }),
        freshTail(),
      ],
      profile,
      inputBudgetTokens: 10_000,
    });

    const envelope = projectionEnvelope(projected.messages[0]!);
    expect(envelope.mode).toBe("summary");
    expect(envelope.content).toMatch(/FAIL context\.test\.ts|Error: expected 3/);
  });

  test("grep projection preserves bounded file and line locations", () => {
    const matches = Array.from({ length: 80 }, (_, index) => ({
      file: `src/file-${index}.ts`,
      line: index + 10,
      content: `match-${index} ${"x".repeat(30)}`,
    }));
    const projected = projectToolResultWorkingSet({
      messages: [
        toolMessage({
          id: "grep-message",
          toolName: "grep",
          toolCallId: "grep-call",
          toolInput: { pattern: "match", path: "." },
          output: { matches },
        }),
        freshTail(),
      ],
      profile,
      inputBudgetTokens: 10_000,
    });

    const envelope = projectionEnvelope(projected.messages[0]!);
    expect(envelope.content).toContain("src/file-0.ts:10: match-0");
    expect(envelope.content).not.toContain("src/file-79.ts:89: match-79");
  });

  test("file projection keeps useful head and tail instead of the whole body", () => {
    const content = Array.from({ length: 1_000 }, (_, index) => `line-${index} ${"x".repeat(20)}`).join("\n");
    const projected = projectToolResultWorkingSet({
      messages: [
        toolMessage({
          id: "file-message",
          toolName: "readFile",
          toolCallId: "file-call",
          toolInput: { path: "src/large.ts" },
          output: { content },
        }),
        freshTail(),
      ],
      profile,
      inputBudgetTokens: 10_000,
    });

    const envelope = projectionEnvelope(projected.messages[0]!);
    expect(envelope.mode).toBe("truncated");
    expect(envelope.content).toContain("line-0");
    expect(envelope.content).toContain("line-999");
    expect(envelope.content).toContain("lines omitted");
  });

  test("generic oversized results receive a bounded projection with a stable Tool-call reference", () => {
    const projected = projectToolResultWorkingSet({
      messages: [
        toolMessage({
          id: "generic-message",
          toolName: "customTool",
          toolCallId: "generic-call",
          output: { data: "z".repeat(5_000) },
        }),
        freshTail(),
      ],
      profile,
      inputBudgetTokens: 10_000,
      resolveSourceEntryId: () => "durable-tool-result",
    });

    const envelope = projectionEnvelope(projected.messages[0]!);
    expect(envelope.source).toBe("tool-call:generic-call");
    expect(projected.stats.projectedTokens).toBeLessThan(projected.stats.originalTokens);
  });
});
