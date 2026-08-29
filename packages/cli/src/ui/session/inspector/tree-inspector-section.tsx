import {
  TextAttributes,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionTreeCommandApi } from "../../../components/command-menu/types";
import {
  BranchSummaryDecisionDialogContent,
  showNavigationResultToast,
} from "../../../components/dialogs/branch-summary-decision-dialog";
import { useDialog } from "../../../providers/dialog";
import { useKeyboardLayer } from "../../../providers/keyboard-layer";
import { useTheme } from "../../../providers/theme";
import { useToast } from "../../../providers/toast";
import { createTerminalScrollbarOptions } from "../../scrollbar-style";
import {
  filterInspectorTreeEntries,
  moveInspectorSelection,
} from "./inspector-model";
import type {
  InspectorTreeEntryView,
  InspectorTreeView,
} from "./inspector-projections";

export function TreeInspectorSection({
  view,
  tree,
  narrow,
  availableRows,
}: {
  view: InspectorTreeView;
  tree: SessionTreeCommandApi;
  narrow: boolean;
  availableRows: number;
}) {
  const { colors } = useTheme();
  const dialog = useDialog();
  const toast = useToast();
  const { isTopLayer } = useKeyboardLayer();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const filtered = useMemo(
    () => filterInspectorTreeEntries(view.entries, query),
    [query, view.entries],
  );

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const selectEntry = useCallback((entry: InspectorTreeEntryView | undefined) => {
    if (!entry) return;
    if (!entry.selectable) {
      toast.show({
        variant: "info",
        message: "This Tool request is incomplete and is not a terminal navigation point",
      });
      return;
    }
    try {
      const intent = tree.inspectJump(entry.navigationTargetEntryId);
      if (intent.action === "ask") {
        dialog.open({
          title: "Carry Branch Knowledge",
          children: (
            <BranchSummaryDecisionDialogContent
              tree={tree}
              targetEntryId={entry.navigationTargetEntryId}
            />
          ),
        });
        return;
      }
      void tree.jump(entry.navigationTargetEntryId)
        .then((result) => showNavigationResultToast(result, toast))
        .catch((error) => {
          toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [dialog, toast, tree]);

  useKeyboard((key) => {
    if (!isTopLayer("inspector")) return;
    if (key.name === "backspace") {
      key.preventDefault();
      setQuery((value) => value.slice(0, -1));
      setSelectedIndex(0);
      scrollRef.current?.scrollTo(0);
      return;
    }
    if (!key.ctrl && !key.meta && !key.super && !key.hyper) {
      const character = key.name === "space"
        ? " "
        : key.name.length === 1 ? key.name : null;
      if (character) {
        key.preventDefault();
        setQuery((value) => `${value}${key.shift ? character.toUpperCase() : character}`);
        setSelectedIndex(0);
        scrollRef.current?.scrollTo(0);
        return;
      }
    }
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      const delta = key.name === "up" ? -1 : 1;
      setSelectedIndex((index) => {
        const next = moveInspectorSelection(index, delta, filtered.length);
        const scroll = scrollRef.current;
        if (scroll) {
          const viewportHeight = Math.max(1, scroll.viewport.height);
          if (next < scroll.scrollTop) scroll.scrollTo(next);
          if (next >= scroll.scrollTop + viewportHeight) {
            scroll.scrollTo(Math.max(0, next - viewportHeight + 1));
          }
        }
        return next;
      });
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      selectEntry(filtered[selectedIndex]);
    }
  });

  const selected = filtered[selectedIndex];
  const listRows = Math.max(3, availableRows - (narrow ? 7 : 5));

  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <box flexDirection="row" flexShrink={0} overflow="hidden">
        <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>Search: </text>
        <text>{query || "type to filter"}</text>
        {query && (
          <text attributes={TextAttributes.DIM} fg={colors.sessionTimestampMuted}> · Backspace edits</text>
        )}
      </box>

      {filtered.length === 0 ? (
        <text attributes={TextAttributes.DIM}>No semantic Session entries match this search.</text>
      ) : (
        <scrollbox
          ref={scrollRef}
          height={Math.min(listRows, Math.max(1, filtered.length))}
          scrollX={false}
          viewportCulling
          verticalScrollbarOptions={createTerminalScrollbarOptions(colors)}
        >
          {filtered.map((entry, index) => {
            const selectedRow = index === selectedIndex;
            return (
              <box
                key={entry.id}
                height={1}
                overflow="hidden"
                flexDirection="row"
                backgroundColor={selectedRow ? colors.selection : undefined}
                onMouseMove={() => setSelectedIndex(index)}
                onMouseDown={() => selectEntry(entry)}
              >
                <text fg={selectedRow ? "black" : entryColor(entry, colors)}>
                  {`${"│ ".repeat(entry.depth)}${entry.active ? "●" : entry.activePath ? "•" : "○"} ${entry.label}  ${entry.preview}`}
                </text>
                {!narrow && (
                  <>
                    <box flexGrow={1} />
                    <text
                      attributes={TextAttributes.DIM}
                      fg={selectedRow ? "black" : colors.sessionTimestampMuted}
                    >
                      {formatTime(entry.createdAt)}
                    </text>
                  </>
                )}
              </box>
            );
          })}
        </scrollbox>
      )}

      {selected && (
        <box flexDirection={narrow ? "column" : "row"} flexShrink={0} gap={narrow ? 0 : 1}>
          <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>
            {selected.selectable ? "Enter jump" : "Incomplete"}
          </text>
          {selected.status && <text>{selected.status}</text>}
          <text attributes={TextAttributes.DIM} fg={colors.sessionTimestampMuted}>
            {selected.navigationTargetEntryId.slice(0, 12)}
          </text>
        </box>
      )}
    </box>
  );
}

function entryColor(
  entry: InspectorTreeEntryView,
  colors: ReturnType<typeof useTheme>["colors"],
) {
  if (entry.label === "ToolUse") return colors.sessionTool;
  if (entry.label === "Compaction") return colors.sessionCompaction;
  if (entry.label === "Branch Summary") return colors.sessionBranch;
  if (entry.label === "Error") return colors.sessionError;
  return colors.sessionMessage;
}

function formatTime(createdAt: number) {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
