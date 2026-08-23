import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "path";
import { toolInputSchemas } from "@more-more-code/shared";
import { getAgentEnvironment } from "./agent-environment";
import type { ProcessSandbox, SandboxedProcess } from "./process-sandbox";
import { resolveWorkspacePath } from "./workspace-path";

const MAX_FILE_SIZE = 10_000;
const MAX_RESULTS = 200;
const MAX_MATCHES = 50;
const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;

async function resolveInsideWorkspace(workspaceRoot: string, path: string) {
    const resolution = await resolveWorkspacePath(workspaceRoot, path);
    if (resolution.scope === "outside-workspace") {
        throw new Error("Path is outside the project directory");
    }
    return {
        cwd: resolution.workspaceRoot,
        resolved: resolution.resolvedPath,
    };
}

function truncate(value: string, limit: number) {
    return value.length > limit
        ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
        : value;
}

function resolveNativeExecutable(command: "bash" | "grep") {
    const direct = Bun.which(command);
    if (direct) return direct;

    // Git for Windows places GNU utilities such as grep in usr/bin while
    // exposing bash from bin. That usr/bin directory is not necessarily on
    // the Windows PATH used by Bun.spawn, even though the same executable is
    // visible after entering Git Bash.
    if (process.platform === "win32" && command === "grep") {
        const bash = Bun.which("bash");
        if (bash) {
            const gitRoot = dirname(dirname(bash));
            const gitGrep = join(gitRoot, "usr", "bin", "grep.exe");
            if (existsSync(gitGrep)) return gitGrep;
        }
    }

    return command;
}

type NativeToolExecutionContext = {
    workspaceRoot: string;
    signal: AbortSignal;
    processSandbox: ProcessSandbox;
};

function throwIfAborted(signal: AbortSignal) {
    if (!signal.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new Error("Tool execution was cancelled");
}

async function readProcessOutput(stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const cancelRead = () => {
        void reader.cancel(signal.reason);
    };

    signal.addEventListener("abort", cancelRead, { once: true });
    if (signal.aborted) cancelRead();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            output += decoder.decode(value, { stream: true });
        }
        output += decoder.decode();
        return output;
    } finally {
        signal.removeEventListener("abort", cancelRead);
        reader.releaseLock();
    }
}

export function resolveNativeToolTimeoutMs(toolName: string, input: unknown) {
    if (toolName !== "bash") return undefined;
    const parsed = toolInputSchemas.bash.safeParse(input);
    return parsed.success ? parsed.data.timeout ?? DEFAULT_TIMEOUT : DEFAULT_TIMEOUT;
}

