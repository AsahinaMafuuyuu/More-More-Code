import type { ModeType } from "@more-more-code/shared";
import type {
    CacheMissClassification,
    ContextEpochId,
    PromptPrefixIdentity,
    RenderedPrefixDigest,
} from "./cache-identity";
import type { CredentialStore } from "./credential-store";
import type { ResolvedModel } from "./models";
import {
    ProviderAuthError,
    resolveProviderAuth,
    type CodexOAuthBroker,
} from "./provider-auth";
import type { ProviderConfig } from "./provider-registry";
import type { ProviderUsage } from "./provider-usage";
import { BUILT_IN_PROVIDER_BASE_URLS } from "./provider-endpoints";

export type ProviderRequestCompilation = {
    protocol: ProviderRequestProtocol;
    cacheKey?: string;
};

/** The exact model-execution protocol selected by the local provider adapter. */
export type ProviderRequestProtocol =
    | "openai-responses"
    | "anthropic-messages"
    | "openai-chat-completions"
    | "google-generative-ai";

/**
 * Credential-free request information suitable for UI display and diagnostics.
 * It intentionally excludes headers and request bodies because either could
 * contain a credential.
 */
export type ProviderRequestPreview = {
    providerId: string;
    modelId: string;
    method: "POST";
    protocol: ProviderRequestProtocol;
    url: string;
};

export type ProviderConnectionFailureKind =
    | "credential"
    | "oauth"
    | "configuration"
    | "protocol"
    | "http"
    | "model"
    | "network";

/**
 * A safe-to-render connection error. It never contains a credential, request
 * headers, or a raw provider response body.
 */
export class ProviderConnectionError extends Error {
    constructor(
        readonly kind: ProviderConnectionFailureKind,
        message: string,
        readonly preview?: ProviderRequestPreview,
        readonly status?: number,
    ) {
        super(message);
        this.name = "ProviderConnectionError";
    }
}

export type ProviderConnectionTestResult = ProviderRequestPreview & {
    status: number;
};

/** A narrow fetch seam: unlike Bun's global fetch it does not require static helpers. */
export type ProviderConnectionFetch = (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
) => Promise<Response>;

function safeRequestURL(value: string) {
    const url = new URL(value);
    // Registry validation disallows these components. Keeping this redaction at
    // the diagnostic boundary prevents a malformed in-memory config from ever
    // making a credential visible in the UI or an error message.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
}

function appendEndpoint(baseURL: string, endpoint: string) {
    const base = new URL(baseURL);
    if (base.username || base.password || base.search || base.hash) {
        throw new Error("Provider base URL cannot include credentials, query parameters, or fragments");
    }
    return safeRequestURL(`${base.toString().replace(/\/+$/, "")}${endpoint}`);
}

function assertConfiguredProbe(provider: ProviderConfig, modelId: string) {
    if (!provider.enabled) {
        throw new ProviderConnectionError(
            "configuration",
            `Provider '${provider.id}' is disabled. Enable it before testing a connection.`,
        );
    }
    if (!modelId.trim()) {
        throw new ProviderConnectionError(
            "configuration",
            `Provider '${provider.id}' has no model selected for the connection test.`,
        );
    }
    if (!provider.models.includes(modelId)) {
        throw new ProviderConnectionError(
            "model",
            `Model '${modelId}' is not configured for provider '${provider.id}'. Add it in /providers before testing.`,
        );
    }
}

/**
 * Resolve the final URL used by the local runtime for a provider/model pair.
 * Custom providers use OpenAI Chat Completions; built-ins keep their native
 * model protocol, matching resolveChatModel().
 */
