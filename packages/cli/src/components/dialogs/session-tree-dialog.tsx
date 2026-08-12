import { TextAttributes } from "@opentui/core";
import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type {
    SessionTreeCommandApi,
    SessionTreeCommandNode,
} from "../command-menu/types";

export function SessionTreeDialogContent({ tree }: { tree: SessionTreeCommandApi }) {
    const { close } = useDialog();

    const handleSelect = useCallback((node: SessionTreeCommandNode) => {
        tree.jump(node.id);
        close();
    }, [close, tree]);

    return (
        <DialogSearchList
            items={tree.nodes}
            onSelect={handleSelect}
            filterFn={(node, query) => {
                const needle = query.toLowerCase();
                return node.id.toLowerCase().includes(needle)
                    || node.preview.toLowerCase().includes(needle);
            }}
            renderItem={(node, isSelected) => (
                <>
                    <text selectable={false} fg={isSelected ? "black" : "white"}>
                        {`${"  ".repeat(node.depth)}${node.active ? "●" : "○"} ${node.preview}`}
                    </text>
                    <box flexGrow={1} />
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : undefined}
                        attributes={TextAttributes.DIM}
                    >
                        {`${node.messageCount} msgs · ${node.id.slice(0, 8)}`}
                    </text>
                </>
            )}
            getKey={(node) => node.id}
            placeholder="Search tree nodes..."
            emptyText="No session tree nodes"
        />
    );
}
