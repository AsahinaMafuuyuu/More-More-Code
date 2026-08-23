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
import { ProviderRegistry } from "./provider-registry";
import { createCredentialStore, type CredentialStore } from "./credential-store";
import {
    UnavailableCodexOAuthBroker,
    type CodexOAuthBroker,
} from "./provider-auth";

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
    providers: ProviderRegistry;
    credentials: CredentialStore;
    codexOAuth: CodexOAuthBroker;
    loadedAt: number;
};

let currentEnvironment: AgentEnvironment | null = null;
let bootstrapOptions: AgentBootstrapOptions = {};

export async function loadAgentEnvironment(
    options: AgentBootstrapOptions = {},
): Promise<AgentEnvironment> {
    const config = await loadAgentConfig(options);
    const [instructions, skills, providers] = await Promise.all([
        resolveInstructionChain(config),
        createSkillRegistry(config),
        ProviderRegistry.load({
            globalHome: options.globalHome,
            ensureLayout: options.ensureLayout,
        }),
    ]);
    const selectedProvider = providers.get(config.resolved.model.providerId);
    if (!selectedProvider) {
        throw new Error(`Configured model provider '${config.resolved.model.providerId}' does not exist`);
    }
    if (!selectedProvider.enabled) {
        throw new Error(`Configured model provider '${selectedProvider.id}' is disabled`);
    }
    if (!selectedProvider.models.includes(config.resolved.model.modelId)) {
        throw new Error(
            `Configured model '${config.resolved.model.modelId}' is not registered for provider '${selectedProvider.id}'`,
        );
    }

    return {
        config,
        instructions,
        skills,
        tools: new ToolRegistry(config.resolved),
        providers,
        credentials: createCredentialStore({ globalHome: options.globalHome }),
        codexOAuth: new UnavailableCodexOAuthBroker(),
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
