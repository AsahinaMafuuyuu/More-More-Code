import { describe, expect, test } from "bun:test";
import { createCliEnvironmentShutdown } from "../src/lib/cli-environment";
import {
  CliRunLifecycle,
  CliRunQuiescenceTimeoutError,
  CliShutdownInProgressError,
} from "../src/lib/run-lifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("local CLI environment shutdown", () => {
  test("is idempotent and closes the local Session store before Runtime store", async () => {
    const order: string[] = [];
    const shutdown = createCliEnvironmentShutdown({
      async shutdownLocalSessions() {
        order.push("sessions:start");
        await Bun.sleep(1);
        order.push("sessions:end");
      },
      async shutdownRuntime() {
        order.push("runtime:start");
        await Bun.sleep(1);
        order.push("runtime:end");
      },
    });

    const first = shutdown();
    const second = shutdown();
    expect(second).toBe(first);

    await Promise.all([first, second]);
    expect(order).toEqual([
      "sessions:start",
      "sessions:end",
      "runtime:start",
      "runtime:end",
    ]);
  });

  test("still attempts Runtime shutdown when Session shutdown fails and preserves the first error", async () => {
    const order: string[] = [];
    const sessionError = new Error("session close failed");
    const shutdown = createCliEnvironmentShutdown({
      async shutdownLocalSessions() {
        order.push("sessions");
        throw sessionError;
      },
      async shutdownRuntime() {
        order.push("runtime");
      },
    });

    await expect(shutdown()).rejects.toBe(sessionError);
    expect(order).toEqual(["sessions", "runtime"]);
  });

  test("interrupts active Run/Tool work and awaits idle plus semantic persistence before closing stores", async () => {
    const order: string[] = [];
    const idle = deferred();
    const persistence = deferred();
    const lifecycle = new CliRunLifecycle({ quiesceTimeoutMs: 0 });
    lifecycle.register({
      interrupt() {
        order.push("interrupt");
      },
      async waitForIdle() {
        order.push("idle:wait");
        await idle.promise;
        order.push("idle:done");
      },
      async waitForPersistence() {
        order.push("persistence:wait");
        await persistence.promise;
        order.push("persistence:done");
      },
    });
    const shutdown = createCliEnvironmentShutdown({
      quiesceRuns: () => lifecycle.quiesce(),
      async shutdownLocalSessions() {
        order.push("sessions");
      },
      async shutdownRuntime() {
        order.push("runtime");
      },
    });

    const first = shutdown();
    const second = shutdown();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(order).toEqual(["interrupt", "idle:wait"]);
    expect(() => lifecycle.assertCanStartWork()).toThrow(CliShutdownInProgressError);

    idle.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["interrupt", "idle:wait", "idle:done", "persistence:wait"]);

    persistence.resolve();
    await first;
    expect(order).toEqual([
      "interrupt",
      "idle:wait",
      "idle:done",
      "persistence:wait",
      "persistence:done",
      "sessions",
      "runtime",
    ]);
  });

  test("fails closed on quiescence timeout and leaves both stores open", async () => {
    const order: string[] = [];
    const lifecycle = new CliRunLifecycle({ quiesceTimeoutMs: 1 });
    lifecycle.register({
      interrupt() {
        order.push("interrupt");
      },
      waitForIdle() {
        return new Promise<void>(() => undefined);
      },
    });
    const shutdown = createCliEnvironmentShutdown({
      quiesceRuns: () => lifecycle.quiesce(),
      async shutdownLocalSessions() {
        order.push("sessions");
      },
      async shutdownRuntime() {
        order.push("runtime");
      },
    });

    await expect(shutdown()).rejects.toBeInstanceOf(CliRunQuiescenceTimeoutError);
    expect(order).toEqual(["interrupt"]);
    expect(lifecycle.isAcceptingWork).toBe(false);
  });
});
