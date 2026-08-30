import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bootstrapAgentEnvironment } from "../src/lib/agent-environment";
import { defaultCredentialRef } from "../src/lib/provider-registry";
import { EnvironmentCredentialStore } from "../src/lib/credential-store";
import {
    getConfiguredModelOptions,
    normalizeModelRef,
    resolveChatModel,
} from "../src/lib/models";
import { resolveModelContextProfile } from "../src/lib/model-context-profile";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
    ));
});

async function bootstrap() {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-provider-model-"));
    temporaryDirectories.push(root);
    return bootstrapAgentEnvironment({
        globalHome: path.join(root, "home"),
        workspaceRoot: path.join(root, "workspace"),
    });
}

describe("provider model resolution", () => {
    test("migrates legacy recommended model IDs deterministically", () => {
        expect(normalizeModelRef("gpt-5.5")).toEqual({ providerId: "openai", modelId: "gpt-5.5" });
        expect(normalizeModelRef("legacy-custom", "my-provider")).toEqual({
            providerId: "my-provider",
            modelId: "legacy-custom",
        });
        expect(() => normalizeModelRef("unknown-legacy-model")).toThrow("cannot be migrated deterministically");
    });

    test("resolves multiple custom providers through one ModelRef seam", async () => {
        const environment = await bootstrap();
        await environment.providers.saveProvider({
            id: "custom-a",
            kind: "custom",
            displayName: "Custom A",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://a.example.com/v1",
            models: ["model-a"],
            auth: { type: "api-key", credentialRef: defaultCredentialRef("custom-a") },
        });
        await environment.providers.saveProvider({
            id: "custom-b",
            kind: "custom",
            displayName: "Custom B",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "http://127.0.0.1:8080/v1",
            models: ["model-b"],
            auth: { type: "none" },
        });
        await environment.credentials.set(defaultCredentialRef("custom-a"), "test-key");

        const first = await resolveChatModel({ providerId: "custom-a", modelId: "model-a" }, environment);
        const second = await resolveChatModel({ providerId: "custom-b", modelId: "model-b" }, environment);

        expect(first).toMatchObject({ provider: "custom", providerId: "custom-a", modelId: "model-a" });
        expect(second).toMatchObject({ provider: "custom", providerId: "custom-b", modelId: "model-b" });
    });

    test("fails missing credentials before model execution and keeps Codex OAuth explicitly unavailable", async () => {
        const environment = await bootstrap();
        environment.credentials = new EnvironmentCredentialStore({});

        await expect(resolveChatModel({ providerId: "openai", modelId: "gpt-5.5" }, environment))
            .rejects.toThrow("missing credential");

        const openai = environment.providers.get("openai");
        expect(openai?.kind).toBe("openai");
        if (!openai || openai.kind !== "openai") throw new Error("OpenAI provider missing");
        await environment.providers.saveProvider({ ...openai, auth: { type: "codex-oauth" } });

        await expect(resolveChatModel({ providerId: "openai", modelId: "gpt-5.5" }, environment))
            .rejects.toThrow("documented OpenAI Responses contract");
    });

    test("uses conservative provider defaults for configured unknown models", () => {
        const profile = resolveModelContextProfile(
            { providerId: "custom-a", modelId: "future-model" },
            "custom",
        );
        expect(profile.contextWindowTokens).toBe(128_000);
        expect(profile.reservedOutputTokens).toBe(12_288);
        expect(profile.tokenCounter.id).toBe("openai-compatible-estimator-v1");
    });

    test("exposes non-secret model reasoning options without resolving credentials", async () => {
        const environment = await bootstrap();
        expect(getConfiguredModelOptions({
            providerId: "deepseek",
            modelId: "deepseek-v4-flash",
        }, environment)).toEqual({ reasoningEffort: "medium" });
        expect(getConfiguredModelOptions({
            providerId: "openai",
            modelId: "gpt-5.5",
        }, environment)).toBeUndefined();
    });
});