export function resolveProviderRequestPreview(
    provider: ProviderConfig,
    modelId: string,
): ProviderRequestPreview {
    assertConfiguredProbe(provider, modelId);

    try {
        switch (provider.kind) {
            case "openai":
                return {
                    providerId: provider.id,
                    modelId,
                    method: "POST",
                    protocol: "openai-responses",
                    url: `${BUILT_IN_PROVIDER_BASE_URLS.openai}/responses`,
                };
            case "anthropic":
                return {
                    providerId: provider.id,
                    modelId,
                    method: "POST",
                    protocol: "anthropic-messages",
                    url: `${BUILT_IN_PROVIDER_BASE_URLS.anthropic}/messages`,
                };
            case "deepseek":
                return {
                    providerId: provider.id,
                    modelId,
                    method: "POST",
                    protocol: "openai-chat-completions",
                    url: `${BUILT_IN_PROVIDER_BASE_URLS.deepseek}/chat/completions`,
                };
            case "google":
                return {
                    providerId: provider.id,
                    modelId,
                    method: "POST",
                    protocol: "google-generative-ai",
                    url: `${BUILT_IN_PROVIDER_BASE_URLS.google}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
                };
            case "custom":
                return {
                    providerId: provider.id,
                    modelId,
                    method: "POST",
                    protocol: "openai-chat-completions",
                    url: appendEndpoint(provider.baseURL, "/chat/completions"),
                };
        }
    } catch (error) {
        if (error instanceof ProviderConnectionError) throw error;
        throw new ProviderConnectionError(
            "configuration",
            `Provider '${provider.id}' has an invalid base URL. Use the API root (for example, https://host.example/v1) without a request endpoint or credential.`,
        );
    }
}

function createProbeBody(preview: ProviderRequestPreview) {
    switch (preview.protocol) {
        case "openai-responses":
            return JSON.stringify({
                model: preview.modelId,
                input: "Reply only with OK.",
                max_output_tokens: 1,
                store: false,
            });
        case "anthropic-messages":
            return JSON.stringify({
                model: preview.modelId,
                max_tokens: 1,
                messages: [{ role: "user", content: "Reply only with OK." }],
            });
        case "openai-chat-completions":
            return JSON.stringify({
                model: preview.modelId,
                messages: [{ role: "user", content: "Reply only with OK." }],
                max_tokens: 1,
            });
        case "google-generative-ai":
            return JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "Reply only with OK." }] }],
                generationConfig: { maxOutputTokens: 1 },
            });
    }
}

function createProbeHeaders(input: {
    provider: ProviderConfig;
    auth: Awaited<ReturnType<typeof resolveProviderAuth>>;
}) {
    const headers = new Headers({
        accept: "application/json",
        "content-type": "application/json",
    });
    if (input.provider.kind === "anthropic") {
        headers.set("anthropic-version", "2023-06-01");
        if (input.auth.type !== "api-key") {
            throw new ProviderConnectionError(
                "configuration",
                `Provider '${input.provider.id}' must use API-key authentication for the Anthropic Messages protocol.`,
            );
        }
        headers.set("x-api-key", input.auth.value);
        return headers;
    }

    if (input.provider.kind === "google") {
        if (input.auth.type !== "api-key") {
            throw new ProviderConnectionError(
                "configuration",
                `Provider '${input.provider.id}' must use API-key authentication for the Google Generative AI protocol.`,
            );
        }
        headers.set("x-goog-api-key", input.auth.value);
        return headers;
    }

    if (input.auth.type !== "none") {
        headers.set("authorization", `Bearer ${input.auth.value}`);
    }
    return headers;
}

const MAX_PROVIDER_ERROR_MARKER_BYTES = 4_096;

async function getProviderErrorMarker(response: Response, abortSignal: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) return "";

    let abortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => {
            void reader.cancel();
            reject(new DOMException("Provider connection test timed out", "AbortError"));
        };
        if (abortSignal.aborted) abortListener();
        else abortSignal.addEventListener("abort", abortListener, { once: true });
    });
    const readMarker = async () => {
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        let bytesRead = 0;
        try {
            while (bytesRead < MAX_PROVIDER_ERROR_MARKER_BYTES) {
                const next = await reader.read();
                if (next.done) break;
                const remaining = MAX_PROVIDER_ERROR_MARKER_BYTES - bytesRead;
                const chunk = next.value.byteLength > remaining
                    ? next.value.slice(0, remaining)
                    : next.value;
                chunks.push(decoder.decode(chunk, { stream: true }));
                bytesRead += chunk.byteLength;
                if (chunk.byteLength < next.value.byteLength) break;
            }
            chunks.push(decoder.decode());
            return chunks.join("").toLowerCase();
        } finally {
            void reader.cancel();
        }
    };

    try {
        return await Promise.race([readMarker(), aborted]);
    } catch (error) {
        if (abortSignal.aborted) throw error;
        return "";
    } finally {
        if (abortListener) abortSignal.removeEventListener("abort", abortListener);
    }
}

