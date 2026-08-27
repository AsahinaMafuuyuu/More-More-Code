import type { ProviderConfig } from "./provider-registry";
import type { CredentialStore } from "./credential-store";

export type CodexOAuthStatus =
    | { state: "unavailable"; message: string }
    | { state: "signed-out"; message?: string }
    | { state: "signed-in"; accountLabel?: string };

/**
 * A Codex login is not, by itself, an OpenAI model-execution credential.
 *
 * A broker must opt into this explicit contract before the CLI can expose
 * Codex OAuth as a model provider. The documentation URL is intentionally
 * part of the contract so an implementation cannot silently rely on an
 * undocumented bearer-token convention.
 */
export type CodexOAuthModelExecutionContract = {
    protocol: "openai-responses";
    documentationURL: string;
};

export interface CodexOAuthBroker {
    status(): Promise<CodexOAuthStatus>;
    getAccessToken(): Promise<string>;
    login?(): Promise<CodexOAuthStatus>;
    logout?(): Promise<void>;
    modelExecutionContract?(): CodexOAuthModelExecutionContract | null;
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

    modelExecutionContract() {
        return null;
    }
}

function isOfficialOpenAIDocumentationURL(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        const officialResponsesDocs = url.hostname === "platform.openai.com"
            || url.hostname === "developers.openai.com";
        return officialResponsesDocs && /\/responses(?:\/|$)/i.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * Returns the execution contract only when the broker has explicitly supplied
 * an OpenAI-owned documentation URL for the Responses transport.
 */
export function getCodexOAuthModelExecutionContract(
    broker: CodexOAuthBroker,
): CodexOAuthModelExecutionContract | null {
    const contract = broker.modelExecutionContract?.() ?? null;
    if (
        contract?.protocol !== "openai-responses"
        || !isOfficialOpenAIDocumentationURL(contract.documentationURL)
    ) {
        return null;
    }
    return { ...contract };
}

export function canUseCodexOAuthForModelExecution(broker: CodexOAuthBroker) {
    return getCodexOAuthModelExecutionContract(broker) !== null;
}

export type ProviderAuthFailureKind = "credential" | "oauth";

/** Error text is deliberately credential-safe and can be shown in the CLI. */
export class ProviderAuthError extends Error {
    constructor(
        readonly kind: ProviderAuthFailureKind,
        message: string,
    ) {
        super(message);
        this.name = "ProviderAuthError";
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
        if (!canUseCodexOAuthForModelExecution(codexOAuthBroker)) {
            throw new ProviderAuthError(
                "oauth",
                "Codex OAuth is unavailable for model execution because this CLI has no broker with a documented OpenAI Responses contract. Configure an OpenAI API key instead.",
            );
        }
        let value: string;
        try {
            value = await codexOAuthBroker.getAccessToken();
        } catch {
            throw new ProviderAuthError(
                "oauth",
                "Codex OAuth could not provide a model-execution credential. Configure an OpenAI API key instead.",
            );
        }
        if (!value) {
            throw new ProviderAuthError(
                "oauth",
                "Codex OAuth did not provide a model-execution credential. Configure an OpenAI API key instead.",
            );
        }
        return {
            type: "codex-oauth",
            value,
        };
    }

    let value: string | null;
    try {
        value = await credentialStore.get(provider.auth.credentialRef);
    } catch {
        throw new ProviderAuthError(
            "credential",
            `Provider '${provider.id}' could not read its local credential. Store the credential again before running a model.`,
        );
    }
    if (!value) {
        throw new ProviderAuthError(
            "credential",
            `Provider '${provider.id}' is missing credential '${provider.auth.credentialRef}'. Configure the credential before running a model.`,
        );
    }
    return { type: provider.auth.type, value };
}
