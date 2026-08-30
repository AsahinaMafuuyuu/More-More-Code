import { describe, expect, test } from "bun:test";
import type {
  ApprovalBroker,
  ApprovalRequest,
  ApprovalRequestOptions,
  PermissionDecision,
} from "@more-more-code/harness";
import { mergeAgentConfig } from "../src/lib/agent-config";
import { ToolRegistry } from "../src/lib/tool-registry";
import { ToolRuntime } from "../src/lib/tool-runtime";

function context(signal = new AbortController().signal) {
  return {
    sessionId: "session-one",
    runId: "run-one",
    turnId: "turn-one",
    stepId: "step-one",
    toolCallId: "tool-one",
    workspaceRoot: process.cwd(),
    mode: "BUILD" as const,
    signal,
  };
}

function waitingBroker(onRequest?: (request: ApprovalRequest) => void): ApprovalBroker {
  return {
    request(request: ApprovalRequest, options: ApprovalRequestOptions) {
      onRequest?.(request);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(
          options.signal.reason instanceof Error
            ? options.signal.reason
            : new Error("approval aborted"),
        );
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

describe("ToolRuntime interactive approval", () => {
  test("evaluates every capability before approval so a deny suppresses prompting", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    let approvalCalls = 0;
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: {
        decide(request): PermissionDecision {
          return request.capability === "filesystem.write"
            ? { effect: "deny", policy: "configured" }
            : { effect: "ask", policy: "configured" };
        },
      },
      approvalBroker: {
        async request() {
          approvalCalls += 1;
          return { decision: "allow" };
        },
      },
      executors: [{
        source: "native",
        async execute() {
          executorCalls += 1;
          return null;
        },
      }],
    });

    const result = await runtime.run({
      toolName: "editFile",
      input: { path: "README.md", oldString: "a", newString: "b" },
      context: context(),
    });

    expect(result.status).toBe("denied");
    expect(approvalCalls).toBe(0);
    expect(executorCalls).toBe(0);
  });

  test("batches multiple ask capabilities into one approval and resumes the same Tool Step", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    const approvals: ApprovalRequest[] = [];
    const observations: string[] = [];
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: {
        decide: () => ({ effect: "ask", policy: "configured" }),
      },
      approvalBroker: {
        async request(request) {
          approvals.push(request);
          observations.push("broker_requested");
          return { decision: "allow" };
        },
      },
      executors: [{
        source: "native",
        async execute() {
          executorCalls += 1;
          observations.push("executor");
          return { ok: true };
        },
      }],
      observer(event) {
        observations.push(event.type);
      },
    });

    const result = await runtime.run({
      toolName: "editFile",
      input: { path: "README.md", oldString: "a", newString: "b" },
      context: context(),
    });

    expect(result.status).toBe("completed");
    expect(executorCalls).toBe(1);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.requirements.map((request) => request.capability)).toEqual([
      "filesystem.read",
      "filesystem.write",
    ]);
    expect(observations.indexOf("approval_requested")).toBeLessThan(observations.indexOf("broker_requested"));
    expect(observations.indexOf("approval_resolved")).toBeLessThan(observations.indexOf("executor"));
  });

  test("human deny blocks the executor", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: { decide: () => ({ effect: "ask", policy: "configured" }) },
      approvalBroker: { request: async () => ({ decision: "deny" }) },
      executors: [{ source: "native", async execute() { executorCalls += 1; } }],
    });

    const result = await runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: context(),
    });

    expect(result.status).toBe("denied");
    expect(executorCalls).toBe(0);
  });

  test("run interruption cancels a pending approval without executor invocation", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    const controller = new AbortController();
    const observed: string[] = [];
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: { decide: () => ({ effect: "ask", policy: "configured" }) },
      approvalBroker: waitingBroker(() => queueMicrotask(() => controller.abort(new Error("interrupted")))),
      executors: [{ source: "native", async execute() { executorCalls += 1; } }],
      observer(event) { observed.push(event.type); },
    });

    const result = await runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: context(controller.signal),
    });

    expect(result.status).toBe("cancelled");
    expect(executorCalls).toBe(0);
    expect(observed).toContain("approval_cancelled");
  });

  test("approval timeout is independent from executor timeout", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: { decide: () => ({ effect: "ask", policy: "configured" }) },
      approvalBroker: {
        request() {
          // Deliberately ignore AbortSignal: ToolRuntime must still enforce the
          // approval timeout instead of trusting a broker adapter to settle.
          return new Promise(() => undefined);
        },
      },
      approvalTimeoutMs: 5,
      defaultTimeoutMs: 10_000,
      executors: [{ source: "native", async execute() { executorCalls += 1; } }],
    });

    const result = await runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: context(),
    });

    expect(result.status).toBe("timed_out");
    expect(executorCalls).toBe(0);
  });

  test("broker infrastructure failure propagates fail-closed", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: { decide: () => ({ effect: "ask", policy: "configured" }) },
      approvalBroker: {
        async request() {
          throw new Error("approval broker unavailable");
        },
      },
      executors: [{ source: "native", async execute() { executorCalls += 1; } }],
    });

    await expect(runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: context(),
    })).rejects.toThrow("approval broker unavailable");
    expect(executorCalls).toBe(0);
  });

  test("approval-request persistence failure prevents broker and executor side effects", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    let brokerCalls = 0;
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: { decide: () => ({ effect: "ask", policy: "configured" }) },
      approvalBroker: {
        async request() {
          brokerCalls += 1;
          return { decision: "allow" };
        },
      },
      executors: [{ source: "native", async execute() { executorCalls += 1; } }],
      observer(event) {
        if (event.type === "approval_requested") {
          throw new Error("approval request persistence failed");
        }
      },
    });

    await expect(runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: context(),
    })).rejects.toThrow("approval request persistence failed");
    expect(brokerCalls).toBe(0);
    expect(executorCalls).toBe(0);
  });

  test("approval-resolution persistence failure prevents executor invocation", async () => {
    const registry = new ToolRegistry(mergeAgentConfig({}, {}));
    let executorCalls = 0;
    const runtime = new ToolRuntime({
      registry,
      permissionPolicy: { decide: () => ({ effect: "ask", policy: "configured" }) },
      approvalBroker: { request: async () => ({ decision: "allow" }) },
      executors: [{ source: "native", async execute() { executorCalls += 1; } }],
      observer(event) {
        if (event.type === "approval_resolved") {
          throw new Error("approval resolution persistence failed");
        }
      },
    });

    await expect(runtime.run({
      toolName: "readFile",
      input: { path: "README.md" },
      context: context(),
    })).rejects.toThrow("approval resolution persistence failed");
    expect(executorCalls).toBe(0);
  });
});
