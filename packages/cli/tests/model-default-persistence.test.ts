import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    bootstrapAgentEnvironment,
    getAgentEnvironment,
    persistAgentEnvironmentModel,
    removeAgentEnvironmentCustomProvider,
    saveAgentEnvironmentProvider,
} from "../src/lib/agent-environment";
import { saveAgentConfigModel } from "../src/lib/agent-config";
import type { ProviderConfig } from "../src/lib/provider-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
    ));
});

test("persists a /models selection as the project-local default and restores it after bootstrap", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-model-default-"));
    temporaryDirectories.push(root);
    const options = {
        globalHome: path.join(root, "home"),
        workspaceRoot: path.join(root, "workspace"),
    };

    await bootstrapAgentEnvironment(options);
    await persistAgentEnvironmentModel({
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
    });

    expect(getAgentEnvironment().config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
    });

    await bootstrapAgentEnvironment(options);
    expect(getAgentEnvironment().config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
    });
});

function createCustomProvider(models = ["custom-model"], enabled = true): ProviderConfig {
    return {
        id: "local-custom",
        kind: "custom",
        displayName: "Local Custom",
        enabled,
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:11434/v1",
        models,
        auth: { type: "none" },
    };
}

async function createOptions() {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-model-recovery-"));
    temporaryDirectories.push(root);
    return {
        globalHome: path.join(root, "home"),
        workspaceRoot: path.join(root, "workspace"),
    };
}

async function selectCustomDefault(provider = createCustomProvider()) {
    await saveAgentEnvironmentProvider(provider);
    await persistAgentEnvironmentModel({
        providerId: provider.id,
        modelId: provider.models[0]!,
    });
}

async function expectFailClosedWithoutMutation(action: () => Promise<unknown>) {
    const environment = getAgentEnvironment();
    const defaultBefore = structuredClone(environment.config.resolved.model);
    const providersBefore = environment.providers.list();
    const filesBefore = await Promise.all([
        readFile(environment.config.paths.projectConfigPath, "utf-8"),
        readFile(environment.providers.path, "utf-8"),
    ]);

    await expect(action()).rejects.toThrow("Use /models to select an available model first");
    expect(getAgentEnvironment().config.resolved.model).toEqual(defaultBefore);
    expect(getAgentEnvironment().providers.list()).toEqual(providersBefore);
    await expect(Promise.all([
        readFile(environment.config.paths.projectConfigPath, "utf-8"),
        readFile(environment.providers.path, "utf-8"),
    ])).resolves.toEqual(filesBefore);
}

test("fails closed before removing, disabling, or editing the selected local default", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const customModel = { providerId: "local-custom", modelId: "custom-model" };
    const fallbackModel = { providerId: "deepseek", modelId: "deepseek-v4-flash" };

    await selectCustomDefault();
    await expectFailClosedWithoutMutation(() =>
        removeAgentEnvironmentCustomProvider("local-custom", { liveModel: customModel }));
    await persistAgentEnvironmentModel(fallbackModel);
    await removeAgentEnvironmentCustomProvider("local-custom", { liveModel: fallbackModel });
    expect(getAgentEnvironment().providers.get("local-custom")).toBeNull();

    await selectCustomDefault();
    await expectFailClosedWithoutMutation(() =>
        saveAgentEnvironmentProvider(createCustomProvider(["custom-model"], false), { liveModel: customModel }));
    await persistAgentEnvironmentModel(fallbackModel);
    await saveAgentEnvironmentProvider(createCustomProvider(["custom-model"], false), { liveModel: fallbackModel });
    expect(getAgentEnvironment().providers.get("local-custom")?.enabled).toBe(false);

    await saveAgentEnvironmentProvider(createCustomProvider(), { liveModel: fallbackModel });
    await persistAgentEnvironmentModel(customModel);
    await expectFailClosedWithoutMutation(() =>
        saveAgentEnvironmentProvider(createCustomProvider(["replacement-model"]), { liveModel: customModel }));
    await persistAgentEnvironmentModel(fallbackModel);
    await saveAgentEnvironmentProvider(createCustomProvider(["replacement-model"]), { liveModel: fallbackModel });
    expect(getAgentEnvironment().providers.get("local-custom")?.models).toEqual(["replacement-model"]);
});

