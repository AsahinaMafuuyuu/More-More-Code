import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DefaultPermissionPolicy } from "@more-more-code/harness";
import { mergeAgentConfig } from "../src/lib/agent-config";
import { loadAgentEnvironment } from "../src/lib/agent-environment";
import {
    buildSystemPrompt,
    getPromptPrefixSources,
    SYSTEM_PROMPT_VERSION,
} from "../src/lib/system-prompt";
import { createPromptPrefixIdentity } from "../src/lib/cache-identity";
import { executeNativeTool, resolveNativeToolTimeoutMs } from "../src/lib/local-tools";
import { ProcessSandbox } from "../src/lib/process-sandbox";
import { ToolRuntime } from "../src/lib/tool-runtime";
import { ToolRegistry } from "../src/lib/tool-registry";

const tempRoots: string[] = [];
const allowAllPermissionPolicy = new DefaultPermissionPolicy();
const directProcessSandbox = new ProcessSandbox({
    mode: "off",
    network: "inherit",
    environment: "inherit",
    envAllow: [],
});
const allowApprovalBroker = {
    async request() {
        return { decision: "allow" as const };
    },
};

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
    })));
});

async function createTempRoot(prefix: string) {
    const path = await mkdtemp(join(tmpdir(), prefix));
    tempRoots.push(path);
    return path;
}

