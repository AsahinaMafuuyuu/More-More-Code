import { TextAttributes } from "@opentui/core";
import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import type { ThemeColors } from "../../theme";
import { DialogSearchList } from "../dialog-search-list";
import {
    BranchSummaryDecisionDialogContent,
    showNavigationResultToast,
} from "./branch-summary-decision-dialog";
import { useToast } from "../../providers/toast";
import type {
    SessionTreeCommandApi,
    SessionTreeCommandEntry,
} from "../command-menu/types";

function getSessionEntryColor(type: string, colors: ThemeColors) {
    if (["user_message", "assistant_message", "custom_message", "message_update", "session_start"].includes(type)) {
        return colors.sessionMessage;
    }
    if (type === "tool_call" || type === "tool_result" || type === "tool_use") return colors.sessionTool;
    if (type === "compaction") return colors.sessionCompaction;
    if (type === "model_change" || type === "mode_change" || type === "config_change") {
        return colors.sessionStateChange;
    }
    if (type === "branch_summary") return colors.sessionBranch;
    if (type === "error") return colors.sessionError;
    return colors.sessionCustom;
}

function formatEntryTime(createdAt: number) {
    return new Date(createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function SessionTreeDialogContent({ tree }: { tree: SessionTreeCommandApi }) {
    const dialog = useDialog();
    const toast = useToast();
    const { colors } = useTheme();

    const handleSelect = useCallback((entry: SessionTreeCommandEntry) => {
        if (!entry.selectable) {
            toast.show({
                variant: "info",
                message: "This Tool request is incomplete and is not a terminal navigation point",
            });
            return;
        }
        const targetEntryId = entry.navigationTargetEntryId;
        const intent = tree.inspectJump(targetEntryId);
        if (intent.action === "ask") {
            dialog.open({
                title: "Carry Branch Knowledge",
                children: (
                    <BranchSummaryDecisionDialogContent
                        tree={tree}
                        targetEntryId={targetEntryId}
                    />
                ),
            });
            return;
        }

        void tree.jump(targetEntryId)
            .then((result) => showNavigationResultToast(result, toast))
            .catch((error) => {
                toast.show({
                    variant: "error",
                    message: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => dialog.close());
    }, [dialog, toast, tree]);

    return (
        <DialogSearchList
            items={tree.entries}
            onSelect={handleSelect}
            filterFn={(entry, query) => {
                const needle = query.toLowerCase();
                return entry.id.toLowerCase().includes(needle)
                    || entry.type.toLowerCase().includes(needle)
                    || entry.preview.toLowerCase().includes(needle);
            }}
            renderItem={(entry, isSelected) => (
                <>
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : getSessionEntryColor(entry.type, colors)}
                    >
                        {`${"  ".repeat(entry.depth)}${entry.active ? "●" : "○"} [${entry.type}] ${entry.preview}`}
                    </text>
                    <box flexGrow={1} />
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : colors.sessionTimestampMuted}
                        attributes={TextAttributes.DIM}
                    >
                        {`${formatEntryTime(entry.createdAt)} · ${entry.messageCount} msgs · ${entry.id.slice(0, 8)}`}
                    </text>
                </>
            )}
            getKey={(entry) => entry.id}
            placeholder="Search session navigation..."
            emptyText="No semantic session entries"
        />
    );
}