function classifyHttpFailure(status: number, marker: string): ProviderConnectionFailureKind {
    if (status === 401 || status === 403) return "credential";
    if (/\b(model|deployment)[^\n]{0,120}\b(not[ -]?found|does not exist|invalid|unavailable)|\b(model_not_found|invalid_model|model_not_available)\b/i.test(marker)) {
        return "model";
    }
    if (
        status === 404
        || status === 405
        || status === 415
        || ((status === 400 || status === 422)
            && /\b(endpoint|protocol|messages|response format|unsupported parameter)\b/i.test(marker))
    ) {
        return "protocol";
    }
    return "http";
}

function connectionFailureMessage(input: {
    kind: ProviderConnectionFailureKind;
    provider: ProviderConfig;
    preview: ProviderRequestPreview;
    status?: number;
}) {
    const status = input.status == null ? "" : ` (HTTP ${input.status})`;
    const protocolRecovery = input.preview.protocol === "openai-responses"
        ? "Verify the API root and OpenAI Responses API support."
        : input.preview.protocol === "anthropic-messages"
            ? "Verify the API root and Anthropic Messages API support."
            : input.preview.protocol === "google-generative-ai"
                ? "Verify the Google Generative AI model ID and endpoint availability."
            : "Verify the API root and OpenAI-compatible Chat Completions support.";
    switch (input.kind) {
        case "credential":
            return `Provider '${input.provider.id}' rejected the configured credential${status}. Re-enter the API key in /providers.`;
        case "oauth":
            return "Codex OAuth is not available for model execution in this CLI. Configure an OpenAI API key in /providers.";
        case "model":
            return `Provider '${input.provider.id}' did not accept model '${input.preview.modelId}'${status}. Check the model ID and account access.`;
        case "protocol":
            return `Provider '${input.provider.id}' did not recognize ${input.preview.method} ${input.preview.url}${status}. ${protocolRecovery}`;
        case "network":
            return `Could not reach provider '${input.provider.id}' at ${input.preview.url}. Check the endpoint, DNS, proxy, network connection, or request timeout.`;
        case "configuration":
            return `Provider '${input.provider.id}' is not configured for this connection test.`;
        case "http":
            return `Provider '${input.provider.id}' returned an unexpected HTTP response${status} for ${input.preview.url}.`;
    }
}

/**
 * Sends one explicit, minimum-output model request to validate credentials,
 * endpoint protocol, and configured model. It is never called automatically
 * when a credential is saved. Tests can inject fetch, and returned diagnostics
 * remain credential-safe.
 */
