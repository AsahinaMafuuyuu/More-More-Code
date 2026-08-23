import type { ProviderConfig } from "./provider-registry";
import type { CredentialStore } from "./credential-store";

export type CodexOAuthStatus =
    | { state: "unavailable"; message: string }
    | { state: "signed-out"; message?: string }
    | { state: "signed-in"; accountLabel?: string };

export interface CodexOAuthBroker {
    status(): Promise<CodexOAuthStatus>;
    getAccessToken(): Promise<string>;
    login?(): Promise<CodexOAuthStatus>;
    logout?(): Promise<void>;
}

export class UnavailableCodexOAuthBroker implements CodexOAuthBroker {
    async status(): Promise<CodexOAuthStatus> {
        return {
            state: "unavailable",
            message: "Codex OAuth provider execution is experimental and no supported broker is configured. Use OpenAI API-key authentication.",
        };
    }

    async getAccessToken(): Promise<string> {
        throw new Error(
            "Codex OAuth cannot be used for model execution because no supported broker is configured. Configure OpenAI API-key authentication instead.",
        );
    }
}

export type ResolvedProviderAuth =
    | { type: "none" }
    | { type: "api-key"; value: string }
    | { type: "bearer"; value: string }
    | { type: "codex-oauth"; value: string };

export async function resolveProviderAuth(input: {
    provider: ProviderConfig;
    credentialStore: CredentialStore;
    codexOAuthBroker: CodexOAuthBroker;
}): Promise<ResolvedProviderAuth> {
    const { provider, credentialStore, codexOAuthBroker } = input;
    if (provider.auth.type === "none") return { type: "none" };
    if (provider.auth.type === "codex-oauth") {
        return {
            type: "codex-oauth",
            value: await codexOAuthBroker.getAccessToken(),
        };
    }

    const value = await credentialStore.get(provider.auth.credentialRef);
    if (!value) {
        throw new Error(
            `Provider '${provider.id}' is missing credential '${provider.auth.credentialRef}'. Configure the credential before running a model.`,
        );
    }
    return { type: provider.auth.type, value };
}
