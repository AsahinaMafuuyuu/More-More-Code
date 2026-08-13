import { TextAttributes } from "@opentui/core";
import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type {
    SessionTreeCommandApi,
    SessionTreeCommandEntry,
} from "../command-menu/types";

export function SessionTreeDialogContent({ tree }: { tree: SessionTreeCommandApi }) {
    const { close } = useDialog();

    const handleSelect = useCallback((entry: SessionTreeCommandEntry) => {
        tree.jump(entry.id);
        close();
    }, [close, tree]);

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
                    <text selectable={false} fg={isSelected ? "black" : "white"}>
                        {`${"  ".repeat(entry.depth)}${entry.active ? "●" : "○"} [${entry.type}] ${entry.preview}`}
                    </text>
                    <box flexGrow={1} />
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : undefined}
                        attributes={TextAttributes.DIM}
                    >
                        {`${entry.messageCount} msgs · ${entry.id.slice(0, 8)}`}
                    </text>
                </>
            )}
            getKey={(entry) => entry.id}
            placeholder="Search session entries..."
            emptyText="No session entries"
        />
    );
}
