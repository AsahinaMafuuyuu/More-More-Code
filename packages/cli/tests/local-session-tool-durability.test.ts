import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentLoop,
  appendSessionEntry,
  createSessionTree,
  appendSessionTreeMessages,
  restoreSessionTree,
  type SessionTreeState,
} from "@more-more-code/harness";
import { bootstrapLocalSessionStore } from "../../session-store/src";
import type { Message } from "../src/lib/chat-types";
import { createLocalSessionAuthority } from "../src/lib/local-session-authority";
import {
  buildDurableToolTerminalState,
  inspectDurableToolCall,
  persistThenExposeToolTerminal,
} from "../src/lib/durable-tool-terminal";
import { projectDurableSessionMessages } from "../src/lib/durable-session-message";
import { removeTemporaryRoot } from "./test-temp-cleanup";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryRoot));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function toolCallState(): SessionTreeState<Message> {
  const state = createSessionTree<Message>([
    {
      id: "assistant-tool-message",
      role: "assistant",
      parts: [{
        type: "tool-bash",
        toolCallId: "tool-call-1",
        state: "input-available",
        input: { command: "echo durable" },
      } as never],
    },
  ]);
  return appendSessionEntry(state, {
    type: "tool_call",
    toolCallId: "tool-call-1",
    toolName: "bash",
    input: { command: "echo durable" },
  });
}

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsUndefined);
}

function twoToolCallMessage(): Message {
  return {
    id: "assistant-two-tool-calls",
    role: "assistant",
    parts: [
      {
        type: "tool-bash",
        toolCallId: "sqlite-success-tool",
        state: "input-available",
        input: { command: "echo success" },
      } as never,
      {
        type: "tool-bash",
        toolCallId: "sqlite-failed-tool",
        state: "input-available",
        input: { command: "echo failure" },
      } as never,
    ],
  };
}

