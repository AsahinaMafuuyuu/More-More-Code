import { useCallback, useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { DialogSearchList } from "../dialog-search-list";
import { getAgentEnvironment } from "../../lib/agent-environment";
import {
    defaultCredentialRef,
    type ProviderConfig,
} from "../../lib/provider-registry";
import { useToast } from "../../providers/toast";
import { ProviderEditorDialogContent } from "./provider-editor-dialog";
import { ProviderCredentialDialogContent } from "./provider-credential-dialog";

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
        const status = await getAgentEnvironment().codexOAuth.status();
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
        case "oauth-unavailable": return "Codex OAuth unavailable";
        default: return "checking";
    }
}

export function ProvidersDialogContent() {
    const toast = useToast();
    const [providers, setProviders] = useState(() => getAgentEnvironment().providers.list());
    const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
    const [view, setView] = useState<View>({ kind: "list" });

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
        const credentialRef = selectedProvider.auth.type === "api-key" || selectedProvider.auth.type === "bearer"
            ? selectedProvider.auth.credentialRef
            : null;
        const actions = [
            ...(credentialRef ? [{ id: "credential", label: "Set credential" }] : []),
            ...(credentialRef ? [{ id: "clear", label: "Clear stored credential" }] : []),
            ...(selectedProvider.kind === "openai" ? [{ id: "toggle-auth", label: selectedProvider.auth.type === "codex-oauth" ? "Use API key authentication" : "Use experimental Codex OAuth" }] : []),
            ...(selectedProvider.kind === "openai" && selectedProvider.auth.type === "codex-oauth" ? [{ id: "oauth-status", label: "Inspect Codex OAuth status" }] : []),
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
                } else if (actionId === "clear" && credentialRef) {
                    await getAgentEnvironment().credentials.delete(credentialRef);
                    toast.show({ variant: "success", message: `Cleared stored credential for '${selectedProvider.id}'` });
                    refresh();
                    setView({ kind: "list" });
                } else if (actionId === "edit" && selectedProvider.kind === "custom") {
                    setView({ kind: "edit", providerId: selectedProvider.id });
                } else if (actionId === "remove" && selectedProvider.kind === "custom") {
                    await getAgentEnvironment().providers.removeCustomProvider(selectedProvider.id);
                    toast.show({ variant: "success", message: `Removed provider '${selectedProvider.id}'` });
                    refresh();
                    setView({ kind: "list" });
                } else if (actionId === "toggle-auth" && selectedProvider.kind === "openai") {
                    await getAgentEnvironment().providers.saveProvider(
                        selectedProvider.auth.type === "codex-oauth"
                            ? {
                                ...selectedProvider,
                                auth: { type: "api-key", credentialRef: defaultCredentialRef("openai") },
                            }
                            : { ...selectedProvider, auth: { type: "codex-oauth" } },
                    );
                    refresh();
                    setView({ kind: "list" });
                } else if (actionId === "oauth-status") {
                    const status = await getAgentEnvironment().codexOAuth.status();
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
