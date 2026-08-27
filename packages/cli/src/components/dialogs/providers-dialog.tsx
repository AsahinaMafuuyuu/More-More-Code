import { useCallback, useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { DialogSearchList } from "../dialog-search-list";
import {
    getAgentEnvironment,
    removeAgentEnvironmentCustomProvider,
    saveAgentEnvironmentProvider,
} from "../../lib/agent-environment";
import { canUseCodexOAuthForModelExecution } from "../../lib/provider-auth";
import {
    defaultCredentialRef,
    type ProviderConfig,
} from "../../lib/provider-registry";
import {
    resolveProviderRequestPreview,
    testProviderConnection,
} from "../../lib/provider-runtime";
import { useToast } from "../../providers/toast";
import { ProviderEditorDialogContent } from "./provider-editor-dialog";
import { ProviderCredentialDialogContent } from "./provider-credential-dialog";
import type { ModelRef } from "@more-more-code/shared";

type ProviderStatus = "ready" | "missing" | "none" | "oauth-signed-in" | "oauth-signed-out" | "oauth-unavailable";
type View =
    | { kind: "list" }
    | { kind: "actions"; providerId: string }
    | { kind: "add" }
    | { kind: "edit"; providerId: string }
    | { kind: "credential"; providerId: string };

async function getProviderStatus(provider: ProviderConfig): Promise<ProviderStatus> {
    if (provider.auth.type === "none") return "none";
    if (provider.auth.type === "codex-oauth") {
        const broker = getAgentEnvironment().codexOAuth;
        if (!canUseCodexOAuthForModelExecution(broker)) return "oauth-unavailable";
        const status = await broker.status();
        return status.state === "signed-in"
            ? "oauth-signed-in"
            : status.state === "signed-out"
                ? "oauth-signed-out"
                : "oauth-unavailable";
    }
    return await getAgentEnvironment().credentials.get(provider.auth.credentialRef)
        ? "ready"
        : "missing";
}

function statusLabel(status?: ProviderStatus) {
    switch (status) {
        case "ready": return "credential ready";
        case "missing": return "credential missing";
        case "none": return "no auth";
        case "oauth-signed-in": return "Codex OAuth signed in";
        case "oauth-signed-out": return "Codex OAuth signed out";
        case "oauth-unavailable": return "Codex OAuth unavailable for model execution";
        default: return "checking";
    }
}

function resolveRequestPreview(provider: ProviderConfig, modelId: string | undefined) {
    if (!modelId) {
        return {
            preview: null,
            error: `Provider '${provider.id}' needs at least one configured model before a connection test can run.`,
        };
    }
    try {
        return { preview: resolveProviderRequestPreview(provider, modelId), error: null };
    } catch (error) {
        return {
            preview: null,
            error: error instanceof Error
                ? error.message
                : `Provider '${provider.id}' has an invalid request configuration.`,
        };
    }
}

export function ProvidersDialogContent({ liveModel }: { liveModel: ModelRef }) {
    const toast = useToast();
    const [providers, setProviders] = useState(() => getAgentEnvironment().providers.list());
    const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
    const [view, setView] = useState<View>({ kind: "list" });
    const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

    const refresh = useCallback(() => {
        setProviders(getAgentEnvironment().providers.list());
    }, []);

    useEffect(() => {
        let cancelled = false;
        void Promise.all(providers.map(async (provider) => [provider.id, await getProviderStatus(provider)] as const))
            .then((entries) => {
                if (!cancelled) setStatuses(Object.fromEntries(entries));
            });
        return () => { cancelled = true; };
    }, [providers]);

    if (view.kind === "add") {
        return (
            <ProviderEditorDialogContent
                liveModel={liveModel}
                closeOnSave={false}
                onSaved={() => {
                    refresh();
                    setView({ kind: "list" });
                }}
            />
        );
    }

    const selectedProvider = view.kind === "list"
        ? undefined
        : providers.find((provider) => provider.id === view.providerId);

    if (view.kind === "edit" && selectedProvider?.kind === "custom") {
        return (
            <ProviderEditorDialogContent
                provider={selectedProvider}
                liveModel={liveModel}
                closeOnSave={false}
                onSaved={() => {
                    refresh();
                    setView({ kind: "list" });
                }}
            />
        );
    }

    if (view.kind === "credential" && selectedProvider) {
        return (
            <ProviderCredentialDialogContent
                provider={selectedProvider}
                closeOnSave={false}
                onSaved={() => {
                    refresh();
                    setView({ kind: "list" });
                }}
            />
        );
    }

    if (view.kind === "actions" && selectedProvider) {
        const environment = getAgentEnvironment();
        const credentialRef = selectedProvider.auth.type === "api-key" || selectedProvider.auth.type === "bearer"
            ? selectedProvider.auth.credentialRef
            : null;
        const probeModelId = selectedProvider.models[0];
        const requestPreview = resolveRequestPreview(selectedProvider, probeModelId);
        const preview = requestPreview.preview;
        const codexOAuthExecutionSupported = selectedProvider.kind === "openai"
            && canUseCodexOAuthForModelExecution(environment.codexOAuth);
        const isTesting = testingProviderId === selectedProvider.id;
        const actions = [
            ...(credentialRef ? [{ id: "credential", label: "Set credential" }] : []),
            ...(credentialRef ? [{ id: "clear", label: "Clear stored credential" }] : []),
            ...(preview ? [{ id: "preview", label: "Preview runtime request URL" }] : []),
            ...(preview ? [{
                id: "test",
                label: isTesting ? "Testing connection…" : "Test connection (minimal model request)",
            }] : [{ id: "configuration", label: "Fix provider configuration before testing" }]),
            ...(selectedProvider.kind === "openai" && selectedProvider.auth.type === "codex-oauth"
                ? [{ id: "toggle-auth", label: "Use API key authentication" }]
                : codexOAuthExecutionSupported
                    ? [{ id: "toggle-auth", label: "Use Codex OAuth" }]
                    : []),
            ...(selectedProvider.kind === "openai"
                && selectedProvider.auth.type === "codex-oauth"
                && codexOAuthExecutionSupported
                ? [{ id: "oauth-status", label: "Inspect Codex OAuth status" }]
                : []),
            ...(selectedProvider.kind === "custom" ? [{ id: "edit", label: "Edit custom provider" }] : []),
            ...(selectedProvider.kind === "custom" ? [{ id: "remove", label: "Remove custom provider" }] : []),
            { id: "back", label: "Back to providers" },
        ];

        const execute = async (actionId: string) => {
            try {
                if (actionId === "back") {
                    setView({ kind: "list" });
                } else if (actionId === "credential") {
                    setView({ kind: "credential", providerId: selectedProvider.id });
                } else if (actionId === "preview" && preview) {
                    toast.show({
                        variant: "info",
                        message: `${preview.protocol}: ${preview.method} ${preview.url}`,
                    });
                } else if (actionId === "configuration") {
                    throw new Error(requestPreview.error ?? `Provider '${selectedProvider.id}' has an invalid request configuration.`);
                } else if (actionId === "test") {
                    if (!probeModelId || !preview) {
                        throw new Error(`Provider '${selectedProvider.id}' needs a configured model before a connection test can run.`);
                    }
                    if (isTesting) return;
                    setTestingProviderId(selectedProvider.id);
                    try {
                        const result = await testProviderConnection({
                            provider: selectedProvider,
                            modelId: probeModelId,
                            credentialStore: environment.credentials,
                            codexOAuthBroker: environment.codexOAuth,
                        });
                        toast.show({
                            variant: "success",
                            message: `Connection verified (HTTP ${result.status}): ${result.method} ${result.url}`,
                        });
                    } finally {
                        setTestingProviderId(null);
                    }
                } else if (actionId === "clear" && credentialRef) {
                    await environment.credentials.delete(credentialRef);
                    toast.show({ variant: "success", message: `Cleared stored credential for '${selectedProvider.id}'` });
                    refresh();
                    setView({ kind: "list" });
                } else if (actionId === "edit" && selectedProvider.kind === "custom") {
                    setView({ kind: "edit", providerId: selectedProvider.id });
                } else if (actionId === "remove" && selectedProvider.kind === "custom") {
                    await removeAgentEnvironmentCustomProvider(selectedProvider.id, { liveModel });
                    toast.show({ variant: "success", message: `Removed provider '${selectedProvider.id}'` });
                    refresh();
                    setView({ kind: "list" });
                } else if (actionId === "toggle-auth" && selectedProvider.kind === "openai") {
                    if (selectedProvider.auth.type !== "codex-oauth" && !codexOAuthExecutionSupported) {
                        throw new Error("Codex OAuth is not available for model execution. Configure an OpenAI API key instead.");
                    }
                    await saveAgentEnvironmentProvider(
                        selectedProvider.auth.type === "codex-oauth"
                            ? {
                                ...selectedProvider,
                                auth: { type: "api-key", credentialRef: defaultCredentialRef("openai") },
                            }
                            : { ...selectedProvider, auth: { type: "codex-oauth" } },
                        { liveModel },
                    );
                    refresh();
                    setView({ kind: "list" });
                } else if (actionId === "oauth-status") {
                    const status = await environment.codexOAuth.status();
                    toast.show({
                        variant: status.state === "unavailable" ? "info" : undefined,
                        message: status.state === "unavailable" ? status.message : `Codex OAuth: ${status.state}`,
                    });
                }
            } catch (error) {
                toast.show({ variant: "error", message: error instanceof Error ? error.message : String(error) });
            }
        };

        return (
            <box flexDirection="column" gap={1}>
                <text attributes={TextAttributes.BOLD}>{selectedProvider.displayName}</text>
                <text attributes={TextAttributes.DIM}>
                    {selectedProvider.id} · {selectedProvider.kind} · {statusLabel(statuses[selectedProvider.id])}
                </text>
                {preview ? (
                    <text attributes={TextAttributes.DIM}>
                        {preview.method} {preview.url}
                    </text>
                ) : (
                    <text attributes={TextAttributes.DIM}>
                        {requestPreview.error}
                    </text>
                )}
                <DialogSearchList
                    items={actions}
                    getKey={(item) => item.id}
                    filterFn={(item, query) => item.label.toLowerCase().includes(query.toLowerCase())}
                    onSelect={(item) => void execute(item.id)}
                    renderItem={(item, selected) => <text fg={selected ? "black" : undefined}>{item.label}</text>}
                    placeholder="Provider action"
                />
            </box>
        );
    }

    const providerItems = [
        ...providers.map((provider) => ({ kind: "provider" as const, provider })),
        { kind: "add" as const, label: "+ Add custom OpenAI-compatible provider" },
    ];

    return (
        <box flexDirection="column" gap={1}>
            <text attributes={TextAttributes.DIM}>
                Provider config is local. Credentials are stored separately and are never written to providers.json.
            </text>
            <DialogSearchList
                items={providerItems}
                getKey={(item) => item.kind === "provider" ? item.provider.id : "__add__"}
                filterFn={(item, query) => item.kind === "provider"
                    ? `${item.provider.displayName} ${item.provider.id} ${item.provider.kind}`.toLowerCase().includes(query.toLowerCase())
                    : item.label.toLowerCase().includes(query.toLowerCase())}
                onSelect={(item) => {
                    if (item.kind === "add") setView({ kind: "add" });
                    else setView({ kind: "actions", providerId: item.provider.id });
                }}
                renderItem={(item, selected) => item.kind === "provider" ? (
                    <text fg={selected ? "black" : undefined}>
                        {item.provider.displayName} [{item.provider.id}] · {statusLabel(statuses[item.provider.id])} · {item.provider.models.length} model(s)
                    </text>
                ) : (
                    <text fg={selected ? "black" : undefined}>{item.label}</text>
                )}
                placeholder="Search providers"
            />
        </box>
    );
}
