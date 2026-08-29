import {
    loadAgentConfig,
    mergeAgentConfig,
    saveAgentConfigModel,
    saveAgentConfigToolExecution,
    type ConfigScope,
    type AgentConfigBundle,
} from "./agent-config";
import type { AgentToolBatchExecution } from "@more-more-code/harness";
import {
    DEFAULT_CHAT_MODEL_REF,
    type ModelRef,
} from "@more-more-code/shared";
import {
    resolveInstructionChain,
    type ResolvedInstruction,
} from "./instruction-resolver";
import {
    createSkillRegistry,
    SkillRegistry,
} from "./skill-registry";
import { ToolRegistry } from "./tool-registry";
import {
    ProviderRegistry,
    type ProviderConfig,
} from "./provider-registry";
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
    /** Set when bootstrap repaired an invalid persisted default model. */
    modelRecovery: DefaultModelRecovery | null;
    loadedAt: number;
};

export type DefaultModelRecovery = {
    previous: ModelRef;
    fallback: ModelRef;
    reason: "provider-missing" | "provider-disabled" | "model-missing" | "no-enabled-models-repaired";
    persisted: boolean;
};

let currentEnvironment: AgentEnvironment | null = null;
let bootstrapOptions: AgentBootstrapOptions = {};
const environmentSubscribers = new Set<(environment: AgentEnvironment) => void>();

function publishAgentEnvironment(environment: AgentEnvironment) {
    for (const subscriber of environmentSubscribers) subscriber(environment);
}

// ProviderRegistry is deliberately a low-level file adapter. All CLI-owned
// provider/default mutations go through this AgentEnvironment queue so a later
// operation re-checks the persisted default after earlier queued work settles.
let agentEnvironmentMutationTail: Promise<void> = Promise.resolve();

function enqueueAgentEnvironmentMutation<T>(mutation: () => Promise<T>) {
    const result = agentEnvironmentMutationTail.then(mutation, mutation);
    agentEnvironmentMutationTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

function readPersistedAgentConfigForMutation() {
    // Bootstrap already owns layout creation. A mutation preflight must not
    // create config files merely to decide that it should fail closed.
    return loadAgentConfig({
        workspaceRoot: bootstrapOptions.workspaceRoot,
        globalHome: bootstrapOptions.globalHome,
        ensureLayout: false,
    });
}

function modelValidity(providers: readonly ProviderConfig[], model: ModelRef) {
    const provider = providers.find((candidate) => candidate.id === model.providerId);
    if (!provider) return "provider-missing" as const;
    if (!provider.enabled) return "provider-disabled" as const;
    if (!provider.models.includes(model.modelId)) return "model-missing" as const;
    return null;
}

export function isConfiguredLocalModel(
    providers: readonly ProviderConfig[],
    model: ModelRef,
) {
    return modelValidity(providers, model) === null;
}

/**
 * Prefer the code-owned default when it is available, then use a stable,
 * lexicographically ordered configured model. This keeps recovery predictable.
 */
export function resolveDeterministicModelFallback(
    providers: readonly ProviderConfig[],
    alsoValidIn: readonly ProviderConfig[] = providers,
): ModelRef | null {
    if (
        isConfiguredLocalModel(providers, DEFAULT_CHAT_MODEL_REF)
        && isConfiguredLocalModel(alsoValidIn, DEFAULT_CHAT_MODEL_REF)
    ) {
        return { ...DEFAULT_CHAT_MODEL_REF };
    }

    const candidates = providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models.map((modelId) => ({
            providerId: provider.id,
            modelId,
        })))
        .filter((model) => isConfiguredLocalModel(alsoValidIn, model))
        .sort((left, right) => left.providerId.localeCompare(right.providerId)
            || left.modelId.localeCompare(right.modelId));
    return candidates[0] ? { ...candidates[0] } : null;
}

