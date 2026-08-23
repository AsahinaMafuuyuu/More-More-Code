import { describe, expect, test } from "bun:test";
import {
    ProcessSandbox,
    SandboxUnavailableError,
    projectProcessEnvironment,
    type SandboxedProcess,
} from "../src/lib/process-sandbox";

const baseConfig = {
    mode: "auto" as const,
    network: "inherit" as const,
    environment: "safe" as const,
    envAllow: [] as string[],
};

function fakeProcess(): SandboxedProcess {
    return {
        stdout: new ReadableStream<Uint8Array>(),
        stderr: new ReadableStream<Uint8Array>(),
        exited: Promise.resolve(0),
        kill() {},
    };
}

describe("ProcessSandbox", () => {
    test("safe child environment excludes ambient credentials but preserves runtime variables", () => {
        const projected = projectProcessEnvironment({
            PATH: "/usr/bin",
            TEMP: "/tmp",
            OPENAI_API_KEY: "secret",
            AWS_SECRET_ACCESS_KEY: "secret",
            EXPLICIT_TOKEN: "kept-by-config",
        }, {
            ...baseConfig,
            envAllow: ["EXPLICIT_TOKEN"],
        }, "linux");

        expect(projected).toEqual({
            PATH: "/usr/bin",
            TEMP: "/tmp",
            EXPLICIT_TOKEN: "kept-by-config",
        });
    });

    test("safe environment allowlist is case-insensitive on Windows", () => {
        const projected = projectProcessEnvironment({
            Path: "C:\\Windows",
            custom_token: "allowed",
            secret_key: "blocked",
        }, {
            ...baseConfig,
            envAllow: ["CUSTOM_TOKEN"],
        }, "win32");

        expect(projected).toEqual({
            Path: "C:\\Windows",
            custom_token: "allowed",
        });
    });

    test("auto mode falls back to direct execution when no hard restriction would be lost", () => {
        let spawned: string[] = [];
        const sandbox = new ProcessSandbox(baseConfig, {
            platform: "win32",
            homedir: "C:\\Users\\test",
            which: () => null,
            spawn(command) {
                spawned = command;
                return fakeProcess();
            },
        });

        const status = sandbox.getStatus();
        expect(status.provider).toBe("direct");
        expect(status.isolated).toBe(false);
        sandbox.spawn({
            command: ["bash", "-lc", "echo ok"],
            workspaceRoot: "C:\\repo",
            env: { PATH: "x" },
        });
        expect(spawned).toEqual(["bash", "-lc", "echo ok"]);
    });

    test("required mode fails closed before spawning when no provider exists", () => {
        let spawnCount = 0;
        const sandbox = new ProcessSandbox({
            ...baseConfig,
            mode: "required",
        }, {
            platform: "win32",
            homedir: "C:\\Users\\test",
            which: () => null,
            spawn() {
                spawnCount += 1;
                return fakeProcess();
            },
        });

        expect(() => sandbox.spawn({
            command: ["bash", "-lc", "echo nope"],
            workspaceRoot: "C:\\repo",
        })).toThrow(SandboxUnavailableError);
        expect(spawnCount).toBe(0);
    });

    test("auto mode refuses direct fallback when network denial was explicitly requested", () => {
        const sandbox = new ProcessSandbox({
            ...baseConfig,
            network: "deny",
        }, {
            platform: "darwin",
            homedir: "/Users/test",
            which: () => null,
        });

        expect(sandbox.getStatus().provider).toBe("unavailable");
        expect(() => sandbox.createLaunchPlan({
            command: ["bash", "-lc", "curl example.com"],
            workspaceRoot: "/Users/test/repo",
        })).toThrow("network=deny requires an OS sandbox provider");
    });

    test("Linux Bubblewrap plan uses read-only host root, writable workspace and private home/temp", () => {
        const sandbox = new ProcessSandbox({
            ...baseConfig,
            network: "deny",
        }, {
            platform: "linux",
            homedir: "/home/test",
            which: (command) => command === "bwrap" ? "/usr/bin/bwrap" : null,
        });

        const plan = sandbox.createLaunchPlan({
            command: ["bash", "-lc", "touch result.txt"],
            workspaceRoot: "/home/test/repo/project",
            env: {
                PATH: "/usr/bin",
                OPENAI_API_KEY: "must-not-cross",
            },
        });

        expect(plan.provider).toBe("bubblewrap");
        expect(plan.isolated).toBe(true);
        expect(plan.command.slice(0, 2)).toEqual(["/usr/bin/bwrap", "--die-with-parent"]);
        expect(plan.command).toContain("--unshare-net");
        expect(plan.command).toContain("--ro-bind");
        expect(plan.command).toContain("--tmpfs");
        expect(plan.command).toContain("/home/test");
        expect(plan.command).toContain("--bind");
        expect(plan.command).toContain("/home/test/repo/project");
        expect(plan.command.slice(-4)).toEqual(["--", "bash", "-lc", "touch result.txt"]);
        expect(plan.env.HOME).toBe("/tmp/home");
        expect(plan.env.OPENAI_API_KEY).toBeUndefined();
    });

    test("mode off cannot pretend to enforce network denial", () => {
        const sandbox = new ProcessSandbox({
            ...baseConfig,
            mode: "off",
            network: "deny",
        }, {
            platform: "win32",
            homedir: "C:\\Users\\test",
        });

        expect(sandbox.getStatus().provider).toBe("unavailable");
        expect(() => sandbox.createLaunchPlan({
            command: ["bash"],
            workspaceRoot: "C:\\repo",
        })).toThrow(SandboxUnavailableError);
    });

    test("rejects a subprocess cwd outside the writable workspace root", () => {
        const sandbox = new ProcessSandbox({
            ...baseConfig,
            mode: "off",
        }, {
            platform: "linux",
            homedir: "/home/test",
        });

        expect(() => sandbox.createLaunchPlan({
            command: ["bash"],
            workspaceRoot: "/home/test/repo",
            cwd: "/home/test/other",
        })).toThrow("Subprocess cwd must stay inside the configured workspace root");
    });

    test("accepts nested cwd names that merely start with two dots", () => {
        const sandbox = new ProcessSandbox({
            ...baseConfig,
            mode: "off",
        }, {
            platform: "linux",
            homedir: "/home/test",
        });

        const plan = sandbox.createLaunchPlan({
            command: ["bash"],
            workspaceRoot: "/home/test/repo",
            cwd: "/home/test/repo/..cache/work",
        });
        expect(plan.cwd).toBe("/home/test/repo/..cache/work");
    });
});