test("fails closed for a current session model that differs from the persisted local default", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const customModel = { providerId: "local-custom", modelId: "custom-model" };
    const defaultModel = { providerId: "deepseek", modelId: "deepseek-v4-flash" };

    await saveAgentEnvironmentProvider(createCustomProvider(), { liveModel: defaultModel });
    await expectFailClosedWithoutMutation(() =>
        removeAgentEnvironmentCustomProvider("local-custom", { liveModel: customModel }));
    await removeAgentEnvironmentCustomProvider("local-custom", { liveModel: defaultModel });

    await saveAgentEnvironmentProvider(createCustomProvider(), { liveModel: defaultModel });
    await expectFailClosedWithoutMutation(() =>
        saveAgentEnvironmentProvider(createCustomProvider(["custom-model"], false), { liveModel: customModel }));
    await saveAgentEnvironmentProvider(createCustomProvider(["custom-model"], false), { liveModel: defaultModel });

    await saveAgentEnvironmentProvider(createCustomProvider(), { liveModel: defaultModel });
    await expectFailClosedWithoutMutation(() =>
        saveAgentEnvironmentProvider(createCustomProvider(["replacement-model"]), { liveModel: customModel }));
    await saveAgentEnvironmentProvider(createCustomProvider(["replacement-model"]), { liveModel: defaultModel });
    expect(getAgentEnvironment().providers.get("local-custom")?.models).toEqual(["replacement-model"]);
});

test("requires a live session model before mutating an existing provider", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    await saveAgentEnvironmentProvider(createCustomProvider());

    const environment = getAgentEnvironment();
    const defaultBefore = structuredClone(environment.config.resolved.model);
    const providersBefore = environment.providers.list();
    const filesBefore = await Promise.all([
        readFile(environment.config.paths.projectConfigPath, "utf-8"),
        readFile(environment.providers.path, "utf-8"),
    ]);
    await expect(saveAgentEnvironmentProvider(createCustomProvider(["custom-model"], false))).rejects.toThrow(
        "without the current session model",
    );

    expect(getAgentEnvironment().config.resolved.model).toEqual(defaultBefore);
    expect(getAgentEnvironment().providers.list()).toEqual(providersBefore);
    await expect(Promise.all([
        readFile(environment.config.paths.projectConfigPath, "utf-8"),
        readFile(environment.providers.path, "utf-8"),
    ])).resolves.toEqual(filesBefore);
});

test("re-reads the persisted default instead of trusting a stale in-memory environment", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const customModel = { providerId: "local-custom", modelId: "custom-model" };
    const inMemoryDefault = structuredClone(getAgentEnvironment().config.resolved.model);
    await saveAgentEnvironmentProvider(createCustomProvider());

    // Simulate another local config writer: the live environment remains on
    // DeepSeek, while the persisted default now selects the custom provider.
    await saveAgentConfigModel({
        model: customModel,
        scope: "project",
        workspaceRoot: options.workspaceRoot,
        globalHome: options.globalHome,
    });
    expect(getAgentEnvironment().config.resolved.model).toEqual(inMemoryDefault);

    await expectFailClosedWithoutMutation(() =>
        removeAgentEnvironmentCustomProvider("local-custom", { liveModel: inMemoryDefault }));
    expect(getAgentEnvironment().providers.get("local-custom")).not.toBeNull();
});

test("serializes a queued model selection before provider removal and rechecks the persisted default", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const customModel = { providerId: "local-custom", modelId: "custom-model" };
    const previousLiveModel = { providerId: "deepseek", modelId: "deepseek-v4-flash" };
    await saveAgentEnvironmentProvider(createCustomProvider());

    const selectCustom = persistAgentEnvironmentModel(customModel);
    const removeCustom = removeAgentEnvironmentCustomProvider("local-custom", {
        liveModel: previousLiveModel,
    });

    await expect(selectCustom).resolves.toMatchObject({
        config: { resolved: { model: customModel } },
    });
    await expect(removeCustom).rejects.toThrow("Use /models to select an available model first");
    expect(getAgentEnvironment().config.resolved.model).toEqual(customModel);
    expect(getAgentEnvironment().providers.get("local-custom")).not.toBeNull();
});

test("serializes a queued model selection before an edit removes that model", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const customModel = { providerId: "local-custom", modelId: "custom-model" };
    const previousLiveModel = { providerId: "deepseek", modelId: "deepseek-v4-flash" };
    await saveAgentEnvironmentProvider(createCustomProvider(["custom-model", "other-model"]));

    const selectCustom = persistAgentEnvironmentModel(customModel);
    const removeSelectedModel = saveAgentEnvironmentProvider(
        createCustomProvider(["other-model"]),
        { liveModel: previousLiveModel },
    );

    await expect(selectCustom).resolves.toMatchObject({
        config: { resolved: { model: customModel } },
    });
    await expect(removeSelectedModel).rejects.toThrow("Use /models to select an available model first");
    expect(getAgentEnvironment().config.resolved.model).toEqual(customModel);
    expect(getAgentEnvironment().providers.get("local-custom")?.models).toEqual([
        "custom-model",
        "other-model",
    ]);
});