function replaceProvider(
    providers: readonly ProviderConfig[],
    nextProvider: ProviderConfig,
) {
    const existing = providers.findIndex((provider) => provider.id === nextProvider.id);
    return existing < 0
        ? [...providers, structuredClone(nextProvider)]
        : providers.map((provider, index) => index === existing
            ? structuredClone(nextProvider)
            : structuredClone(provider));
}

function configWithInMemoryModel(
    config: AgentConfigBundle,
    model: ModelRef,
): AgentConfigBundle {
    const project = {
        ...config.project,
        model: { ...model },
    };
    return {
        ...config,
        project,
        resolved: mergeAgentConfig(config.global, project),
    };
}

async function repairNoEnabledModels(providers: ProviderRegistry) {
    const defaultProvider = providers.get(DEFAULT_CHAT_MODEL_REF.providerId);
    if (!defaultProvider) {
        throw new Error(`Cannot recover a local default: built-in provider '${DEFAULT_CHAT_MODEL_REF.providerId}' is missing.`);
    }
    await providers.saveProvider({
        ...defaultProvider,
        enabled: true,
        models: defaultProvider.models.includes(DEFAULT_CHAT_MODEL_REF.modelId)
            ? defaultProvider.models
            : [...defaultProvider.models, DEFAULT_CHAT_MODEL_REF.modelId],
    });
}

async function recoverDefaultModel(input: {
    config: AgentConfigBundle;
    providers: ProviderRegistry;
    options: AgentBootstrapOptions;
}) {
    const previous = input.config.resolved.model;
    const invalidity = modelValidity(input.providers.list(), previous);
    if (!invalidity) {
        return { config: input.config, recovery: null };
    }
    let reason: DefaultModelRecovery["reason"] = invalidity;

    let fallback = resolveDeterministicModelFallback(input.providers.list());
    if (!fallback) {
        await repairNoEnabledModels(input.providers);
        fallback = resolveDeterministicModelFallback(input.providers.list());
        if (!fallback) {
            throw new Error("Cannot recover a local default because no enabled provider model is configured.");
        }
        reason = "no-enabled-models-repaired";
    }

    let config: AgentConfigBundle;
    let persisted = true;
    try {
        config = await saveAgentConfigModel({
            model: fallback,
            scope: "project",
            workspaceRoot: input.options.workspaceRoot,
            globalHome: input.options.globalHome,
            ensureLayout: input.options.ensureLayout,
        });
    } catch {
        // The selected model is still valid for this run. Expose the failed
        // persistence through recovery metadata rather than making the CLI
        // permanently unable to start because of one stale default.
        config = configWithInMemoryModel(input.config, fallback);
        persisted = false;
    }

    return {
        config,
        recovery: {
            previous: { ...previous },
            fallback: { ...fallback },
            reason,
            persisted,
        } satisfies DefaultModelRecovery,
    };
}

export async function loadAgentEnvironment(
    options: AgentBootstrapOptions = {},
): Promise<AgentEnvironment> {
    const [loadedConfig, providers] = await Promise.all([
        loadAgentConfig(options),
        ProviderRegistry.load({
            globalHome: options.globalHome,
            ensureLayout: options.ensureLayout,
        }),
    ]);
    const { config, recovery } = await recoverDefaultModel({
        config: loadedConfig,
        providers,
        options,
    });
    const [instructions, skills] = await Promise.all([
        resolveInstructionChain(config),
        createSkillRegistry(config),
    ]);

    return {
        config,
        instructions,
        skills,
        tools: new ToolRegistry(config.resolved),
        providers,
        credentials: createCredentialStore({ globalHome: options.globalHome }),
        codexOAuth: new UnavailableCodexOAuthBroker(),
        modelRecovery: recovery,
        loadedAt: Date.now(),
    };
}

export async function bootstrapAgentEnvironment(
    options: AgentBootstrapOptions = {},
) {
    bootstrapOptions = { ...options };
    currentEnvironment = await loadAgentEnvironment(options);
    publishAgentEnvironment(currentEnvironment);
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
    publishAgentEnvironment(currentEnvironment);
    return currentEnvironment;
}

