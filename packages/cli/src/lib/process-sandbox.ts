import { homedir as getHomeDirectory } from "node:os";
import { posix, win32 } from "node:path";
import type { ResolvedAgentConfig } from "./agent-config";

export type ProcessSandboxConfig = ResolvedAgentConfig["sandbox"];

export type ProcessSandboxProvider = "direct" | "bubblewrap" | "unavailable";

export type ProcessSandboxStatus = {
    mode: ProcessSandboxConfig["mode"];
    provider: ProcessSandboxProvider;
    isolated: boolean;
    network: ProcessSandboxConfig["network"];
    environment: ProcessSandboxConfig["environment"];
    reason?: string;
};

export type ProcessSandboxRequest = {
    command: string[];
    workspaceRoot: string;
    cwd?: string;
    env?: Record<string, string | undefined>;
};

export type ProcessSandboxLaunchPlan = {
    provider: Exclude<ProcessSandboxProvider, "unavailable">;
    isolated: boolean;
    command: string[];
    cwd: string;
    env: Record<string, string>;
};

export type SandboxedProcess = {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(exitCode?: number): void;
};

type ProcessSandboxDependencies = {
    platform?: NodeJS.Platform;
    homedir?: string;
    which?: (command: string) => string | null;
    spawn?: (
        command: string[],
        options: {
            cwd: string;
            stdout: "pipe";
            stderr: "pipe";
            env: Record<string, string>;
        },
    ) => SandboxedProcess;
};

const SAFE_ENVIRONMENT_VARIABLES = new Set([
    "CI",
    "COLORTERM",
    "COMSPEC",
    "FORCE_COLOR",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOGNAME",
    "NO_COLOR",
    "NODE_ENV",
    "PATH",
    "PATHEXT",
    "SHELL",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
    "WINDIR",
]);

export class SandboxUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SandboxUnavailableError";
    }
}

/**
 * Deep process-execution module used by native Tools.
 *
 * Permission/approval decide whether a Tool may execute. This module decides
 * how an already-authorized subprocess is launched and whether requested OS
 * isolation can actually be enforced on the current host.
 */
export class ProcessSandbox {
    private readonly config: ProcessSandboxConfig;
    private readonly platform: NodeJS.Platform;
    private readonly homedir: string;
    private readonly path: typeof posix;
    private readonly bubblewrapPath: string | null;
    private readonly spawnProcess: NonNullable<ProcessSandboxDependencies["spawn"]>;

    constructor(config: ProcessSandboxConfig, dependencies: ProcessSandboxDependencies = {}) {
        this.config = {
            ...config,
            envAllow: [...config.envAllow],
        };
        this.platform = dependencies.platform ?? process.platform;
        this.path = this.platform === "win32" ? win32 : posix;
        this.homedir = this.path.resolve(dependencies.homedir ?? getHomeDirectory());
        const which = dependencies.which ?? ((command: string) => Bun.which(command));
        this.bubblewrapPath = this.config.mode !== "off" && this.platform === "linux"
            ? safelyResolveExecutable(which, "bwrap")
            : null;
        this.spawnProcess = dependencies.spawn ?? ((command, options) => Bun.spawn(command, options));
    }

    getStatus(): ProcessSandboxStatus {
        if (this.config.mode === "off") {
            if (this.config.network === "deny") {
                return {
                    mode: this.config.mode,
                    provider: "unavailable",
                    isolated: false,
                    network: this.config.network,
                    environment: this.config.environment,
                    reason: "network=deny cannot be enforced while sandbox mode is off",
                };
            }
            return {
                mode: this.config.mode,
                provider: "direct",
                isolated: false,
                network: this.config.network,
                environment: this.config.environment,
                reason: "OS process isolation is disabled by configuration",
            };
        }

        if (this.bubblewrapPath) {
            return {
                mode: this.config.mode,
                provider: "bubblewrap",
                isolated: true,
                network: this.config.network,
                environment: this.config.environment,
            };
        }

        if (this.config.mode === "required") {
            return {
                mode: this.config.mode,
                provider: "unavailable",
                isolated: false,
                network: this.config.network,
                environment: this.config.environment,
                reason: "No supported OS sandbox provider is available on this host",
            };
        }

        if (this.config.network === "deny") {
            return {
                mode: this.config.mode,
                provider: "unavailable",
                isolated: false,
                network: this.config.network,
                environment: this.config.environment,
                reason: "network=deny requires an OS sandbox provider; direct fallback would drop the restriction",
            };
        }

        return {
            mode: this.config.mode,
            provider: "direct",
            isolated: false,
            network: this.config.network,
            environment: this.config.environment,
            reason: "No supported OS sandbox provider is available; using direct execution in auto mode",
        };
    }