describe("durable local tool terminals", () => {
  test("persists success and error terminals through a real SQLite authority restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-tool-terminal-"));
    temporaryRoots.push(root);
    const databaseUrl = pathToFileURL(path.join(root, "sessions.db")).href;
    let clock = 100;
    const createId = (() => {
      let index = 0;
      return () => `sqlite-tool-entry-${index++}`;
    })();
    let first = await bootstrapLocalSessionStore({ databaseUrl, now: () => clock++ });
    let firstOpen = true;

    try {
      const authority = createLocalSessionAuthority({
        store: first.store,
        createId,
        now: () => clock++,
      });
      const created = await authority.create({
        id: "sqlite-tool-session",
        title: "Durable SQLite Tool Session",
      });
      let withToolInputs = appendSessionTreeMessages(created.state, [twoToolCallMessage()]);
      withToolInputs = appendSessionEntry(withToolInputs, {
        type: "tool_call",
        toolCallId: "sqlite-success-tool",
        toolName: "bash",
        input: { command: "echo success" },
      });
      withToolInputs = appendSessionEntry(withToolInputs, {
        type: "tool_call",
        toolCallId: "sqlite-failed-tool",
        toolName: "bash",
        input: { command: "echo failure" },
      });
      await authority.commit({
        sessionId: "sqlite-tool-session",
        state: withToolInputs,
      });

      const success = await persistThenExposeToolTerminal({
        authority,
        sessionId: "sqlite-tool-session",
        state: withToolInputs,
        toolCallId: "sqlite-success-tool",
        toolName: "bash",
        presentation: {
          state: "output-available",
          output: { stdout: "success\\n", nested: { omitted: undefined, kept: true } },
        },
        result: { status: "completed", source: "native", startedAt: 101, completedAt: 102 },
        // Explicit optional metadata verifies the terminal builder omits it
        // before SQLite's JSON-safe validation sees the tree.
        metadata: { runId: "sqlite-run", turnId: undefined, stepId: "sqlite-step" },
        async expose() {},
      });
      expect(success.entries.at(-1)?.type).toBe("tool_result");
      expect(success.entries.some((entry) => entry.type === "message_update")).toBe(false);
      expect(containsUndefined(success)).toBe(false);

      const failed = await persistThenExposeToolTerminal({
        authority,
        sessionId: "sqlite-tool-session",
        state: success,
        toolCallId: "sqlite-failed-tool",
        toolName: "bash",
        presentation: { state: "output-error", errorText: "tool failed durably" },
        result: { status: "failed" },
        metadata: { runId: "sqlite-run", turnId: undefined, stepId: "sqlite-step" },
        error: {
          message: "tool failed durably",
          code: "tool_execution_failed",
          details: {
            source: undefined,
            nested: { omitted: undefined, kept: true },
            positions: ["first", undefined, "third"],
          },
        },
        async expose() {},
      });
      expect(failed.entries.slice(-2).map((entry) => entry.type)).toEqual([
        "tool_result",
        "error",
      ]);
      expect(failed.entries.some((entry) => entry.type === "message_update")).toBe(false);
      expect(containsUndefined(failed)).toBe(false);
      const errorEntry = failed.entries.at(-1)!;
      expect(errorEntry.type).toBe("error");
      if (errorEntry.type === "error") {
        expect(errorEntry.details).toMatchObject({
          nested: { kept: true },
          positions: ["first", null, "third"],
        });
      }

      await first.store.close();
      firstOpen = false;
      first = await bootstrapLocalSessionStore({ databaseUrl, now: () => clock++ });
      const restartedAuthority = createLocalSessionAuthority({
        store: first.store,
        createId,
        now: () => clock++,
      });
      const reopened = await restartedAuthority.open("sqlite-tool-session");
      expect(reopened?.state).toEqual(failed);
      expect(containsUndefined(reopened?.state)).toBe(false);

      const [message] = projectDurableSessionMessages(reopened!.state);
      expect(message).toMatchObject({ id: "assistant-two-tool-calls" });
      const successPart = message!.parts.find((part) => (
        "toolCallId" in part && part.toolCallId === "sqlite-success-tool"
      )) as Record<string, unknown>;
      const failedPart = message!.parts.find((part) => (
        "toolCallId" in part && part.toolCallId === "sqlite-failed-tool"
      )) as Record<string, unknown>;
      expect(successPart).toMatchObject({
        state: "output-available",
        output: { stdout: "success\\n", nested: { kept: true } },
      });
      expect("errorText" in successPart).toBe(false);
      expect(failedPart).toMatchObject({
        state: "output-error",
        errorText: "tool failed durably",
      });
      expect("output" in failedPart).toBe(false);
      expect(inspectDurableToolCall(reopened!.state, "sqlite-success-tool")).toMatchObject({
        status: "terminal",
        result: { status: "completed", output: { stdout: "success\\n" } },
      });
      expect(inspectDurableToolCall(reopened!.state, "sqlite-failed-tool")).toMatchObject({
        status: "terminal",
        result: { status: "failed", error: "tool failed durably" },
      });
    } finally {
      if (firstOpen) await first.store.close();
      else await first.store.close();
    }
  });

  test("fails closed on non-plain Tool output instead of silently serializing it", () => {
    const state = toolCallState();

    expect(() => buildDurableToolTerminalState({
      sessionId: "tool-session",
      state,
      toolCallId: "tool-call-1",
      toolName: "bash",
      presentation: {
        state: "output-available",
        output: new Date("2026-08-26T00:00:00.000Z"),
      },
      result: { status: "completed", source: "native" },
    })).toThrow("contains a non-plain object");
  });

  test("does not expose a successful tool output until its atomic authority commit resolves", async () => {
    const commit = deferred<{ state: SessionTreeState<Message> }>();
    const commits: SessionTreeState<Message>[] = [];
    let exposed = 0;

    const terminal = persistThenExposeToolTerminal({
      authority: {
        async commit(input) {
          commits.push(input.state);
          return commit.promise;
        },
      },
      sessionId: "tool-session",
      state: toolCallState(),
      toolCallId: "tool-call-1",
      toolName: "bash",
      presentation: { state: "output-available", output: { stdout: "durable\n" } },
      result: {
        status: "completed",
        source: "native",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
      },
      async expose() {
        exposed += 1;
      },
    });

    await Promise.resolve();
    expect(exposed).toBe(0);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.entries.at(-1)?.type).toBe("tool_result");
    expect(commits[0]!.entries.some((entry) => entry.type === "message_update")).toBe(false);

    commit.resolve({ state: commits[0]! });
    const committed = await terminal;
    expect(exposed).toBe(1);

    const reopened = restoreSessionTree<Message>(committed);
    const message = projectDurableSessionMessages(reopened)[0]!;
    expect(message.parts[0]).toMatchObject({
      toolCallId: "tool-call-1",
      state: "output-available",
      output: { stdout: "durable\n" },
    });
    expect(inspectDurableToolCall(reopened, "tool-call-1")).toMatchObject({
      status: "terminal",
      result: { status: "completed" },
    });
  });

  test("rejecting a terminal commit fails the Run before a tool-continuation model step", async () => {
    const state = toolCallState();
    let modelSteps = 0;
    let toolExposures = 0;
    const loop = new AgentLoop({
      createId: (() => {
        let index = 0;
        return () => `tool-run-${index++}`;
      })(),
      now: () => 1,
    });

    const run = await loop.run({
      sessionId: "tool-session",
      adapter: {
        async runModelStep() {
          modelSteps += 1;
          return {
            toolCalls: [{
              toolCallId: "tool-call-1",
              toolName: "bash",
              input: { command: "echo should-not-continue" },
            }],
          };
        },
        async runToolStep(toolCall) {
          await persistThenExposeToolTerminal({
            authority: {
              async commit() {
                throw new Error("local authority commit rejected");
              },
            },
            sessionId: "tool-session",
            state,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            presentation: { state: "output-available", output: "side effect result" },
            result: { status: "completed", source: "native" },
            async expose() {
              toolExposures += 1;
            },
          });
        },
      },
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("local authority commit rejected");
    expect(modelSteps).toBe(1);
    expect(toolExposures).toBe(0);
    expect(inspectDurableToolCall(state, "tool-call-1")).toMatchObject({ status: "pending" });
  });

  test("a deferred terminal commit prevents AgentLoop from sending the continuation model request", async () => {
    const state = toolCallState();
    const commit = deferred<{ state: SessionTreeState<Message> }>();
    const commitStarted = deferred<void>();
    let modelSteps = 0;
    let toolExposures = 0;
    const loop = new AgentLoop({
      createId: (() => {
        let index = 0;
        return () => `deferred-tool-run-${index++}`;
      })(),
      now: () => 1,
    });

    const pendingRun = loop.run({
      sessionId: "tool-session",
      adapter: {
        async runModelStep() {
          modelSteps += 1;
          return modelSteps === 1
            ? {
              toolCalls: [{
                toolCallId: "tool-call-1",
                toolName: "bash",
                input: { command: "echo wait-for-commit" },
              }],
            }
            : { toolCalls: [] };
        },
        async runToolStep(toolCall) {
          await persistThenExposeToolTerminal({
            authority: {
              async commit() {
                commitStarted.resolve();
                return commit.promise;
              },
            },
            sessionId: "tool-session",
            state,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            presentation: { state: "output-available", output: "durable output" },
            result: { status: "completed", source: "native" },
            async expose() {
              toolExposures += 1;
            },
          });
        },
      },
    });

    await commitStarted.promise;
    expect(modelSteps).toBe(1);
    expect(toolExposures).toBe(0);
    expect(loop.isBusy).toBe(true);

    commit.resolve({ state });
    const run = await pendingRun;
    expect(run.status).toBe("completed");
    expect(toolExposures).toBe(1);
    expect(modelSteps).toBe(2);
  });
});
