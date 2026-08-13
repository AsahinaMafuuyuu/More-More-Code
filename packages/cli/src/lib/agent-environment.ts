import {
    loadAgentConfig,
    type AgentConfigBundle,
} from "./agent-config";
import {
    resolveInstructionChain,
    type ResolvedInstruction,
} from "./instruction-resolver";
import {
    createSkillRegistry,
    SkillRegistry,
} from "./skill-registry";
import { ToolRegistry } from "./tool-registry";

export type AgentBootstrapOptions = {
    workspaceRoot?: string;
    globalHome?: string;
    ensureLayout?: boolean;
};

export type AgentEnvironment = {
    config: AgentConfigBundle;
    instructions: ResolvedInstruction[];
    skills: SkillRegistry;
    tools: ToolRegistry;
    loadedAt: number;
};

let currentEnvironment: AgentEnvironment | null = null;
let bootstrapOptions: AgentBootstrapOptions = {};

export async function loadAgentEnvironment(
    options: AgentBootstrapOptions = {},
): Promise<AgentEnvironment> {
    const config = await loadAgentConfig(options);
    const [instructions, skills] = await Promise.all([
        resolveInstructionChain(config),
        createSkillRegistry(config),
    ]);

    return {
        config,
        instructions,
        skills,
        tools: new ToolRegistry(config.resolved),
        loadedAt: Date.now(),
    };
}

export async function bootstrapAgentEnvironment(
    options: AgentBootstrapOptions = {},
) {
    bootstrapOptions = { ...options };
    currentEnvironment = await loadAgentEnvironment(options);
    return currentEnvironment;
}

export function getAgentEnvironment() {
    if (!currentEnvironment) {
        throw new Error("Agent environment has not been bootstrapped");
    }
    return currentEnvironment;
}

export async function reloadAgentEnvironment() {
    currentEnvironment = await loadAgentEnvironment(bootstrapOptions);
    return currentEnvironment;
}
