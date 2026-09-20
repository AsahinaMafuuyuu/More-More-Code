import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect } from "react";
import type { SessionController } from "../../../app/session/session-controller";
import { useKeyboardLayer } from "../../../providers/keyboard-layer";
import { useTheme } from "../../../providers/theme";
import { useUiTerminalDimensions } from "../../../providers/terminal-dimensions";
import { ContextInspectorSection } from "../inspector/context-inspector-section";
import {
  INSPECTOR_SECTIONS,
  cycleInspectorSection,
} from "../inspector/inspector-model";
import { TreeInspectorSection } from "../inspector/tree-inspector-section";
import { UsageInspectorSection } from "../inspector/usage-inspector-section";
import { useSessionTreeCommandApi } from "../navigation/use-session-tree-command-api";
import {
  useSessionUiSelector,
  useSessionUiStore,
} from "../store/react-session-ui";
import {
  selectInspector,
  selectInspectorContext,
  selectInspectorTree,
  selectInspectorUsage,
} from "../store/session-ui-selectors";

export function InspectorSurface({ controller }: { controller: SessionController }) {
  const inspector = useSessionUiSelector(selectInspector);
  const context = useSessionUiSelector(selectInspectorContext);
  const usage = useSessionUiSelector(selectInspectorUsage);
  const treeView = useSessionUiSelector(selectInspectorTree);
  const store = useSessionUiStore();
  const tree = useSessionTreeCommandApi(controller);
  const { colors } = useTheme();
  const dimensions = useUiTerminalDimensions();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const narrow = dimensions.width < 72;

  const close = useCallback(() => {
    store.setSlice("inspector", { ...store.getSnapshot().inspector, open: false });
  }, [store]);

  const setSection = useCallback((section: typeof inspector.section) => {
    store.setSlice("inspector", { open: true, section });
  }, [store]);

  useEffect(() => {
    if (!inspector.open) return;
    push("inspector", () => true);
    return () => pop("inspector");
  }, [inspector.open, pop, push]);

  useKeyboard((key) => {
    if (!inspector.open || !isTopLayer("inspector")) return;
    if (key.name === "escape") {
      key.preventDefault();
      close();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setSection(cycleInspectorSection(inspector.section, key.shift ? -1 : 1));
    }
  });

  if (!inspector.open) return null;

  const contentRows = Math.max(6, dimensions.height - 7);

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={50}
      backgroundColor={colors.dialogSurface}
      flexDirection="column"
      paddingLeft={narrow ? 1 : 2}
      paddingRight={narrow ? 1 : 2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" flexShrink={0}>
        <text fg={colors.primary}>SESSION INSPECTOR</text>
        <box flexGrow={1} />
        <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>Tab sections · Esc close</text>
      </box>

      <box flexDirection="row" gap={narrow ? 1 : 2} flexShrink={0} overflow="hidden">
        {INSPECTOR_SECTIONS.map((section) => {
          const active = section.id === inspector.section;
          return (
            <box
              key={section.id}
              onMouseDown={() => setSection(section.id)}
              backgroundColor={active ? colors.selection : undefined}
            >
              <text
                fg={active ? "black" : section.delivered ? colors.primary : colors.sessionTimestampMuted}
                attributes={section.delivered ? undefined : TextAttributes.DIM}
              >
                {section.label}
              </text>
            </box>
          );
        })}
      </box>

      <box height={1} flexShrink={0} overflow="hidden">
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          {"─".repeat(Math.max(8, dimensions.width - (narrow ? 2 : 4)))}
        </text>
      </box>

      <box flexGrow={1} overflow="hidden">
        {inspector.section === "tree" && (
          <TreeInspectorSection
            view={treeView}
            tree={tree}
            narrow={narrow}
            availableRows={contentRows}
          />
        )}
        {inspector.section === "context" && (
          <ContextInspectorSection view={context} narrow={narrow} />
        )}
        {inspector.section === "usage" && (
          <UsageInspectorSection view={usage} narrow={narrow} />
        )}
        {(inspector.section === "runtime" || inspector.section === "security") && (
          <box flexDirection="column" gap={1}>
            <text fg={colors.primary}>{inspector.section === "runtime" ? "Runtime" : "Security"}</text>
            <text attributes={TextAttributes.DIM} fg={colors.sessionTimestamp}>
              This Inspector section is reserved for UI Slice 3 / P1-B and is not delivered in this stage.
            </text>
          </box>
        )}
      </box>
    </box>
  );
}
