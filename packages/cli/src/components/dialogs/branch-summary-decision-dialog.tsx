import { DialogSearchList } from "../dialog-search-list";
import type {
    SessionTreeCommandApi,
    SessionTreeNavigationDecision,
} from "../command-menu/types";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";

const DECISIONS: Array<{
    id: SessionTreeNavigationDecision;
    label: string;
    description: string;
}> = [
    {
        id: "carry",
        label: "Carry",
        description: "Summarize source-only knowledge onto the target branch",
    },
    {
        id: "no-carry",
        label: "No Carry",
        description: "Jump without adding any Session Entry",
    },
    {
        id: "cancel",
        label: "Cancel",
        description: "Stay on the current source entry",
    },
];

export function showNavigationResultToast(
    result: Awaited<ReturnType<SessionTreeCommandApi["jump"]>>,
    toast: ReturnType<typeof useToast>,
) {
    if (result.status === "carried") {
        toast.show({
            variant: "success",
            message: result.fallbackUsed
                ? `Branch knowledge carried with deterministic fallback (${result.fallbackReason ?? "unknown"})`
                : "Branch knowledge carried",
        });
    } else if (result.status === "carry-failed") {
        toast.show({
            variant: "error",
            message: "Jumped to target, but branch knowledge could not be reduced; no summary was appended",
        });
    }
}

export function BranchSummaryDecisionDialogContent({
    tree,
    targetEntryId,
}: {
    tree: SessionTreeCommandApi;
    targetEntryId: string;
}) {
    const dialog = useDialog();
    const toast = useToast();
    const intent = tree.inspectJump(targetEntryId);

    return (
        <box flexDirection="column" gap={1}>
            <text>
                {`Leaving ${intent.sourceTipEntryId.slice(0, 8)} would omit ${intent.coveredEntryIds.length} semantic entr${intent.coveredEntryIds.length === 1 ? "y" : "ies"}.`}
            </text>
            <text>
                {`Common ancestor: ${intent.commonAncestorEntryId.slice(0, 8)} · policy: ${intent.policy}`}
            </text>
            <DialogSearchList
                items={DECISIONS}
                getKey={(item) => item.id}
                filterFn={(item, query) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())}
                onSelect={(item) => {
                    if (item.id === "cancel") {
                        void tree.jump(targetEntryId, "cancel");
                        dialog.close();
                        return;
                    }
                    void tree.jump(targetEntryId, item.id)
                        .then((result) => showNavigationResultToast(result, toast))
                        .catch((error) => {
                            toast.show({
                                variant: "error",
                                message: error instanceof Error ? error.message : String(error),
                            });
                        })
                        .finally(() => dialog.close());
                }}
                renderItem={(item, selected) => (
                    <box flexDirection="column">
                        <text fg={selected ? "black" : undefined}>{item.label}</text>
                        <text>{item.description}</text>
                    </box>
                )}
                placeholder="Carry branch knowledge?"
            />
        </box>
    );
}