/** Subscribe to hot Agent source/ToolSet replacements without polling renders. */
export function subscribeAgentEnvironment(
    subscriber: (environment: AgentEnvironment) => void,
) {
    environmentSubscribers.add(subscriber);
    if (currentEnvironment) subscriber(currentEnvironment);
    return () => {
        environmentSubscribers.delete(subscriber);
    };
}

/**
 * Save a configured model as the local Agent Config default and update the
 * bootstrapped environment immediately. The provider check happens before the
 * file write so /models cannot persist an unusable default.
 */
export function persistAgentEnvironmentModel(
    model: ModelRef,
    scope: ConfigScope = "project",
) {
    return enqueueAgentEnvironmentMutation(async () => {
        const environment = getAgentEnvironment();
        const provider = environment.providers.get(model.providerId);
        if (!provider) {
            throw new Error(`Unknown provider '${model.providerId}'`);
        }
        if (!provider.enabled) {
            throw new Error(`Provider '${provider.id}' is disabled`);
        }
        if (!provider.models.includes(model.modelId)) {
            throw new Error(
                `Model '${model.modelId}' is not configured for provider '${provider.id}'`,
            );
        }

        const config = await saveAgentConfigModel({
            model,
            scope,
            workspaceRoot: bootstrapOptions.workspaceRoot,
            globalHome: bootstrapOptions.globalHome,
            ensureLayout: bootstrapOptions.ensureLayout,
        });
        currentEnvironment = {
            ...environment,
            config,
            loadedAt: Date.now(),
        };
        publishAgentEnvironment(currentEnvironment);
        return currentEnvironment;
    });
}

/** Persist /config Tool Batch policy through the serialized environment mutation queue. */
export function persistAgentEnvironmentToolExecution(
    execution: Partial<AgentToolBatchExecution>,
    scope: ConfigScope = "project",
) {
    return enqueueAgentEnvironmentMutation(async () => {
        const environment = getAgentEnvironment();
        const config = await saveAgentConfigToolExecution({
            execution,
            scope,
            workspaceRoot: bootstrapOptions.workspaceRoot,
            globalHome: bootstrapOptions.globalHome,
            ensureLayout: bootstrapOptions.ensureLayout,
        });
        currentEnvironment = {
            ...environment,
            config,
            loadedAt: Date.now(),
        };
        publishAgentEnvironment(currentEnvironment);
        return currentEnvironment;
    });
}

export type ProviderMutationOptions = {
    /**
     * The model selected by the mounted PromptConfig. It may differ from the
     * persisted default while a session is open. It is required for updates
     * and removals; creation does not invalidate an existing selection.
     */
    liveModel: ModelRef;
};

type ProtectedModelUse = {
    model: ModelRef;
    source: "persisted local default" | "current session";
};

function describeProtectedModelUses(uses: readonly ProtectedModelUse[]) {
    const grouped = new Map<string, ProtectedModelUse[]>();
    for (const use of uses) {
        const key = `${use.model.providerId}\u0000${use.model.modelId}`;
        const existing = grouped.get(key) ?? [];
        existing.push(use);
        grouped.set(key, existing);
    }
    return [...grouped.values()].map((group) => {
        const model = group[0]!.model;
        const sources = group.map((use) => use.source);
        const description = sources.length === 2
            ? "the persisted local default and current session"
            : `the ${sources[0]}`;
        return `${description} (${model.providerId}/${model.modelId})`;
    });
}

function mutationRemovesOrDisablesSelectedModel(
    currentProviders: readonly ProviderConfig[],
    nextProviders: readonly ProviderConfig[],
    model: ModelRef,
) {
    const currentProvider = currentProviders.find((provider) => provider.id === model.providerId);
    if (!currentProvider) return false;
    const nextProvider = nextProviders.find((provider) => provider.id === model.providerId);
    if (!nextProvider) return true;
    if (currentProvider.enabled && !nextProvider.enabled) return true;
    return currentProvider.models.includes(model.modelId)
        && !nextProvider.models.includes(model.modelId);
}

