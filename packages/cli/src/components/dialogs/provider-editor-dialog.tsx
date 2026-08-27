import { useCallback, useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { saveAgentEnvironmentProvider } from "../../lib/agent-environment";
import type { ModelRef } from "@more-more-code/shared";
import {
    defaultCredentialRef,
    providerConfigSchema,
    type CustomProviderConfig,
} from "../../lib/provider-registry";

export function ProviderEditorDialogContent({
    provider,
    liveModel,
    onSaved,
    closeOnSave = true,
}: {
    provider?: CustomProviderConfig;
    liveModel: ModelRef;
    onSaved?: () => void;
    closeOnSave?: boolean;
}) {
    const dialog = useDialog();
    const toast = useToast();
    const { isTopLayer } = useKeyboardLayer();
    const idRef = useRef<InputRenderable>(null);
    const nameRef = useRef<InputRenderable>(null);
    const urlRef = useRef<InputRenderable>(null);
    const modelsRef = useRef<InputRenderable>(null);
    const authRef = useRef<InputRenderable>(null);
    const fields = [idRef, nameRef, urlRef, modelsRef, authRef] as const;
    const [activeField, setActiveField] = useState(0);
    const [saving, setSaving] = useState(false);

    const save = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            const id = (idRef.current?.value ?? "").trim();
            if (provider && id !== provider.id) {
                throw new Error("Provider ID is stable and cannot be changed while editing");
            }
            const authType = (authRef.current?.value ?? "api-key").trim();
            const rawProvider = {
                id,
                kind: "custom" as const,
                displayName: (nameRef.current?.value ?? "").trim() || id,
                enabled: true,
                protocol: "openai-compatible" as const,
                baseURL: (urlRef.current?.value ?? "").trim(),
                models: (modelsRef.current?.value ?? "")
                    .split(",")
                    .map((modelId) => modelId.trim())
                    .filter(Boolean),
                auth: authType === "none"
                    ? { type: "none" as const }
                    : authType === "bearer"
                        ? { type: "bearer" as const, credentialRef: defaultCredentialRef(id) }
                        : { type: "api-key" as const, credentialRef: defaultCredentialRef(id) },
            };
            const parsed = providerConfigSchema.parse(rawProvider);
            if (parsed.kind !== "custom") throw new Error("Expected a custom provider");
            await saveAgentEnvironmentProvider(parsed, { liveModel });
            toast.show({ variant: "success", message: `Saved provider '${parsed.id}'` });
            onSaved?.();
            if (closeOnSave) dialog.close();
        } catch (error) {
            toast.show({
                variant: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setSaving(false);
        }
    }, [closeOnSave, dialog, liveModel, onSaved, provider, saving, toast]);

    useKeyboard((key) => {
        if (!isTopLayer("dialog")) return;
        if (key.name === "tab") {
            setActiveField((current) => {
                const next = (current + 1) % fields.length;
                fields[next]?.current?.focus();
                return next;
            });
        } else if (key.ctrl && key.name === "s") {
            void save();
        }
    });

    return (
        <box flexDirection="column" gap={1}>
            <text>Provider ID</text>
            <input ref={idRef} value={provider?.id ?? ""} focused={activeField === 0} />
            <text>Display name</text>
            <input ref={nameRef} value={provider?.displayName ?? ""} focused={activeField === 1} />
            <text>OpenAI-compatible base URL</text>
            <input ref={urlRef} value={provider?.baseURL ?? ""} focused={activeField === 2} />
            <text>Model IDs, comma separated</text>
            <input ref={modelsRef} value={provider?.models.join(", ") ?? ""} focused={activeField === 3} />
            <text>Authentication: api-key | bearer | none</text>
            <input ref={authRef} value={provider?.auth.type ?? "api-key"} focused={activeField === 4} />
            <text>Tab: next field · Ctrl+S: save</text>
        </box>
    );
}
