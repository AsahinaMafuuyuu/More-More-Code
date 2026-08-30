import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import type {
    AgentToolBatchExecution,
    PermissionEffect,
    PermissionRule,
    PermissionScope,
} from "@more-more-code/harness";
import { MAX_TOOL_BATCH_CONCURRENCY } from "@more-more-code/harness";
import {
    DEFAULT_CHAT_MODEL_REF,
    type ModelRef,
} from "@more-more-code/shared";

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

const permissionEffectSchema = z.enum(["allow", "deny", "ask"]);
const permissionScopeSchema = z.enum([
    "workspace",
    "outside-workspace",
    "agent-config",
    "external",
]);
const permissionPatternsSchema = z.array(z.string().trim().min(1)).min(1);
const permissionRuleSchema = z.object({
    effect: permissionEffectSchema,
    capabilities: permissionPatternsSchema.optional(),
    commands: permissionPatternsSchema.optional(),
    paths: permissionPatternsSchema.optional(),
    resources: permissionPatternsSchema.optional(),
    scopes: z.array(permissionScopeSchema).min(1).optional(),
});
const sandboxModeSchema = z.enum(["off", "auto", "required"]);
const sandboxNetworkSchema = z.enum(["inherit", "deny"]);
const sandboxEnvironmentSchema = z.enum(["inherit", "safe"]);
const toolExecutionModeSchema = z.enum(["serial", "parallel"]);
const toolExecutionConcurrencySchema = z.number()
    .int()
    .min(1)
    .max(MAX_TOOL_BATCH_CONCURRENCY);
const toolExecutionPatchSchema = z.object({
    mode: toolExecutionModeSchema.optional(),
    maxConcurrency: toolExecutionConcurrencySchema.optional(),
}).strict().refine(
    (value) => value.mode !== undefined || value.maxConcurrency !== undefined,
    "Expected at least one Tool execution field",
);
const environmentVariableNameSchema = z.string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Expected an environment variable name");

const modelRefSchema = z.object({
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
}).strict();

const agentConfigFileSchema = z.object({
    version: z.literal(1).optional(),
    model: modelRefSchema.optional(),
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
        execution: z.object({
            mode: toolExecutionModeSchema.optional(),
            maxConcurrency: toolExecutionConcurrencySchema.optional(),
        }).strict().optional(),
        mcp: z.object({
            servers: z.record(z.string(), mcpServerSchema).optional(),
        }).optional(),
    }).optional(),
    session: z.object({
        branchSummaryOnJump: z.enum(["ask", "always", "never"]).optional(),
    }).optional(),
    permissions: z.object({
        default: permissionEffectSchema.optional(),
        rules: z.array(permissionRuleSchema).optional(),
    }).optional(),
    sandbox: z.object({
        mode: sandboxModeSchema.optional(),
        network: sandboxNetworkSchema.optional(),
        environment: sandboxEnvironmentSchema.optional(),
        envAllow: z.array(environmentVariableNameSchema).optional(),
    }).strict().optional(),
}).strict();

export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type PermissionRuleConfig = z.infer<typeof permissionRuleSchema>;
export type AgentConfigFile = z.infer<typeof agentConfigFileSchema>;

export type ResolvedAgentConfig = {
    version: 1;
    model: ModelRef;
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
        execution: {
            mode: z.infer<typeof toolExecutionModeSchema>;
            maxConcurrency: number;
        };
        mcp: {
            servers: Record<string, McpServerConfig>;
        };
    };
    session: {
        branchSummaryOnJump: "ask" | "always" | "never";
    };
    permissions: {
        default: PermissionEffect;
        rules: Array<PermissionRule & { policy: "configured" }>;
    };
    sandbox: {
        mode: z.infer<typeof sandboxModeSchema>;
        network: z.infer<typeof sandboxNetworkSchema>;
        environment: z.infer<typeof sandboxEnvironmentSchema>;
        envAllow: string[];
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
    model: { ...DEFAULT_CHAT_MODEL_REF },
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
        execution: {
            mode: "serial",
            maxConcurrency: 4,
        },
        mcp: {
            servers: {},
        },
    },
    session: {
        branchSummaryOnJump: "ask",
    },
    permissions: {
        default: "allow",
        rules: [],
    },
    sandbox: {
        mode: "auto",
        network: "inherit",
        environment: "safe",
        envAllow: [],
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
    return `${JSON.stringify({
        ...cloneDefaultConfig(),
        // An omitted default means the code-owned policy remains authoritative;
        // only explicit user values become configured catch-all overrides.
        permissions: { rules: [] },
    }, null, 2)}\n`;
}