test("does not change the local default when a registry write fails", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const environment = getAgentEnvironment();
    const defaultBefore = structuredClone(environment.config.resolved.model);
    const defaultFileBefore = await readFile(environment.config.paths.projectConfigPath, "utf-8");
    const registry = environment.providers;
    const originalSaveProvider = registry.saveProvider;
    let writeAttempts = 0;
    registry.saveProvider = async () => {
        writeAttempts += 1;
        throw new Error("simulated provider registry write failure");
    };

    try {
        await expect(saveAgentEnvironmentProvider(createCustomProvider())).rejects.toThrow(
            "simulated provider registry write failure",
        );
    } finally {
        registry.saveProvider = originalSaveProvider;
    }

    expect(writeAttempts).toBe(1);
    expect(getAgentEnvironment().config.resolved.model).toEqual(defaultBefore);
    await expect(readFile(environment.config.paths.projectConfigPath, "utf-8")).resolves.toBe(defaultFileBefore);
    expect(getAgentEnvironment().providers.get("local-custom")).toBeNull();
});

test("bootstrap repairs a stale custom default produced outside the guarded UI path", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const provider = createCustomProvider();

    // Simulate an old CLI or a manually edited registry that bypassed the
    // guarded mutation APIs. Bootstrap must still become usable.
    await getAgentEnvironment().providers.saveProvider(provider);
    await persistAgentEnvironmentModel({ providerId: provider.id, modelId: "custom-model" });
    await getAgentEnvironment().providers.removeCustomProvider(provider.id);

    const recovered = await bootstrapAgentEnvironment(options);
    expect(recovered.config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
    });
    expect(recovered.modelRecovery).toMatchObject({
        previous: { providerId: "local-custom", modelId: "custom-model" },
        fallback: { providerId: "deepseek", modelId: "deepseek-v4-flash" },
        reason: "provider-missing",
        persisted: true,
    });

    const restarted = await bootstrapAgentEnvironment(options);
    expect(restarted.config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
    });
    expect(restarted.modelRecovery).toBeNull();
});

test("bootstrap repairs stale disabled and missing-model defaults", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);
    const provider = createCustomProvider();
    await getAgentEnvironment().providers.saveProvider(provider);
    await persistAgentEnvironmentModel({ providerId: provider.id, modelId: "custom-model" });

    await getAgentEnvironment().providers.saveProvider(createCustomProvider(["custom-model"], false));
    await expectFailClosedWithoutMutation(() =>
        removeAgentEnvironmentCustomProvider(provider.id, {
            liveModel: { providerId: provider.id, modelId: "custom-model" },
        }));
    const disabledRecovery = await bootstrapAgentEnvironment(options);
    expect(disabledRecovery.config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
    });
    expect(disabledRecovery.modelRecovery?.reason).toBe("provider-disabled");

    await getAgentEnvironment().providers.saveProvider(provider);
    await persistAgentEnvironmentModel({ providerId: provider.id, modelId: "custom-model" });
    await getAgentEnvironment().providers.saveProvider(createCustomProvider(["replacement-model"]));
    await expectFailClosedWithoutMutation(() =>
        removeAgentEnvironmentCustomProvider(provider.id, {
            liveModel: { providerId: provider.id, modelId: "custom-model" },
        }));
    const modelRecovery = await bootstrapAgentEnvironment(options);
    expect(modelRecovery.config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
    });
    expect(modelRecovery.modelRecovery?.reason).toBe("model-missing");
});

test("bootstrap repairs an externally corrupted registry with no enabled model", async () => {
    const options = await createOptions();
    await bootstrapAgentEnvironment(options);

    for (const provider of getAgentEnvironment().providers.list()) {
        await getAgentEnvironment().providers.saveProvider({
            ...provider,
            enabled: false,
            models: [],
        });
    }

    const recovered = await bootstrapAgentEnvironment(options);
    expect(recovered.config.resolved.model).toEqual({
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
    });
    expect(recovered.modelRecovery?.reason).toBe("no-enabled-models-repaired");
    expect(recovered.providers.get("deepseek")).toMatchObject({
        enabled: true,
        models: expect.arrayContaining(["deepseek-v4-flash"]),
    });
});
