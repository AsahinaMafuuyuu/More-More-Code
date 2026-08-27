import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/lib/credential-store";
import { UnavailableCodexOAuthBroker } from "../src/lib/provider-auth";
import type { ProviderConfig } from "../src/lib/provider-registry";
import {
    ProviderConnectionError,
    resolveProviderRequestPreview,
    testProviderConnection,
} from "../src/lib/provider-runtime";

const secret = "provider-test-secret";

const customProvider: ProviderConfig = {
    id: "custom-test",
    kind: "custom",
    displayName: "Custom Test",
    enabled: true,
    protocol: "openai-compatible",
    baseURL: "https://gateway.example.test/v1/",
    models: ["test-model"],
    auth: { type: "api-key", credentialRef: "provider:custom-test:api-key" },
};

const openAIProvider: ProviderConfig = {
    id: "openai",
    kind: "openai",
    displayName: "OpenAI",
    enabled: true,
    models: ["gpt-5.5"],
    auth: { type: "api-key", credentialRef: "provider:openai:api-key" },
};

const anthropicProvider: ProviderConfig = {
    id: "anthropic",
    kind: "anthropic",
    displayName: "Anthropic",
    enabled: true,
    models: ["claude-test"],
    auth: { type: "api-key", credentialRef: "provider:anthropic:api-key" },
};

function credentials(value: string | null): CredentialStore {
    return {
        async get() { return value; },
        async set() {},
        async delete() { return false; },
    };
}

describe("provider connection validation", () => {
    test("resolves the exact credential-free custom Chat Completions URL", () => {
        expect(resolveProviderRequestPreview(customProvider, "test-model")).toEqual({
            providerId: "custom-test",
            modelId: "test-model",
            method: "POST",
            protocol: "openai-chat-completions",
            url: "https://gateway.example.test/v1/chat/completions",
        });
    });

    test("uses an injected fetch for a minimum-output connection probe without returning the credential", async () => {
        let requestURL = "";
        let requestHeaders = new Headers();
        let requestBody = "";
        const result = await testProviderConnection({
            provider: customProvider,
            modelId: "test-model",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async (input, init) => {
                requestURL = String(input);
                requestHeaders = new Headers(init?.headers);
                requestBody = String(init?.body);
                return new Response(JSON.stringify({ id: "probe" }), { status: 200 });
            },
        });

        expect(result).toMatchObject({
            status: 200,
            url: "https://gateway.example.test/v1/chat/completions",
        });
        expect(JSON.stringify(result)).not.toContain(secret);
        expect(requestURL).toBe(result.url);
        expect(requestHeaders.get("authorization")).toBe(`Bearer ${secret}`);
        expect(requestBody).toContain('"model":"test-model"');
        expect(requestBody).toContain('"max_tokens":1');
    });

    test("does not add an authorization header for an explicitly unauthenticated provider", async () => {
        const noAuthProvider: ProviderConfig = {
            ...customProvider,
            id: "custom-no-auth",
            auth: { type: "none" },
        };
        let requestHeaders = new Headers();
        await testProviderConnection({
            provider: noAuthProvider,
            modelId: "test-model",
            credentialStore: credentials(null),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async (_input, init) => {
                requestHeaders = new Headers(init?.headers);
                return new Response(null, { status: 200 });
            },
        });

        expect(requestHeaders.get("authorization")).toBeNull();
        expect(requestHeaders.get("x-api-key")).toBeNull();
    });

    test("classifies missing credentials and never calls the transport", async () => {
        let transportCalled = false;
        await expect(testProviderConnection({
            provider: customProvider,
            modelId: "test-model",
            credentialStore: credentials(null),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async () => {
                transportCalled = true;
                return new Response(null, { status: 200 });
            },
        })).rejects.toMatchObject({
            kind: "credential",
            message: expect.stringContaining("Re-enter the API key"),
        });
        expect(transportCalled).toBe(false);
    });

    test("classifies model, protocol, and network failures without returning provider response text", async () => {
        const common = {
            provider: customProvider,
            modelId: "test-model",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
        };

        await expect(testProviderConnection({
            ...common,
            fetch: async () => new Response(
                JSON.stringify({ error: { code: "model_not_found", message: "secret response detail" } }),
                { status: 404 },
            ),
        })).rejects.toMatchObject({
            kind: "model",
            message: expect.not.stringContaining("secret response detail"),
        });

        await expect(testProviderConnection({
            ...common,
            fetch: async () => new Response("endpoint missing", { status: 404 }),
        })).rejects.toMatchObject({
            kind: "protocol",
            message: expect.stringContaining("Verify the API root"),
        });

        await expect(testProviderConnection({
            ...common,
            fetch: async () => {
                throw new Error("network secret detail");
            },
        })).rejects.toMatchObject({
            kind: "network",
            message: expect.not.stringContaining("network secret detail"),
        });
    });

    test("bounds provider error-body reads and applies the timeout while reading them", async () => {
        let oversizedBodyCancelled = false;
        const oversizedBody = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`endpoint missing ${"x".repeat(8_192)}`));
            },
            cancel() {
                oversizedBodyCancelled = true;
            },
        });
        await expect(testProviderConnection({
            provider: customProvider,
            modelId: "test-model",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async () => new Response(oversizedBody, { status: 404 }),
        })).rejects.toMatchObject({ kind: "protocol" });
        expect(oversizedBodyCancelled).toBe(true);

        let stalledBodyCancelled = false;
        const stalledBody = new ReadableStream<Uint8Array>({
            pull() {
                return new Promise<void>(() => {});
            },
            cancel() {
                stalledBodyCancelled = true;
            },
        });
        await expect(testProviderConnection({
            provider: customProvider,
            modelId: "test-model",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            timeoutMs: 20,
            fetch: async () => new Response(stalledBody, { status: 404 }),
        })).rejects.toMatchObject({ kind: "network" });
        expect(stalledBodyCancelled).toBe(true);
    });

    test("uses protocol-specific endpoint recovery hints", async () => {
        await expect(testProviderConnection({
            provider: openAIProvider,
            modelId: "gpt-5.5",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async () => new Response("endpoint missing", { status: 404 }),
        })).rejects.toMatchObject({
            kind: "protocol",
            message: expect.stringContaining("OpenAI Responses API"),
        });

        await expect(testProviderConnection({
            provider: anthropicProvider,
            modelId: "claude-test",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async () => new Response("endpoint missing", { status: 404 }),
        })).rejects.toMatchObject({
            kind: "protocol",
            message: expect.stringContaining("Anthropic Messages API"),
        });
    });

    test("returns a configuration error before invoking transport for disabled providers", async () => {
        const disabled: ProviderConfig = { ...customProvider, enabled: false };
        await expect(testProviderConnection({
            provider: disabled,
            modelId: "test-model",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async () => new Response(null, { status: 200 }),
        })).rejects.toBeInstanceOf(ProviderConnectionError);
        await expect(testProviderConnection({
            provider: disabled,
            modelId: "test-model",
            credentialStore: credentials(secret),
            codexOAuthBroker: new UnavailableCodexOAuthBroker(),
            fetch: async () => new Response(null, { status: 200 }),
        })).rejects.toMatchObject({ kind: "configuration" });
    });
});