function serializeAgentConfig(config: AgentConfigFile) {
    return `${JSON.stringify(config, null, 2)}\n`;
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

async function atomicWriteConfig(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, { encoding: "utf-8", mode: 0o600 });
    await rename(temporaryPath, path);
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
        if (config.model !== undefined) {
            resolved.model = { ...config.model };
        }
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
        if (config.tools?.execution?.mode !== undefined) {
            resolved.tools.execution.mode = config.tools.execution.mode;
        }
        if (config.tools?.execution?.maxConcurrency !== undefined) {
            resolved.tools.execution.maxConcurrency = config.tools.execution.maxConcurrency;
        }
        if (config.tools?.mcp?.servers) {
            resolved.tools.mcp.servers = {
                ...resolved.tools.mcp.servers,
                ...config.tools.mcp.servers,
            };
        }
        if (config.session?.branchSummaryOnJump !== undefined) {
            resolved.session.branchSummaryOnJump = config.session.branchSummaryOnJump;
        }
        if (config.permissions?.default !== undefined) {
            resolved.permissions.rules.push({
                effect: config.permissions.default,
                policy: "configured",
            });
        }
        if (config.permissions?.rules) {
            resolved.permissions.rules.push(...config.permissions.rules.map((rule) => ({
                ...structuredClone(rule),
                scopes: rule.scopes as PermissionScope[] | undefined,
                policy: "configured" as const,
            })));
        }
        if (config.sandbox?.mode !== undefined) {
            resolved.sandbox.mode = config.sandbox.mode;
        }
        if (config.sandbox?.network !== undefined) {
            resolved.sandbox.network = config.sandbox.network;
        }
        if (config.sandbox?.environment !== undefined) {
            resolved.sandbox.environment = config.sandbox.environment;
        }
        if (config.sandbox?.envAllow !== undefined) {
            resolved.sandbox.envAllow = [...config.sandbox.envAllow];
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

/**
 * Persist the model selected through /models into normal Agent Config storage.
 * Project scope is the local default: it follows the existing global-then-
 * project precedence and is restored on the next CLI bootstrap.
 */
export async function saveAgentConfigModel(input: {
    model: ModelRef;
    scope?: ConfigScope;
    workspaceRoot?: string;
    globalHome?: string;
    ensureLayout?: boolean;
}): Promise<AgentConfigBundle> {
    const scope = input.scope ?? "project";
    const model = modelRefSchema.parse(input.model);
    const paths = resolveAgentConfigPaths({
        workspaceRoot: input.workspaceRoot,
        globalHome: input.globalHome,
    });
    if (input.ensureLayout !== false) {
        await ensureAgentConfigLayout(paths);
    }

    const [globalConfig, projectConfig] = await Promise.all([
        readConfigFile(paths.globalConfigPath),
        readConfigFile(paths.projectConfigPath),
    ]);
    const nextGlobal = scope === "global"
        ? agentConfigFileSchema.parse({ ...globalConfig, model })
        : globalConfig;
    const nextProject = scope === "project"
        ? agentConfigFileSchema.parse({ ...projectConfig, model })
        : projectConfig;

    await atomicWriteConfig(
        scope === "global" ? paths.globalConfigPath : paths.projectConfigPath,
        serializeAgentConfig(scope === "global" ? nextGlobal : nextProject),
    );

    return {
        paths,
        global: nextGlobal,
        project: nextProject,
        resolved: mergeAgentConfig(nextGlobal, nextProject),
    };
}

/**
 * Persist a typed Tool Batch execution override through the same Agent Config
 * authority used by /config. Nested config objects are merged rather than
 * replaced so changing execution policy cannot discard native/MCP settings.
 */
export async function saveAgentConfigToolExecution(input: {
    execution: Partial<AgentToolBatchExecution>;
    scope?: ConfigScope;
    workspaceRoot?: string;
    globalHome?: string;
    ensureLayout?: boolean;
}): Promise<AgentConfigBundle> {
    const scope = input.scope ?? "project";
    const execution = toolExecutionPatchSchema.parse(input.execution);
    const paths = resolveAgentConfigPaths({
        workspaceRoot: input.workspaceRoot,
        globalHome: input.globalHome,
    });
    if (input.ensureLayout !== false) {
        await ensureAgentConfigLayout(paths);
    }

    const [globalConfig, projectConfig] = await Promise.all([
        readConfigFile(paths.globalConfigPath),
        readConfigFile(paths.projectConfigPath),
    ]);
    const applyExecutionPatch = (config: AgentConfigFile): AgentConfigFile => agentConfigFileSchema.parse({
        ...config,
        tools: {
            ...config.tools,
            execution: {
                ...config.tools?.execution,
                ...execution,
            },
        },
    });
    const nextGlobal = scope === "global" ? applyExecutionPatch(globalConfig) : globalConfig;
    const nextProject = scope === "project" ? applyExecutionPatch(projectConfig) : projectConfig;

    await atomicWriteConfig(
        scope === "global" ? paths.globalConfigPath : paths.projectConfigPath,
        serializeAgentConfig(scope === "global" ? nextGlobal : nextProject),
    );

    return {
        paths,
        global: nextGlobal,
        project: nextProject,
        resolved: mergeAgentConfig(nextGlobal, nextProject),
    };
}