/**
 * Reject provider changes that remove or disable a protected selection.
 * This intentionally writes neither Agent Config nor the registry: users must
 * choose an available model through /models before destructive changes.
 */
function assertProviderMutationKeepsSelectedModels(input: {
    currentProviders: readonly ProviderConfig[];
    nextProviders: readonly ProviderConfig[];
    operation: string;
    persistedDefault: ModelRef;
    liveModel?: ModelRef;
}) {
    const selected: ProtectedModelUse[] = [{
        model: input.persistedDefault,
        source: "persisted local default",
    }];
    if (input.liveModel) {
        // Keep both sources in the message when they reference the same model.
        selected.push({ model: input.liveModel, source: "current session" });
    }

    const invalidated = selected.filter(({ model }) =>
        mutationRemovesOrDisablesSelectedModel(input.currentProviders, input.nextProviders, model));
    if (invalidated.length === 0) return;

    throw new Error(
        `Cannot ${input.operation} because it would invalidate ${describeProtectedModelUses(invalidated).join(" and ")}. Use /models to select an available model first, then try again.`,
    );
}

function requireLiveModel(
    options: ProviderMutationOptions | undefined,
    operation: string,
) {
    if (!options?.liveModel) {
        throw new Error(
            `Cannot ${operation} without the current session model. Use /models to select an available model before changing this provider.`,
        );
    }
    return { ...options.liveModel };
}

/**
 * Save a provider only when the change leaves the persisted local default and
 * supplied live session model usable. Unlike bootstrap recovery, this is
 * fail-closed and performs no compensating default-model write.
 */
export function saveAgentEnvironmentProvider(
    provider: ProviderConfig,
    options?: ProviderMutationOptions,
) {
    const requestedProvider = structuredClone(provider);
    const requestedLiveModel = options?.liveModel
        ? { ...options.liveModel }
        : undefined;
    return enqueueAgentEnvironmentMutation(async () => {
        const environment = getAgentEnvironment();
        const persistedConfig = await readPersistedAgentConfigForMutation();
        const currentProviders = environment.providers.list();
        const existing = currentProviders.find((candidate) => candidate.id === requestedProvider.id);
        const operation = `save changes to provider '${requestedProvider.id}'`;
        const liveModel = existing
            ? requireLiveModel(requestedLiveModel ? { liveModel: requestedLiveModel } : undefined, operation)
            : requestedLiveModel;
        const nextProviders = replaceProvider(currentProviders, requestedProvider);
        assertProviderMutationKeepsSelectedModels({
            currentProviders,
            nextProviders,
            operation,
            persistedDefault: persistedConfig.resolved.model,
            liveModel,
        });
        return environment.providers.saveProvider(requestedProvider);
    });
}

/** Same fail-closed protection for destructive custom-provider removal. */
export function removeAgentEnvironmentCustomProvider(
    providerId: string,
    options: ProviderMutationOptions,
) {
    const requestedLiveModel = options?.liveModel
        ? { ...options.liveModel }
        : undefined;
    return enqueueAgentEnvironmentMutation(async () => {
        const environment = getAgentEnvironment();
        const persistedConfig = await readPersistedAgentConfigForMutation();
        const provider = environment.providers.get(providerId);
        if (!provider) return false;
        if (provider.kind !== "custom") {
            throw new Error(`Built-in provider '${providerId}' cannot be removed`);
        }

        const operation = `remove provider '${providerId}'`;
        const currentProviders = environment.providers.list();
        const nextProviders = currentProviders.filter((candidate) => candidate.id !== providerId);
        assertProviderMutationKeepsSelectedModels({
            currentProviders,
            nextProviders,
            operation,
            persistedDefault: persistedConfig.resolved.model,
            liveModel: requireLiveModel(
                requestedLiveModel ? { liveModel: requestedLiveModel } : undefined,
                operation,
            ),
        });
        return environment.providers.removeCustomProvider(providerId);
    });
}
