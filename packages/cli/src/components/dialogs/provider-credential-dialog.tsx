import { useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { getAgentEnvironment } from "../../lib/agent-environment";
import type { ProviderConfig } from "../../lib/provider-registry";
import { resolveProviderRequestPreview } from "../../lib/provider-runtime";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";

function getCredentialRef(provider: ProviderConfig) {
    return provider.auth.type === "api-key" || provider.auth.type === "bearer"
        ? provider.auth.credentialRef
        : null;
}

export function ProviderCredentialDialogContent({
    provider,
    onSaved,
    closeOnSave = true,
}: {
    provider: ProviderConfig;
    onSaved?: () => void;
    closeOnSave?: boolean;
}) {
    const inputRef = useRef<InputRenderable>(null);
    const [length, setLength] = useState(0);
    const dialog = useDialog();
    const toast = useToast();
    const credentialRef = getCredentialRef(provider);
    const requestPreview = provider.models[0]
        ? (() => {
            try {
                return { preview: resolveProviderRequestPreview(provider, provider.models[0]!), error: null };
            } catch (error) {
                return {
                    preview: null,
                    error: error instanceof Error
                        ? error.message
                        : `Provider '${provider.id}' has an invalid request configuration.`,
                };
            }
        })()
        : {
            preview: null,
            error: "Add a model in /providers before testing this provider.",
        };

    if (!credentialRef) {
        return <text>This provider does not use a locally stored credential.</text>;
    }

    return (
        <box flexDirection="column" gap={1}>
            <text>Credential for {provider.displayName}</text>
            <input
                ref={inputRef}
                focused
                placeholder="Paste credential"
                textColor="transparent"
                focusedTextColor="transparent"
                onContentChange={() => setLength(inputRef.current?.value.length ?? 0)}
                onSubmit={() => {
                    const value = inputRef.current?.value ?? "";
                    if (!value) {
                        toast.show({ variant: "error", message: "Credential cannot be empty" });
                        return;
                    }
                    void getAgentEnvironment().credentials.set(credentialRef, value).then(() => {
                        if (inputRef.current) inputRef.current.value = "";
                        setLength(0);
                        toast.show({ variant: "success", message: `Stored credential for '${provider.id}'` });
                        onSaved?.();
                        if (closeOnSave) dialog.close();
                    }).catch((error) => {
                        toast.show({
                            variant: "error",
                            message: error instanceof Error ? error.message : String(error),
                        });
                    });
                }}
            />
            <text>{"•".repeat(Math.min(length, 48))}{length > 48 ? ` (${length} chars)` : ""}</text>
            {requestPreview.preview ? (
                <text>Runtime request: {requestPreview.preview.method} {requestPreview.preview.url}</text>
            ) : (
                <text>{requestPreview.error}</text>
            )}
            <text>Enter: store locally. Connection tests are explicit in /providers.</text>
        </box>
    );
}
