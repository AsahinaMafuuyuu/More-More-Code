import { z } from "zod";
import {
    Mode,
    getToolContracts as getNativeToolContracts,
    type ModeType,
    toolInputSchemas,
} from "@more-more-code/shared";
import type {
    AgentToolExecutionSafety,
    PermissionRequest,
    PermissionResource,
} from "@more-more-code/harness";
import type { McpServerConfig, ResolvedAgentConfig } from "./agent-config";
import { resolveWorkspacePath } from "./workspace-path";

export type ToolSourceKind = "native" | "mcp";

export type ToolCapability =
    | "filesystem.read"
    | "filesystem.write"
    | "process.execute"
    | "agent.skill.read";

const NATIVE_TOOL_CAPABILITIES: Record<string, ToolCapability[]> = {
    readFile: ["filesystem.read"],
    listDirectory: ["filesystem.read"],
    glob: ["filesystem.read"],
    grep: ["filesystem.read", "process.execute"],
    loadSkill: ["agent.skill.read"],
    writeFile: ["filesystem.write"],
    editFile: ["filesystem.read", "filesystem.write"],
    bash: ["process.execute"],
};

const NATIVE_TOOL_EXECUTION_SAFETY: Record<string, AgentToolExecutionSafety> = {
    readFile: { parallelSafe: true, effect: "read" },
    listDirectory: { parallelSafe: true, effect: "read" },
    glob: { parallelSafe: true, effect: "read" },
    grep: { parallelSafe: true, effect: "read" },
    loadSkill: { parallelSafe: true, effect: "read" },
    writeFile: { parallelSafe: false, effect: "write" },
    editFile: { parallelSafe: false, effect: "write" },
    bash: { parallelSafe: false, effect: "process" },
};

export type RegisteredToolDefinition = {
    name: string;
    source: ToolSourceKind;
    description: string;
    capabilities: ToolCapability[];
    executionSafety: AgentToolExecutionSafety;
    availableModes: ModeType[];
};

export type ToolSetSnapshotEntry = RegisteredToolDefinition & {
    inputSchema: unknown;
};

export type ToolSetSnapshot = ToolSetSnapshotEntry[];

export type ToolSourceDescriptor =
    | {
        kind: "native";
        name: "native";
        enabled: boolean;
        tools: string[];
    }
    | {
        kind: "mcp";
        name: string;
        enabled: boolean;
        config: McpServerConfig;
        tools: string[];
    };

export class ToolRegistry {
    private readonly config: ResolvedAgentConfig;

    constructor(config: ResolvedAgentConfig) {
        this.config = config;
    }

    getModelTools(mode: ModeType) {
        if (!this.config.tools.native.enabled) return {};
        return getNativeToolContracts(mode);
    }

    listNativeToolNames(mode: ModeType = Mode.BUILD) {
        return Object.keys(getNativeToolContracts(mode)).sort((a, b) => a.localeCompare(b));
    }

    getToolSetSnapshot(mode: ModeType): ToolSetSnapshot {
        if (!this.config.tools.native.enabled) return [];

        const planNames = new Set(this.listNativeToolNames(Mode.PLAN));
        const buildNames = new Set(this.listNativeToolNames(Mode.BUILD));
        const tools = getNativeToolContracts(mode);

        return Object.entries(tools)
            .map(([name, contract]) => ({
                name,
                source: "native" as const,
                description: typeof contract.description === "string" ? contract.description : "",
                inputSchema: z.toJSONSchema(contract.inputSchema as z.ZodType),
                capabilities: [...(NATIVE_TOOL_CAPABILITIES[name] ?? [])],
                executionSafety: {
                    ...(NATIVE_TOOL_EXECUTION_SAFETY[name]
                        ?? { parallelSafe: false, effect: "unknown" as const }),
                },
                availableModes: [
                    ...(planNames.has(name) ? [Mode.PLAN] : []),
                    ...(buildNames.has(name) ? [Mode.BUILD] : []),
                ],
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    getToolDefinition(
        name: string,
        mode: ModeType,
        source: ToolSourceKind = "native",
    ): RegisteredToolDefinition | null {
        if (source !== "native" || !this.config.tools.native.enabled) return null;
        const contract = Object.entries(getNativeToolContracts(mode))
            .find(([toolName]) => toolName === name)?.[1];
        if (!contract) return null;

        const planNames = new Set(this.listNativeToolNames(Mode.PLAN));
        const buildNames = new Set(this.listNativeToolNames(Mode.BUILD));
        return {
            name,
            source,
            description: typeof contract.description === "string" ? contract.description : "",
            capabilities: [...(NATIVE_TOOL_CAPABILITIES[name] ?? [])],
            executionSafety: {
                ...(NATIVE_TOOL_EXECUTION_SAFETY[name]
                    ?? { parallelSafe: false, effect: "unknown" as const }),
            },
            availableModes: [
                ...(planNames.has(name) ? [Mode.PLAN] : []),
                ...(buildNames.has(name) ? [Mode.BUILD] : []),
            ],
        };
    }

    async getPermissionRequests(
        tool: RegisteredToolDefinition,
        input: unknown,
        workspaceRoot: string,
    ): Promise<PermissionRequest[]> {
        const resource = await resolveToolPermissionResource(
            tool.name,
            tool.source,
            input,
            workspaceRoot,
        );
        const capabilities = tool.capabilities.length > 0
            ? tool.capabilities
            : [`tool.${tool.name}`];

        return capabilities.map((capability) => ({
            capability,
            resource,
        }));
    }

    listSources(): ToolSourceDescriptor[] {
        const sources: ToolSourceDescriptor[] = [
            {
                kind: "native",
                name: "native",
                enabled: this.config.tools.native.enabled,
                tools: this.listNativeToolNames(),
            },
        ];

        for (const [name, config] of Object.entries(this.config.tools.mcp.servers)) {
            sources.push({
                kind: "mcp",
                name,
                enabled: config.enabled !== false,
                config,
                // Tool discovery belongs to the future MCP transport adapter.
                tools: [],
            });
        }

        return sources;
    }
}

const PATH_TOOL_NAMES = new Set([
    "readFile",
    "listDirectory",
    "glob",
    "grep",
    "writeFile",
    "editFile",
]);

async function resolveToolPermissionResource(
    toolName: string,
    source: ToolSourceKind,
    input: unknown,
    workspaceRoot: string,
): Promise<PermissionResource> {
    if (source === "native" && PATH_TOOL_NAMES.has(toolName)) {
        const schema = toolInputSchemas[toolName as keyof typeof toolInputSchemas];
        const parsed = schema.safeParse(input);
        if (parsed.success && "path" in parsed.data && typeof parsed.data.path === "string") {
            const resolved = await resolveWorkspacePath(workspaceRoot, parsed.data.path);
            return {
                kind: "path",
                value: resolved.resourcePath,
                scope: resolved.scope,
                caseSensitive: process.platform !== "win32",
            };
        }
    }

    if (source === "native" && toolName === "bash") {
        const parsed = toolInputSchemas.bash.safeParse(input);
        if (parsed.success) {
            return {
                kind: "command",
                value: parsed.data.command,
                scope: "workspace",
            };
        }
    }

    if (source === "native" && toolName === "loadSkill") {
        const parsed = toolInputSchemas.loadSkill.safeParse(input);
        if (parsed.success) {
            return {
                kind: "resource",
                value: `skill:${parsed.data.name}`,
                scope: "agent-config",
            };
        }
    }

    return {
        kind: "resource",
        value: `tool:${toolName}`,
        scope: source === "mcp" ? "external" : "workspace",
    };
}
