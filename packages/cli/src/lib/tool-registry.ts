import { z } from "zod";
import {
    Mode,
    getToolContracts as getNativeToolContracts,
    type ModeType,
} from "@more-more-code/shared";
import type { McpServerConfig, ResolvedAgentConfig } from "./agent-config";

export type ToolSourceKind = "native" | "mcp";

export type ToolSetSnapshotEntry = {
    name: string;
    source: ToolSourceKind;
    description: string;
    inputSchema: unknown;
    availableModes: ModeType[];
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
                availableModes: [
                    ...(planNames.has(name) ? [Mode.PLAN] : []),
                    ...(buildNames.has(name) ? [Mode.BUILD] : []),
                ],
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
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