describe("agent bootstrap", () => {
    test("project configuration overrides global values while MCP servers merge by name", () => {
        const merged = mergeAgentConfig(
            {
                model: { providerId: "openai", modelId: "gpt-5.5" },
                skills: { enabled: false },
                session: { branchSummaryOnJump: "never" },
                sandbox: {
                    mode: "required",
                    network: "deny",
                    environment: "inherit",
                    envAllow: ["GLOBAL_ONLY"],
                },
                tools: {
                    mcp: {
                        servers: {
                            globalDocs: { transport: "http", url: "https://example.test/mcp" },
                        },
                    },
                },
            },
            {
                model: { providerId: "deepseek", modelId: "deepseek-v4-pro" },
                skills: { enabled: true, directories: ["project-skills"] },
                session: { branchSummaryOnJump: "always" },
                sandbox: {
                    mode: "auto",
                    environment: "safe",
                    envAllow: ["PROJECT_ONLY"],
                },
                tools: {
                    mcp: {
                        servers: {
                            projectTools: { transport: "stdio", command: "example-mcp" },
                        },
                    },
                },
            },
        );

        expect(merged.skills.enabled).toBe(true);
        expect(merged.model).toEqual({ providerId: "deepseek", modelId: "deepseek-v4-pro" });
        expect(merged.skills.directories).toEqual(["project-skills"]);
        expect(merged.session.branchSummaryOnJump).toBe("always");
        expect(Object.keys(merged.tools.mcp.servers).sort()).toEqual(["globalDocs", "projectTools"]);
        expect(merged.sandbox).toEqual({
            mode: "auto",
            network: "deny",
            environment: "safe",
            envAllow: ["PROJECT_ONLY"],
        });
    });

    test("defaults Branch Summary navigation policy to ask", () => {
        expect(mergeAgentConfig({}, {}).session.branchSummaryOnJump).toBe("ask");
    });

    test("defaults subprocess sandbox policy to auto with a safe environment", () => {
        expect(mergeAgentConfig({}, {}).sandbox).toEqual({
            mode: "auto",
            network: "inherit",
            environment: "safe",
            envAllow: [],
        });
    });

    test("rejects unknown sandbox configuration fields instead of silently weakening policy", async () => {
        const root = await createTempRoot("more-more-code-invalid-sandbox-");
        const home = join(root, "home");
        const workspace = join(root, "workspace");
        const globalConfigDir = join(home, ".more-more-code");
        const projectConfigDir = join(workspace, ".more-more-code");

        await Promise.all([
            mkdir(globalConfigDir, { recursive: true }),
            mkdir(projectConfigDir, { recursive: true }),
        ]);
        await Promise.all([
            writeFile(join(globalConfigDir, "AGENTS.md"), "global"),
            writeFile(join(projectConfigDir, "AGENTS.md"), "project"),
            writeFile(join(globalConfigDir, "config.json"), JSON.stringify({ version: 1 }, null, 2)),
            writeFile(join(projectConfigDir, "config.json"), JSON.stringify({
                version: 1,
                sandbox: {
                    mode: "required",
                    netwrok: "deny",
                },
            }, null, 2)),
        ]);

        await expect(loadAgentEnvironment({
            workspaceRoot: workspace,
            globalHome: home,
            ensureLayout: false,
        })).rejects.toThrow("Invalid MORE-MORE-CODE config");
    });

    test("rejects provider credentials in project Agent Config instead of treating JSON as a secret store", async () => {
        const root = await createTempRoot("more-more-code-invalid-project-credential-");
        const home = join(root, "home");
        const workspace = join(root, "workspace");
        const globalConfigDir = join(home, ".more-more-code");
        const projectConfigDir = join(workspace, ".more-more-code");

        await Promise.all([
            mkdir(globalConfigDir, { recursive: true }),
            mkdir(projectConfigDir, { recursive: true }),
        ]);
        await Promise.all([
            writeFile(join(globalConfigDir, "config.json"), JSON.stringify({ version: 1 }, null, 2)),
            writeFile(join(projectConfigDir, "config.json"), JSON.stringify({
                version: 1,
                model: { providerId: "openai", modelId: "gpt-5.5" },
                credentials: { openai: "TOP-SECRET" },
            }, null, 2)),
        ]);

        await expect(loadAgentEnvironment({
            workspaceRoot: workspace,
            globalHome: home,
            ensureLayout: false,
        })).rejects.toThrow("Invalid MORE-MORE-CODE config");
    });

    test("loads global then project instructions and progressively discovers skills", async () => {
        const root = await createTempRoot("more-more-code-bootstrap-");
        const home = join(root, "home");
        const workspace = join(root, "workspace");
        const globalConfigDir = join(home, ".more-more-code");
        const projectConfigDir = join(workspace, ".more-more-code");
        const agentsPlanningSkillDir = join(home, ".agents", "skills", "planning");
        const agentsResearchSkillDir = join(home, ".agents", "skills", "research");
        const globalSkillDir = join(globalConfigDir, "skills", "planning");
        const projectSkillDir = join(projectConfigDir, "skills", "review");

        await Promise.all([
            mkdir(agentsPlanningSkillDir, { recursive: true }),
            mkdir(agentsResearchSkillDir, { recursive: true }),
            mkdir(globalSkillDir, { recursive: true }),
            mkdir(projectSkillDir, { recursive: true }),
        ]);
        await Promise.all([
            writeFile(join(globalConfigDir, "config.json"), JSON.stringify({ version: 1 }, null, 2)),
            writeFile(join(projectConfigDir, "config.json"), JSON.stringify({ version: 1 }, null, 2)),
            writeFile(join(globalConfigDir, "AGENTS.md"), "GLOBAL_INSTRUCTION"),
            writeFile(join(projectConfigDir, "AGENTS.md"), "PROJECT_INSTRUCTION"),
            writeFile(
                join(agentsPlanningSkillDir, "SKILL.md"),
                "---\nname: planning\ndescription: Shared planning fallback\n---\nAGENTS_PLANNING_BODY",
            ),
            writeFile(
                join(agentsResearchSkillDir, "SKILL.md"),
                "---\nname: research\ndescription: Shared research workflow\n---\nAGENTS_RESEARCH_BODY",
            ),
            writeFile(
                join(globalSkillDir, "SKILL.md"),
                "---\nname: planning\ndescription: Plan implementation work\n---\nGLOBAL_SKILL_BODY_SECRET",
            ),
            writeFile(
                join(projectSkillDir, "SKILL.md"),
                "---\nname: review\ndescription: Review implementation changes\n---\nPROJECT_SKILL_BODY_SECRET",
            ),
        ]);

        const environment = await loadAgentEnvironment({
            workspaceRoot: workspace,
            globalHome: home,
            ensureLayout: false,
        });

        expect(environment.instructions.map((item) => item.scope)).toEqual(["global", "project"]);
        expect(environment.instructions.map((item) => item.content)).toEqual([
            "GLOBAL_INSTRUCTION",
            "PROJECT_INSTRUCTION",
        ]);
        expect(environment.skills.list().map((skill) => skill.name)).toEqual(["planning", "research", "review"]);
        expect(environment.skills.get("planning")).not.toHaveProperty("content");
        expect(environment.skills.get("planning")?.scope).toBe("global");
        expect(environment.skills.get("research")?.scope).toBe("agents");

        const prompt = buildSystemPrompt({ mode: "PLAN", environment });
        expect(prompt).toContain("GLOBAL_INSTRUCTION");
        expect(prompt).toContain("PROJECT_INSTRUCTION");
        expect(prompt).toContain("planning: Plan implementation work");
        expect(prompt).not.toContain("GLOBAL_SKILL_BODY_SECRET");
        expect(prompt.indexOf("GLOBAL_INSTRUCTION")).toBeLessThan(prompt.indexOf("PROJECT_INSTRUCTION"));
        expect(prompt.indexOf("PROJECT_INSTRUCTION")).toBeLessThan(prompt.indexOf("## Available skills"));

        const loaded = await environment.skills.load("planning");
        expect(loaded.content).toContain("GLOBAL_SKILL_BODY_SECRET");
        expect(loaded.content).not.toContain("AGENTS_PLANNING_BODY");

        const shared = await environment.skills.load("research");
        expect(shared.content).toContain("AGENTS_RESEARCH_BODY");
    });

    test("keeps native tools separate from configured MCP extension sources", async () => {
        const root = await createTempRoot("more-more-code-tools-");
        const home = join(root, "home");
        const workspace = join(root, "workspace");
        const globalConfigDir = join(home, ".more-more-code");
        const projectConfigDir = join(workspace, ".more-more-code");

        await Promise.all([
            mkdir(globalConfigDir, { recursive: true }),
            mkdir(projectConfigDir, { recursive: true }),
        ]);
        await Promise.all([
            writeFile(join(globalConfigDir, "AGENTS.md"), "global"),
            writeFile(join(projectConfigDir, "AGENTS.md"), "project"),
            writeFile(join(globalConfigDir, "config.json"), JSON.stringify({ version: 1 }, null, 2)),
            writeFile(join(projectConfigDir, "config.json"), JSON.stringify({
                version: 1,
                tools: {
                    mcp: {
                        servers: {
                            docs: { transport: "http", url: "https://example.test/mcp", enabled: true },
                        },
                    },
                },
            }, null, 2)),
        ]);

        const environment = await loadAgentEnvironment({
            workspaceRoot: workspace,
            globalHome: home,
            ensureLayout: false,
        });
        const sources = environment.tools.listSources();
        const planTools = environment.tools.getModelTools("PLAN");
        const buildTools = environment.tools.getModelTools("BUILD");

        expect(sources[0]?.kind).toBe("native");
        expect(sources.find((source) => source.kind === "mcp" && source.name === "docs")).toBeDefined();
        expect("loadSkill" in planTools).toBe(true);
        expect("writeFile" in planTools).toBe(false);
        expect("writeFile" in buildTools).toBe(true);

        const planSnapshot = environment.tools.getToolSetSnapshot("PLAN");
        const buildSnapshot = environment.tools.getToolSetSnapshot("BUILD");
        expect(planSnapshot.map((tool) => tool.name)).toEqual(
            [...planSnapshot.map((tool) => tool.name)].sort((a, b) => a.localeCompare(b)),
        );
        expect(planSnapshot.some((tool) => tool.name === "writeFile")).toBe(false);
        expect(buildSnapshot.some((tool) => tool.name === "writeFile")).toBe(true);

        const prefixSources = getPromptPrefixSources(environment);
        const planIdentity = createPromptPrefixIdentity({
            provider: "openai",
            model: "gpt-5.5",
            mode: "PLAN",
            systemPromptVersion: SYSTEM_PROMPT_VERSION,
            ...prefixSources,
            toolSetSnapshot: planSnapshot,
        });
        const buildIdentity = createPromptPrefixIdentity({
            provider: "openai",
            model: "gpt-5.5",
            mode: "BUILD",
            systemPromptVersion: SYSTEM_PROMPT_VERSION,
            ...prefixSources,
            toolSetSnapshot: buildSnapshot,
        });
        expect(planIdentity.fingerprint).not.toBe(buildIdentity.fingerprint);
        expect(planIdentity.toolSetFingerprint).not.toBe(buildIdentity.toolSetFingerprint);
    });

    test("normalizes tool cancellation and timeout", async () => {
        const registry = new ToolRegistry(mergeAgentConfig({}, {}));
        const blockingExecutor = {
            source: "native" as const,
            async execute(_name: string, _input: unknown, context: { signal: AbortSignal }) {
                return new Promise((_resolve, reject) => {
                    context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
                });
            },
        };
        const controller = new AbortController();
        const context = {
            sessionId: "session-1",
            runId: "run-1",
            turnId: "turn-1",
            stepId: "step-1",
            toolCallId: "tool-call-1",
            workspaceRoot: process.cwd(),
            mode: "BUILD" as const,
            signal: controller.signal,
        };
        const cancellationRuntime = new ToolRuntime({
            registry,
            executors: [blockingExecutor],
            permissionPolicy: allowAllPermissionPolicy,
            approvalBroker: allowApprovalBroker,
        });
        const pending = cancellationRuntime.run({
            toolName: "readFile",
            input: { path: "README.md" },
            context,
        });
        controller.abort();
        expect((await pending).status).toBe("cancelled");

        const timeoutRuntime = new ToolRuntime({
            registry,
            permissionPolicy: allowAllPermissionPolicy,
            approvalBroker: allowApprovalBroker,
            executors: [blockingExecutor],
            defaultTimeoutMs: 5,
        });
        const timedOut = await timeoutRuntime.run({
            toolName: "readFile",
            input: { path: "README.md" },
            context: { ...context, signal: new AbortController().signal },
        });
        expect(timedOut.status).toBe("timed_out");
    });

    test("cancels and times out an already-running native bash process through Tool Runtime", async () => {
        const registry = new ToolRegistry(mergeAgentConfig({}, {}));
        const workspaceRoot = await createTempRoot("more-more-code-shell-runtime-");
        const runtime = new ToolRuntime({
            registry,
            permissionPolicy: allowAllPermissionPolicy,
            approvalBroker: allowApprovalBroker,
            executors: [{
                source: "native",
                execute(toolName, input, context) {
                    return executeNativeTool(toolName, input, {
                        workspaceRoot: context.workspaceRoot,
                        signal: context.signal,
                        processSandbox: directProcessSandbox,
                    });
                },
                resolveTimeoutMs(toolName, input) {
                    return resolveNativeToolTimeoutMs(toolName, input);
                },
            }],
        });
        const baseContext = {
            sessionId: "session-shell",
            runId: "run-shell",
            turnId: "turn-shell",
            stepId: "step-shell",
            toolCallId: "tool-call-shell",
            workspaceRoot,
            mode: "BUILD" as const,
        };

        const controller = new AbortController();
        const cancelStartedAt = Date.now();
        const pendingCancellation = runtime.run({
            toolName: "bash",
            input: { command: "sleep 5" },
            context: { ...baseContext, signal: controller.signal },
        });
        await Bun.sleep(50);
        controller.abort(new Error("interrupted"));
        const cancelled = await pendingCancellation;

        expect(cancelled.status).toBe("cancelled");
        expect(Date.now() - cancelStartedAt).toBeLessThan(2_000);

        const timeoutStartedAt = Date.now();
        const timedOut = await runtime.run({
            toolName: "bash",
            input: { command: "sleep 5", timeout: 50 },
            context: { ...baseContext, stepId: "step-timeout", signal: new AbortController().signal },
        });

        expect(timedOut.status).toBe("timed_out");
        expect(Date.now() - timeoutStartedAt).toBeLessThan(2_000);
    });

    test("permission policy can deny or defer a registered tool", async () => {
        const registry = new ToolRegistry(mergeAgentConfig({}, {}));
        const context = {
            sessionId: "session-1",
            runId: "run-1",
            turnId: "turn-1",
            stepId: "step-1",
            toolCallId: "tool-call-1",
            workspaceRoot: process.cwd(),
            mode: "BUILD" as const,
            signal: new AbortController().signal,
        };
        const createRuntime = (effect: "deny" | "ask") => new ToolRuntime({
            registry,
            executors: [{ source: "native", async execute() { return null; } }],
            permissionPolicy: { decide: () => ({ effect, policy: "configured" }) },
            approvalBroker: allowApprovalBroker,
        });

        expect((await createRuntime("deny").run({ toolName: "readFile", input: { path: "README.md" }, context })).status).toBe("denied");
        expect((await createRuntime("ask").run({ toolName: "readFile", input: { path: "README.md" }, context })).status).toBe("completed");
    });

    test("routes registered native tools through normalized runtime outcomes", async () => {
        const registry = new ToolRegistry(mergeAgentConfig({}, {}));
        let calls = 0;
        const runtime = new ToolRuntime({
            registry,
            permissionPolicy: allowAllPermissionPolicy,
            approvalBroker: allowApprovalBroker,
            executors: [{
                source: "native",
                async execute() {
                    calls += 1;
                    return { ok: true };
                },
            }],
        });
        const context = {
            sessionId: "session-1",
            runId: "run-1",
            turnId: "turn-1",
            stepId: "step-1",
            toolCallId: "tool-call-1",
            workspaceRoot: process.cwd(),
            mode: "BUILD" as const,
            signal: new AbortController().signal,
        };

        const completed = await runtime.run({
            toolName: "readFile",
            input: { path: "README.md" },
            context,
        });
        const denied = await runtime.run({
            toolName: "writeFile",
            input: { path: "x", content: "x" },
            context: { ...context, mode: "PLAN" },
        });

        expect(completed.status).toBe("completed");
        expect(completed.output).toEqual({ ok: true });
        expect(completed.durationMs).toBeGreaterThanOrEqual(0);
        expect(denied.status).toBe("denied");
        expect(calls).toBe(1);
    });

    test("awaits redacted Tool Runtime facts before executor side effects", async () => {
        const registry = new ToolRegistry(mergeAgentConfig({}, {}));
        const facts: unknown[] = [];
        let executorCalls = 0;
        const secret = "TOP-SECRET-COMMAND";
        const runtime = new ToolRuntime({
            registry,
            permissionPolicy: allowAllPermissionPolicy,
            approvalBroker: allowApprovalBroker,
            executors: [{
                source: "native",
                async execute() {
                    executorCalls += 1;
                    expect((facts.at(-1) as { type?: string }).type).toBe("permission_decided");
                    return { output: secret };
                },
            }],
            observer(event) {
                facts.push(structuredClone(event));
            },
        });
        const context = {
            sessionId: "session-observed",
            runId: "run-observed",
            turnId: "turn-observed",
            stepId: "step-observed",
            toolCallId: "tool-call-observed",
            workspaceRoot: process.cwd(),
            mode: "BUILD" as const,
            signal: new AbortController().signal,
        };

        await runtime.run({
            toolName: "readFile",
            input: { path: secret },
            context,
        });

        expect(executorCalls).toBe(1);
        expect(facts.map((fact) => (fact as { type: string }).type)).toEqual([
            "tool_requested",
            "permission_requested",
            "permission_decided",
            "tool_completed",
        ]);
        expect(JSON.stringify(facts)).not.toContain(secret);

        const failingRuntime = new ToolRuntime({
            registry,
            permissionPolicy: allowAllPermissionPolicy,
            approvalBroker: allowApprovalBroker,
            executors: [{
                source: "native",
                async execute() {
                    executorCalls += 1;
                    return null;
                },
            }],
            observer(event) {
                if (event.type === "tool_requested") {
                    throw new Error("runtime store unavailable");
                }
            },
        });
        await expect(failingRuntime.run({
            toolName: "readFile",
            input: { path: "README.md" },
            context,
        })).rejects.toThrow("runtime store unavailable");
        expect(executorCalls).toBe(1);
    });
});