    createLaunchPlan(request: ProcessSandboxRequest): ProcessSandboxLaunchPlan {
        if (request.command.length === 0) {
            throw new Error("Cannot launch an empty subprocess command");
        }

        const workspaceRoot = this.path.resolve(request.workspaceRoot);
        const cwd = this.path.resolve(request.cwd ?? workspaceRoot);
        if (!isPathWithin(this.path, workspaceRoot, cwd)) {
            throw new Error("Subprocess cwd must stay inside the configured workspace root");
        }
        const status = this.getStatus();
        if (status.provider === "unavailable") {
            throw new SandboxUnavailableError(status.reason ?? "OS sandbox provider is unavailable");
        }

        const env = projectProcessEnvironment(
            request.env ?? process.env,
            this.config,
            this.platform,
        );

        if (status.provider === "direct") {
            return {
                provider: "direct",
                isolated: false,
                command: [...request.command],
                cwd,
                env,
            };
        }

        const plan = buildBubblewrapLaunchPlan({
            executable: this.bubblewrapPath!,
            command: request.command,
            workspaceRoot,
            cwd,
            env,
            homeDirectory: this.homedir,
            denyNetwork: this.config.network === "deny",
        });
        return plan;
    }

    spawn(request: ProcessSandboxRequest): SandboxedProcess {
        const plan = this.createLaunchPlan(request);
        return this.spawnProcess(plan.command, {
            cwd: plan.cwd,
            stdout: "pipe",
            stderr: "pipe",
            env: plan.env,
        });
    }

}

export function projectProcessEnvironment(
    environment: Record<string, string | undefined>,
    config: ProcessSandboxConfig,
    platform: NodeJS.Platform = process.platform,
): Record<string, string> {
    if (config.environment === "inherit") {
        return definedEnvironment(environment);
    }

    const caseInsensitive = platform === "win32";
    const configured = new Set(config.envAllow.map((name) => normalizeEnvironmentName(name, caseInsensitive)));
    const projected: Record<string, string> = {};

    for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) continue;
        const normalized = normalizeEnvironmentName(name, caseInsensitive);
        if (SAFE_ENVIRONMENT_VARIABLES.has(normalized) || configured.has(normalized)) {
            projected[name] = value;
        }
    }
    return projected;
}

function definedEnvironment(environment: Record<string, string | undefined>) {
    return Object.fromEntries(
        Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
}

function normalizeEnvironmentName(name: string, caseInsensitive: boolean) {
    return caseInsensitive ? name.toUpperCase() : name;
}

function safelyResolveExecutable(
    which: (command: string) => string | null,
    command: string,
) {
    try {
        return which(command);
    } catch {
        return null;
    }
}

function buildBubblewrapLaunchPlan(options: {
    executable: string;
    command: string[];
    workspaceRoot: string;
    cwd: string;
    env: Record<string, string>;
    homeDirectory: string;
    denyNetwork: boolean;
}): ProcessSandboxLaunchPlan {
    const args = [
        options.executable,
        "--die-with-parent",
        "--new-session",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
    ];
    if (options.denyNetwork) args.push("--unshare-net");

    args.push(
        "--ro-bind", "/", "/",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--dir", "/tmp/home",
    );

    if (shouldMaskHome(options.homeDirectory)) {
        args.push("--tmpfs", options.homeDirectory);
        if (isPathInside(options.homeDirectory, options.workspaceRoot)) {
            args.push(...createDestinationDirectoryArgs(options.homeDirectory, options.workspaceRoot));
        }
    }

    args.push(
        "--bind", options.workspaceRoot, options.workspaceRoot,
        "--chdir", options.cwd,
        "--",
        ...options.command,
    );

    return {
        provider: "bubblewrap",
        isolated: true,
        command: args,
        cwd: options.cwd,
        env: {
            ...options.env,
            HOME: "/tmp/home",
            TMPDIR: "/tmp",
            TMP: "/tmp",
            TEMP: "/tmp",
        },
    };
}

function shouldMaskHome(homeDirectory: string) {
    return posix.isAbsolute(homeDirectory) && homeDirectory !== posix.sep;
}

function isPathInside(parent: string, candidate: string) {
    const rel = posix.relative(parent, candidate);
    return isRelativePathWithin(posix, rel);
}

function isPathWithin(path: typeof posix, parent: string, candidate: string) {
    const rel = path.relative(parent, candidate);
    return isRelativePathWithin(path, rel);
}

function isRelativePathWithin(path: typeof posix, relativePath: string) {
    return relativePath === ""
        || (!path.isAbsolute(relativePath)
            && relativePath !== ".."
            && !relativePath.startsWith(`..${path.sep}`));
}

function createDestinationDirectoryArgs(homeDirectory: string, workspaceRoot: string) {
    const directories: string[] = [];
    let current = workspaceRoot;
    while (current !== homeDirectory) {
        directories.push(current);
        const parent = posix.dirname(current);
        if (parent === current || !isPathInside(homeDirectory, parent)) break;
        current = parent;
    }
    directories.reverse();
    return directories.flatMap((path) => ["--dir", path]);
}