// Concrete native implementations. Visibility and policy belong to ToolRuntime.
export async function executeNativeTool(
    toolName: string,
    input: unknown,
    context: NativeToolExecutionContext,
) {
    throwIfAborted(context.signal);

    switch (toolName) {
        case "readFile": {
            const { path } = toolInputSchemas.readFile.parse(input);
            const { resolved } = await resolveInsideWorkspace(context.workspaceRoot, path);
            const content = await readFile(resolved, { encoding: "utf-8", signal: context.signal });

            return content.length > MAX_FILE_SIZE
                ? {
                    content: content.slice(0, MAX_FILE_SIZE),
                    truncated: true,
                    totalLength: content.length,
                }
                : { content };
        }
        case "listDirectory": {
            const { path } = toolInputSchemas.listDirectory.parse(input);
            const { cwd, resolved } = await resolveInsideWorkspace(context.workspaceRoot, path);
            const entries = await readdir(resolved); // 读取目录内容
            const results: {
                name: string;
                type: "file" | "directory"
            }[] = [];

            for (const entry of entries) {
                if (entry.startsWith(".")
                    || entry === "node_modules") {
                    continue; // 忽略隐藏文件和node_modules
                }
                const info = await stat(join(resolved, entry)); // 获取文件或目录信息

                results.push({
                    name: entry,
                    type: info.isDirectory() ? "directory" : "file",
                });

            }

            // 结果排序
            results.sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === "directory" ? -1 : 1; // 目录排在前面
                }
                return a.name.localeCompare(b.name); // 按名称排序
            });

            // 
            return {
                path: relative(cwd, resolved) || ".",
                entries: results
            }
        }

        case "glob": {
            const { pattern, path } = toolInputSchemas.glob.parse(input);
            const { cwd, resolved } = await resolveInsideWorkspace(context.workspaceRoot, path);
            const glob = new Bun.Glob(pattern);
            const files: string[] = [];
            let truncated = false; // 未截断

            for await (const match of glob.scan({
                cwd: resolved,
                dot: false,
                onlyFiles: true,
            })) {
                if (match.includes("node_modules")) {
                    continue; // 忽略node_modules
                }
                if (files.length >= MAX_RESULTS) {
                    truncated = true;
                    break; // 超过最大结果数，截断
                }
                files.push(relative(cwd, resolve(resolved, match)));
            }
            files.sort(); // 排序
            return {
                files,
                ...(truncated ?
                    { truncated }
                    : {}
                )
            }
        }

        case "grep": {
            const { pattern, path, includes } = toolInputSchemas.grep.parse(input);
            const { cwd, resolved } = await resolveInsideWorkspace(context.workspaceRoot, path);

            const args = [
                "-rn",
                "--color=never",
                "--exclude-dir=node_modules",
                "--exclude-dir=.git",
                "-E",
            ];

            if (includes) args.push(`--include=${includes}`);
            args.push(pattern, resolved);

            const proc = context.processSandbox.spawn({
                command: [resolveNativeExecutable("grep"), ...args],
                workspaceRoot: cwd,
                cwd,
                env: process.env,
            });
            const cancel = () => proc.kill();
            context.signal.addEventListener("abort", cancel, { once: true });

            const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);

            const exitCode = await proc.exited;
            context.signal.removeEventListener("abort", cancel);
            throwIfAborted(context.signal);

            if (exitCode !== 0 && exitCode !== 1) {
                throw new Error(`grep failed: ${stderr.trim()}`);
            }

            if (!stdout.trim()) {
                return { matches: [], message: "No matches found" };
            }

            const lines = stdout.trim().split("\n");
            const matches: { file: string; line: number; content: string }[] = [];
            let truncated = false;

            for (const line of lines) {
                if (matches.length >= MAX_MATCHES) {
                    truncated = true;
                    break;
                }

                const match = line.match(/^(.+?):(\d+):(.*)$/);

                if (match) {
                    matches.push({
                        file: relative(cwd, match[1]!),
                        line: Number(match[2]),
                        content: match[3]!,
                    });
                }
            }

            return {
                matches,
                ...(truncated ?
                    {
                        truncated,
                        totalMatches: lines.length
                    }
                    : {}
                ),
            }
        }

        case "loadSkill": {
            const { name } = toolInputSchemas.loadSkill.parse(input);
            const skill = await getAgentEnvironment().skills.load(name);
            return {
                name: skill.name,
                description: skill.description,
                scope: skill.scope,
                source: skill.path,
                content: skill.content,
            };
        }

        case "writeFile": {
            const { path, content } = toolInputSchemas.writeFile.parse(input);
            const { cwd, resolved } = await resolveInsideWorkspace(context.workspaceRoot, path);

            await mkdir(dirname(resolved), { recursive: true });
            throwIfAborted(context.signal);
            await writeFile(resolved, content, { encoding: "utf-8", signal: context.signal });

            return {
                success: true as const,
                path: relative(cwd, resolved),
                bytesWritten: Buffer.byteLength(content, "utf-8"),
            };
        }

        case "editFile": {
            const { path, oldString, newString } = toolInputSchemas.editFile.parse(input);
            const { cwd, resolved } = await resolveInsideWorkspace(context.workspaceRoot, path);
            const content = await readFile(resolved, { encoding: "utf-8", signal: context.signal });
            const occurrences = content.split(oldString).length - 1;

            if (occurrences === 0) throw new Error("oldString not found in file");
            if (occurrences > 1) {
                throw new Error(`oldString is ambiguous; found ${occurrences} matches`);
            }

            throwIfAborted(context.signal);
            await writeFile(resolved, content.replace(oldString, newString), { encoding: "utf-8", signal: context.signal });
            return { success: true as const, path: relative(cwd, resolved) };
        }

        case "bash": {
            const { command } = toolInputSchemas.bash.parse(input);
            const workspaceRoot = (await resolveInsideWorkspace(context.workspaceRoot, ".")).resolved;
            const sandboxProvider = context.processSandbox.getStatus().provider;
            const shellStateDirectory = sandboxProvider === "bubblewrap"
                ? null
                : await mkdtemp(join(tmpdir(), "more-more-code-shell-"));
            const cancellationFile = shellStateDirectory
                ? join(shellStateDirectory, "cancel")
                : "/tmp/.more-more-code-unused-cancel";
            const cancellationFileExpression = process.platform === "win32"
                ? '"$(cygpath -u "$1")"'
                : '"$1"';
            const shellWrapper = [
                "set -m",
                `cancel_file=${cancellationFileExpression}`,
                'eval "$2" &',
                "child=$!",
                'while kill -0 "$child" 2>/dev/null; do',
                '  if [ -f "$cancel_file" ]; then',
                '    kill -TERM -- -"$child" 2>/dev/null || true',
                "    sleep 0.05",
                '    kill -KILL -- -"$child" 2>/dev/null || true',
                '    wait "$child" 2>/dev/null || true',
                "    exit 130",
                "  fi",
                "  sleep 0.02",
                "done",
                'wait "$child"',
            ].join("\n");
            let proc: SandboxedProcess | null = null;
            let cancellation: Promise<void> | null = null;
            const cancel = () => {
                if (!proc) return;
                if (sandboxProvider === "bubblewrap") {
                    // Bubblewrap owns a private PID namespace. Killing the
                    // sandbox supervisor tears down the isolated process tree;
                    // the host-side cancellation-file bridge is only needed
                    // for direct/MSYS execution where grandchildren can outlive
                    // the visible bash.exe process.
                    proc.kill();
                    return;
                }
                // The Bash wrapper owns the POSIX process group. Signalling it
                // through a file works on Windows/MSYS too, where killing only
                // the visible bash.exe process can leave grandchildren alive.
                cancellation ??= writeFile(cancellationFile, "cancel", "utf8")
                    .then(async () => { await proc!.exited; });
            };
            let stdout: string;
            let stderr: string;
            let exitCode: number;
            try {
                proc = context.processSandbox.spawn({
                    command: [
                        resolveNativeExecutable("bash"),
                        "-c",
                        shellWrapper,
                        "more-more-code-shell",
                        cancellationFile,
                        command,
                    ],
                    workspaceRoot,
                    cwd: workspaceRoot,
                    env: { ...process.env, TERM: "dumb" },
                });
                context.signal.addEventListener("abort", cancel, { once: true });
                if (context.signal.aborted) cancel();
                [stdout, stderr, exitCode] = await Promise.all([
                    readProcessOutput(proc.stdout, context.signal),
                    readProcessOutput(proc.stderr, context.signal),
                    proc.exited,
                ]);
            } finally {
                context.signal.removeEventListener("abort", cancel);
                if (cancellation) await cancellation;
                if (shellStateDirectory) {
                    await rm(shellStateDirectory, { recursive: true, force: true });
                }
            }
            throwIfAborted(context.signal);

            return {
                stdout: truncate(stdout, MAX_OUTPUT),
                stderr: truncate(stderr, MAX_OUTPUT),
                exitCode,
            };
        }
        default:
            throw new Error(`Unknown tool: ${toolName}`);

    }
}
