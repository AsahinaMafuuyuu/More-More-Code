import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeNativeTool } from "../src/lib/local-tools";
import { ProcessSandbox } from "../src/lib/process-sandbox";

const tempRoots: string[] = [];
const ORIGINAL_TEST_SECRET = process.env.MORE_MORE_CODE_TEST_SECRET;

afterEach(async () => {
    if (ORIGINAL_TEST_SECRET === undefined) {
        delete process.env.MORE_MORE_CODE_TEST_SECRET;
    } else {
        process.env.MORE_MORE_CODE_TEST_SECRET = ORIGINAL_TEST_SECRET;
    }
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
    })));
});

async function createWorkspace() {
    const root = await mkdtemp(join(tmpdir(), "more-more-code-sandbox-tool-"));
    tempRoots.push(root);
    return root;
}

describe("native subprocess sandbox integration", () => {
    test("bash does not inherit ambient credentials in safe environment mode", async () => {
        const workspaceRoot = await createWorkspace();
        process.env.MORE_MORE_CODE_TEST_SECRET = "should-not-cross";
        const sandbox = new ProcessSandbox({
            mode: "off",
            network: "inherit",
            environment: "safe",
            envAllow: [],
        });

        const result = await executeNativeTool(
            "bash",
            { command: "printf '%s' \"${MORE_MORE_CODE_TEST_SECRET-unset}\"" },
            {
                workspaceRoot,
                signal: new AbortController().signal,
                processSandbox: sandbox,
            },
        ) as { stdout: string; exitCode: number };

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("unset");
    });

    test("explicit envAllow makes a named variable available to bash", async () => {
        const workspaceRoot = await createWorkspace();
        process.env.MORE_MORE_CODE_TEST_SECRET = "explicitly-allowed";
        const sandbox = new ProcessSandbox({
            mode: "off",
            network: "inherit",
            environment: "safe",
            envAllow: ["MORE_MORE_CODE_TEST_SECRET"],
        });

        const result = await executeNativeTool(
            "bash",
            { command: "printf '%s' \"${MORE_MORE_CODE_TEST_SECRET-unset}\"" },
            {
                workspaceRoot,
                signal: new AbortController().signal,
                processSandbox: sandbox,
            },
        ) as { stdout: string; exitCode: number };

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("explicitly-allowed");
    });

    test("grep remains functional through the safe-environment process seam", async () => {
        const workspaceRoot = await createWorkspace();
        await writeFile(join(workspaceRoot, "sample.txt"), "alpha\nneedle\nomega\n", "utf8");
        const sandbox = new ProcessSandbox({
            mode: "off",
            network: "inherit",
            environment: "safe",
            envAllow: [],
        });

        const result = await executeNativeTool(
            "grep",
            { pattern: "needle", path: "." },
            {
                workspaceRoot,
                signal: new AbortController().signal,
                processSandbox: sandbox,
            },
        ) as { matches: Array<{ file: string; line: number; content: string }> };

        expect(result.matches).toEqual([{
            file: "sample.txt",
            line: 2,
            content: "needle",
        }]);
    });

    test("grep fails before subprocess creation when required isolation is unavailable", async () => {
        const workspaceRoot = await createWorkspace();
        let spawnCount = 0;
        const sandbox = new ProcessSandbox({
            mode: "required",
            network: "inherit",
            environment: "safe",
            envAllow: [],
        }, {
            platform: "win32",
            homedir: "C:\\Users\\test",
            which: () => null,
            spawn() {
                spawnCount += 1;
                throw new Error("must not spawn");
            },
        });

        await expect(executeNativeTool(
            "grep",
            { pattern: "needle", path: "." },
            {
                workspaceRoot,
                signal: new AbortController().signal,
                processSandbox: sandbox,
            },
        )).rejects.toThrow("No supported OS sandbox provider is available");
        expect(spawnCount).toBe(0);
    });
});
