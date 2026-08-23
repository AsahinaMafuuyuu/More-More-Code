import { useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { getAgentEnvironment } from "../../lib/agent-environment";
import type { ProviderConfig } from "../../lib/provider-registry";
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
            <text>Enter: store in local CredentialStore</text>
        </box>
    );
}
