import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/lib/credential-store";
import {
    canUseCodexOAuthForModelExecution,
    resolveProviderAuth,
    type CodexOAuthBroker,
} from "../src/lib/provider-auth";
import type { ProviderConfig } from "../src/lib/provider-registry";

const openAIOAuthProvider: ProviderConfig = {
    id: "openai",
    kind: "openai",
    displayName: "OpenAI",
    enabled: true,
    models: ["gpt-5.5"],
    auth: { type: "codex-oauth" },
};

const unusedCredentials: CredentialStore = {
    async get() { return null; },
    async set() {},
    async delete() { return false; },
};

function createBroker(input: {
    documentationURL?: string;
    token?: string;
    throwTokenError?: boolean;
} = {}): CodexOAuthBroker {
    return {
        async status() { return { state: "signed-in" }; },
        async getAccessToken() {
            if (input.throwTokenError) throw new Error("oauth-secret-must-not-leak");
            return input.token ?? "oauth-test-token";
        },
        ...(input.documentationURL ? {
            modelExecutionContract: () => ({
                protocol: "openai-responses" as const,
                documentationURL: input.documentationURL!,
            }),
        } : {}),
    };
}

describe("Codex OAuth model-execution gating", () => {
    test("keeps OAuth unavailable without an explicit documented execution contract", async () => {
        const broker = createBroker();

        expect(canUseCodexOAuthForModelExecution(broker)).toBe(false);
        await expect(resolveProviderAuth({
            provider: openAIOAuthProvider,
            credentialStore: unusedCredentials,
            codexOAuthBroker: broker,
        })).rejects.toMatchObject({
            kind: "oauth",
            message: expect.stringContaining("documented OpenAI Responses contract"),
        });
    });

    test("accepts only an explicit OpenAI-documented Responses contract", async () => {
        const broker = createBroker({
            documentationURL: "https://platform.openai.com/docs/api-reference/responses",
            token: "oauth-test-token",
        });

        expect(canUseCodexOAuthForModelExecution(broker)).toBe(true);
        await expect(resolveProviderAuth({
            provider: openAIOAuthProvider,
            credentialStore: unusedCredentials,
            codexOAuthBroker: broker,
        })).resolves.toEqual({ type: "codex-oauth", value: "oauth-test-token" });
    });

    test("rejects non-execution documentation", () => {
        const broker = createBroker({
            documentationURL: "https://learn.chatgpt.com/docs/auth",
        });

        expect(canUseCodexOAuthForModelExecution(broker)).toBe(false);
    });

    test("never exposes a broker token error", async () => {
        const broker = createBroker({
            documentationURL: "https://platform.openai.com/docs/api-reference/responses",
            throwTokenError: true,
        });

        await expect(resolveProviderAuth({
            provider: openAIOAuthProvider,
            credentialStore: unusedCredentials,
            codexOAuthBroker: broker,
        })).rejects.toMatchObject({
            kind: "oauth",
            message: expect.not.stringContaining("oauth-secret-must-not-leak"),
        });
    });
});
