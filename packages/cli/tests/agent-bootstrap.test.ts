import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { mergeAgentConfig } from "../src/lib/agent-config";
import { loadAgentEnvironment } from "../src/lib/agent-environment";
import {
    buildSystemPrompt,
    getPromptPrefixSources,
    SYSTEM_PROMPT_VERSION,
} from "../src/lib/system-prompt";
import { createPromptPrefixIdentity } from "../src/lib/cache-identity";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
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
                skills: { enabled: false },
                tools: {
                    mcp: {
                        servers: {
                            globalDocs: { transport: "http", url: "https://example.test/mcp" },
                        },
                    },
                },
            },
            {
                skills: { enabled: true, directories: ["project-skills"] },
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
        expect(merged.skills.directories).toEqual(["project-skills"]);
        expect(Object.keys(merged.tools.mcp.servers).sort()).toEqual(["globalDocs", "projectTools"]);
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
});