export async function testProviderConnection(input: {
    provider: ProviderConfig;
    modelId: string;
    credentialStore: CredentialStore;
    codexOAuthBroker: CodexOAuthBroker;
    fetch?: ProviderConnectionFetch;
    timeoutMs?: number;
}): Promise<ProviderConnectionTestResult> {
    const preview = resolveProviderRequestPreview(input.provider, input.modelId);
    let auth: Awaited<ReturnType<typeof resolveProviderAuth>>;
    try {
        auth = await resolveProviderAuth({
            provider: input.provider,
            credentialStore: input.credentialStore,
            codexOAuthBroker: input.codexOAuthBroker,
        });
    } catch (error) {
        const kind: ProviderConnectionFailureKind = error instanceof ProviderAuthError
            ? error.kind
            : "credential";
        throw new ProviderConnectionError(
            kind,
            connectionFailureMessage({ kind, provider: input.provider, preview }),
            preview,
        );
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(
        () => timeoutController.abort(),
        input.timeoutMs ?? 15_000,
    );
    try {
        const response = await (input.fetch ?? globalThis.fetch)(preview.url, {
            method: preview.method,
            headers: createProbeHeaders({ provider: input.provider, auth }),
            body: createProbeBody(preview),
            signal: timeoutController.signal,
        });

        if (!response.ok) {
            const marker = await getProviderErrorMarker(response, timeoutController.signal);
            const kind = classifyHttpFailure(response.status, marker);
            throw new ProviderConnectionError(
                kind,
                connectionFailureMessage({
                    kind,
                    provider: input.provider,
                    preview,
                    status: response.status,
                }),
                preview,
                response.status,
            );
        }

        return { ...preview, status: response.status };
    } catch (error) {
        if (error instanceof ProviderConnectionError) throw error;
        const kind = "network" as const;
        throw new ProviderConnectionError(
            kind,
            connectionFailureMessage({ kind, provider: input.provider, preview }),
            preview,
        );
    } finally {
        clearTimeout(timeout);
    }
}

export type ProviderCacheTelemetry = {
    provider: ResolvedModel["providerId"];
    providerKind: ResolvedModel["provider"];
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedPromptTokens?: number;
    cacheWriteTokens?: number;
    promptPrefixFingerprint: string;
    cacheFamilyId: string;
    toolSetFingerprint: string;
    contextEpochId: ContextEpochId;
    renderedPrefixDigest?: string;
    renderedPrefixBytes?: number;
    renderedPrefixBreakpointKind?: RenderedPrefixDigest["breakpointKind"];
    renderedPrefixBreakpointId?: string;
    missClassification?: CacheMissClassification;
};

export type ProviderAdapter = {
    compile(input: {
        resolvedModel: ResolvedModel;
        mode: ModeType;
        prefixIdentity: PromptPrefixIdentity;
    }): ProviderRequestCompilation;
};

export class OpenAIResponsesAdapter implements ProviderAdapter {
    compile({ prefixIdentity }: Parameters<ProviderAdapter["compile"]>[0]) {
        return {
            protocol: "openai-responses" as const,
            cacheKey: `more-more-code:${prefixIdentity.fingerprint}`,
        };
    }
}

class DefaultProviderAdapter implements ProviderAdapter {
    compile({ resolvedModel }: Parameters<ProviderAdapter["compile"]>[0]) {
        return {
            protocol: resolvedModel.protocol,
        };
    }
}

const openAIResponsesAdapter = new OpenAIResponsesAdapter();
const defaultProviderAdapter = new DefaultProviderAdapter();

export function compileProviderRequest(input: {
    resolvedModel: ResolvedModel;
    mode: ModeType;
    prefixIdentity: PromptPrefixIdentity;
}): ProviderRequestCompilation {
    const adapter = input.resolvedModel.provider === "openai"
        ? openAIResponsesAdapter
        : defaultProviderAdapter;
    return adapter.compile(input);
}

export function createProviderCacheTelemetry(input: {
    resolvedModel: ResolvedModel;
    usage?: ProviderUsage;
    prefixIdentity: PromptPrefixIdentity;
    contextEpochId?: ContextEpochId;
    renderedPrefix?: RenderedPrefixDigest;
    missClassification?: CacheMissClassification;
}): ProviderCacheTelemetry {
    const cacheFamilyId = input.prefixIdentity.cacheFamilyId ?? input.prefixIdentity.fingerprint;
    const contextEpochId = input.contextEpochId
        ?? `genesis:${cacheFamilyId.slice(0, 24)}` as ContextEpochId;
    return {
        provider: input.resolvedModel.providerId,
        providerKind: input.resolvedModel.provider,
        model: input.resolvedModel.modelId,
        ...(input.usage?.inputTokens != null ? { inputTokens: input.usage.inputTokens } : {}),
        ...(input.usage?.outputTokens != null ? { outputTokens: input.usage.outputTokens } : {}),
        ...(input.usage?.cacheReadTokens != null
            ? { cachedPromptTokens: input.usage.cacheReadTokens }
            : {}),
        ...(input.usage?.cacheWriteTokens != null
            ? { cacheWriteTokens: input.usage.cacheWriteTokens }
            : {}),
        promptPrefixFingerprint: input.prefixIdentity.fingerprint,
        cacheFamilyId,
        toolSetFingerprint: input.prefixIdentity.toolSetFingerprint,
        contextEpochId,
        ...(input.renderedPrefix ? {
            renderedPrefixDigest: input.renderedPrefix.digest,
            renderedPrefixBytes: input.renderedPrefix.bytes,
            renderedPrefixBreakpointKind: input.renderedPrefix.breakpointKind,
            ...(input.renderedPrefix.breakpointId
                ? { renderedPrefixBreakpointId: input.renderedPrefix.breakpointId }
                : {}),
        } : {}),
        ...(input.missClassification ? { missClassification: input.missClassification } : {}),
    };
}
