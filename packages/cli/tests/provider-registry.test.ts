import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    ProviderRegistry,
    createDefaultProviderRegistryFile,
    defaultCredentialRef,
    resolveProviderRegistryPath,
} from "../src/lib/provider-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
    ));
});

async function createHome() {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-provider-registry-"));
    temporaryDirectories.push(root);
    return path.join(root, "home");
}

describe("ProviderRegistry", () => {
    test("creates exactly four built-in providers on first run", async () => {
        const home = await createHome();
        const registry = await ProviderRegistry.load({ globalHome: home });

        expect(registry.list().map((provider) => provider.id)).toEqual([
            "openai",
            "anthropic",
            "google",
            "deepseek",
        ]);
        expect(registry.list().some((provider) => provider.id.includes("mistral"))).toBe(false);
    });

    test("supports multiple stable custom provider IDs and persists no credential value", async () => {
        const home = await createHome();
        const registry = await ProviderRegistry.load({ globalHome: home });

        await registry.saveProvider({
            id: "openrouter",
            kind: "custom",
            displayName: "OpenRouter",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://openrouter.ai/api/v1",
            models: ["model-a"],
            auth: { type: "bearer", credentialRef: defaultCredentialRef("openrouter") },
        });
        await registry.saveProvider({
            id: "local-llm",
            kind: "custom",
            displayName: "Local LLM",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "http://127.0.0.1:11434/v1",
            models: ["local-model"],
            auth: { type: "none" },
        });

        const reloaded = await ProviderRegistry.load({ globalHome: home });
        expect(reloaded.get("openrouter")?.kind).toBe("custom");
        expect(reloaded.get("local-llm")?.kind).toBe("custom");
        expect(reloaded.listModelRefs()).toContainEqual({ providerId: "openrouter", modelId: "model-a" });
        expect(reloaded.listModelRefs()).toContainEqual({ providerId: "local-llm", modelId: "local-model" });

        const persisted = await readFile(resolveProviderRegistryPath(home), "utf-8");
        expect(persisted).toContain(defaultCredentialRef("openrouter"));
        expect(persisted).not.toContain("TOP-SECRET-CREDENTIAL");
    });

    test("rejects unknown fields, duplicate IDs, persisted custom headers, and credential-bearing URLs", async () => {
        const home = await createHome();
        await ProviderRegistry.load({ globalHome: home });
        const registryPath = resolveProviderRegistryPath(home);
        const baseline = createDefaultProviderRegistryFile();

        await writeFile(registryPath, JSON.stringify({ ...baseline, unexpected: true }));
        await expect(ProviderRegistry.load({ globalHome: home })).rejects.toThrow("Invalid provider registry");

        await writeFile(registryPath, JSON.stringify({
            ...baseline,
            providers: [...baseline.providers, baseline.providers[0]],
        }));
        await expect(ProviderRegistry.load({ globalHome: home })).rejects.toThrow("Duplicate provider ID");

        await writeFile(registryPath, JSON.stringify(baseline));
        const registry = await ProviderRegistry.load({ globalHome: home });

        await expect(registry.saveProvider({
            id: "bad-url",
            kind: "custom",
            displayName: "Bad URL",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://user:secret@example.com/v1",
            models: ["x"],
            auth: { type: "none" },
        })).rejects.toThrow("credentials");

        await expect(registry.saveProvider({
            id: "bad-header",
            kind: "custom",
            displayName: "Bad Header",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://example.com/v1",
            models: ["x"],
            auth: { type: "none" },
            headers: { Authorization: "secret" },
        } as never)).rejects.toThrow();

        await expect(registry.saveProvider({
            id: "plaintext-secret",
            kind: "custom",
            displayName: "Plaintext Secret",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://example.com/v1",
            models: ["x"],
            auth: { type: "api-key", credentialRef: defaultCredentialRef("plaintext-secret") },
            apiKey: "TOP-SECRET-CREDENTIAL",
        } as never)).rejects.toThrow();

        await expect(registry.saveProvider({
            id: "endpoint-as-base-url",
            kind: "custom",
            displayName: "Endpoint as base URL",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://example.com/v1/chat/completions",
            models: ["x"],
            auth: { type: "none" },
        })).rejects.toThrow("API root");

        await expect(registry.saveProvider({
            id: "query-secret",
            kind: "custom",
            displayName: "Query Secret",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://example.com/v1?api_key=TOP-SECRET-CREDENTIAL",
            models: ["x"],
            auth: { type: "none" },
        })).rejects.toThrow("query parameters");
    });
});
