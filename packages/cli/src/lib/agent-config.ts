import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import { z } from "zod";

export const MORE_MORE_CODE_DIR = ".more-more-code";
export const AGENT_CONFIG_FILE = "config.json";
export const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";

export type ConfigScope = "global" | "project";

const mcpServerSchema = z.object({
    enabled: z.boolean().optional(),
    transport: z.enum(["stdio", "http"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
});

const agentConfigFileSchema = z.object({
    version: z.literal(1).optional(),
    instructions: z.object({
        file: z.string().optional(),
    }).optional(),
    skills: z.object({
        enabled: z.boolean().optional(),
        directories: z.array(z.string()).optional(),
    }).optional(),
    tools: z.object({
        native: z.object({
            enabled: z.boolean().optional(),
        }).optional(),
        mcp: z.object({
            servers: z.record(z.string(), mcpServerSchema).optional(),
        }).optional(),
    }).optional(),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type AgentConfigFile = z.infer<typeof agentConfigFileSchema>;

export type ResolvedAgentConfig = {
    version: 1;
    instructions: {
        file: string;
    };
    skills: {
        enabled: boolean;
        directories: string[];
    };
    tools: {
        native: {
            enabled: boolean;
        };
        mcp: {
            servers: Record<string, McpServerConfig>;
        };
    };
};

export type AgentConfigPaths = {
    workspaceRoot: string;
    globalDir: string;
    projectDir: string;
    agentsSkillsDir: string;
    globalConfigPath: string;
    projectConfigPath: string;
    globalInstructionsPath: string;
    projectInstructionsPath: string;
};

export type AgentConfigBundle = {
    paths: AgentConfigPaths;
    global: AgentConfigFile;
    project: AgentConfigFile;
    resolved: ResolvedAgentConfig;
};

const DEFAULT_CONFIG: ResolvedAgentConfig = {
    version: 1,
    instructions: {
        file: AGENT_INSTRUCTIONS_FILE,
    },
    skills: {
        enabled: true,
        directories: ["skills"],
    },
    tools: {
        native: {
            enabled: true,
        },
        mcp: {
            servers: {},
        },
    },
};

const DEFAULT_GLOBAL_INSTRUCTIONS = `# MORE-MORE-CODE Global Instructions

- Follow the user's request and preserve existing work unless a change is required.
- Inspect relevant code before editing and verify meaningful changes when possible.
- Treat project-level instructions as more specific than these global defaults.
`;

const DEFAULT_PROJECT_INSTRUCTIONS = `# Project Instructions

Add project-specific coding rules, architecture constraints, verification commands, and repository conventions here.
`;

function cloneDefaultConfig(): ResolvedAgentConfig {
    return structuredClone(DEFAULT_CONFIG);
}

function serializeDefaultConfig() {
    return `${JSON.stringify(cloneDefaultConfig(), null, 2)}\n`;
}

async function writeIfMissing(path: string, content: string) {
    try {
        await writeFile(path, content, { encoding: "utf-8", flag: "wx" });
    } catch (error) {
        const code = error instanceof Error && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : null;
        if (code !== "EEXIST") throw error;
    }
}

export function resolveAgentConfigPaths(options: {
    workspaceRoot?: string;
    globalHome?: string;
} = {}): AgentConfigPaths {
    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    const globalHome = resolve(options.globalHome ?? homedir());
    const globalDir = join(globalHome, MORE_MORE_CODE_DIR);
    const projectDir = join(workspaceRoot, MORE_MORE_CODE_DIR);

    return {
        workspaceRoot,
        globalDir,
        projectDir,
        agentsSkillsDir: join(globalHome, ".agents", "skills"),
        globalConfigPath: join(globalDir, AGENT_CONFIG_FILE),
        projectConfigPath: join(projectDir, AGENT_CONFIG_FILE),
        globalInstructionsPath: join(globalDir, AGENT_INSTRUCTIONS_FILE),
        projectInstructionsPath: join(projectDir, AGENT_INSTRUCTIONS_FILE),
    };
}

export async function ensureAgentConfigLayout(paths: AgentConfigPaths) {
    await Promise.all([
        mkdir(paths.globalDir, { recursive: true }),
        mkdir(paths.projectDir, { recursive: true }),
        mkdir(join(paths.globalDir, "skills"), { recursive: true }),
        mkdir(join(paths.projectDir, "skills"), { recursive: true }),
    ]);

    await Promise.all([
        writeIfMissing(paths.globalConfigPath, serializeDefaultConfig()),
        writeIfMissing(paths.projectConfigPath, serializeDefaultConfig()),
        writeIfMissing(paths.globalInstructionsPath, DEFAULT_GLOBAL_INSTRUCTIONS),
        writeIfMissing(paths.projectInstructionsPath, DEFAULT_PROJECT_INSTRUCTIONS),
    ]);
}

async function readConfigFile(path: string): Promise<AgentConfigFile> {
    const raw = await readFile(path, "utf-8");
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in MORE-MORE-CODE config: ${path}`, { cause: error });
    }

    const result = agentConfigFileSchema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Invalid MORE-MORE-CODE config at ${path}: ${result.error.message}`);
    }
    return result.data;
}

export function mergeAgentConfig(
    globalConfig: AgentConfigFile,
    projectConfig: AgentConfigFile,
): ResolvedAgentConfig {
    const resolved = cloneDefaultConfig();

    const apply = (config: AgentConfigFile) => {
        if (config.instructions?.file !== undefined) {
            resolved.instructions.file = config.instructions.file;
        }
        if (config.skills?.enabled !== undefined) {
            resolved.skills.enabled = config.skills.enabled;
        }
        if (config.skills?.directories !== undefined) {
            resolved.skills.directories = [...config.skills.directories];
        }
        if (config.tools?.native?.enabled !== undefined) {
            resolved.tools.native.enabled = config.tools.native.enabled;
        }
        if (config.tools?.mcp?.servers) {
            resolved.tools.mcp.servers = {
                ...resolved.tools.mcp.servers,
                ...config.tools.mcp.servers,
            };
        }
    };

    apply(globalConfig);
    apply(projectConfig);
    return resolved;
}

export async function loadAgentConfig(options: {
    workspaceRoot?: string;
    globalHome?: string;
    ensureLayout?: boolean;
} = {}): Promise<AgentConfigBundle> {
    const paths = resolveAgentConfigPaths(options);
    if (options.ensureLayout !== false) {
        await ensureAgentConfigLayout(paths);
    }

    const [globalConfig, projectConfig] = await Promise.all([
        readConfigFile(paths.globalConfigPath),
        readConfigFile(paths.projectConfigPath),
    ]);

    return {
        paths,
        global: globalConfig,
        project: projectConfig,
        resolved: mergeAgentConfig(globalConfig, projectConfig),
    };
}
