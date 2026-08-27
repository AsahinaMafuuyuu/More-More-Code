
import { useCallback, useState } from "react";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { DialogSearchList } from "../dialog-search-list";
import type { ModelRef } from "@more-more-code/shared";
import { persistAgentEnvironmentModel } from "../../lib/agent-environment";

type ModelsDialogContentProps = {
    models: ModelRef[];
    onSelectModel: (model: ModelRef) => void | Promise<void>;
};

export const ModelsDialogContent = ({
    models,
    onSelectModel,
}: ModelsDialogContentProps) => {
    const dialog = useDialog();
    const toast = useToast();
    const [saving, setSaving] = useState(false);

    const handleSelect = useCallback(async (model: ModelRef) => {
        if (saving) return;
        setSaving(true);
        try {
            // A session may persist this selection asynchronously. Do not
            // report success or close the dialog until that commit settles.
            await onSelectModel(model);
            await persistAgentEnvironmentModel(model);
            toast.show({
                variant: "success",
                message: `Selected ${model.providerId}/${model.modelId} as the local default`,
            });
            dialog.close();
        } catch (error) {
            toast.show({
                variant: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setSaving(false);
        }
    }, [dialog, onSelectModel, saving, toast]);


    return (
        <box flexDirection="column" gap={1}>
            <DialogSearchList
                items={models}
                onSelect={(model) => void handleSelect(model)}
                filterFn={(modelRef, query) =>
                    `${modelRef.providerId}/${modelRef.modelId}`
                        .toLowerCase()
                        .includes(query.toLowerCase())}
                renderItem={(modelRef, isSelected) => (
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : "white"}
                    >
                        {modelRef.providerId}/{modelRef.modelId}
                    </text>
                )}
                getKey={(modelRef) => `${modelRef.providerId}:${modelRef.modelId}`}
                placeholder={saving ? "Saving local default…" : "Search models"}
                emptyText="No matching models"
            />
            <text>Selection is stored in this workspace&apos;s local Agent Config.</text>
        </box>
    );
};
