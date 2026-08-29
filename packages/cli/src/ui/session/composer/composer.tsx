import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ModeType } from "@more-more-code/shared";
import { useKeyboardLayer } from "../../../providers/keyboard-layer";
import { useTheme } from "../../../providers/theme";
import { getFilteredCommands } from "../../../components/command-menu/filter-commands";
import { Editor, type EditorHandle } from "./editor";
import { findActiveMention, replaceActiveMention, type MentionCandidate, type MentionMatch } from "./mention-model";
import { searchMentionCandidates } from "./mention-search";
import { MentionMenu } from "./mention-menu";
import { ComposerCommandMenu, resolveComposerCommandIntent } from "./command-menu";
import type { ComposerIntent } from "./composer-intent";
import { resolveInteractionAction, type InteractionState } from "../interaction/interaction-router";

export type ComposerProps = {
  onSubmit: (text: string) => void;
  onFollowUp?: (text: string) => void;
  onSteer?: (text: string) => void;
  onIntent?: (intent: ComposerIntent) => void | Promise<void>;
  disabled?: boolean;
  runActive?: boolean;
  mode: ModeType;
  workspaceRoot?: string;
};

export function Composer({
  onSubmit,
  onFollowUp,
  onSteer,
  onIntent,
  disabled = false,
  runActive = false,
  mode,
  workspaceRoot = process.cwd(),
}: ComposerProps) {
  const { colors } = useTheme();
  const { isTopLayer, push, pop } = useKeyboardLayer();
  const editorRef = useRef<EditorHandle>(null);
  const commandScrollRef = useRef<ScrollBoxRenderable>(null);
  const mentionScrollRef = useRef<ScrollBoxRenderable>(null);
  const activeMentionRef = useRef<MentionMatch | null>(null);
  const [text, setText] = useState("");
  const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

  const commandOpen = text.startsWith("/") && !text.slice(1).includes(" ");
  const commandQuery = commandOpen ? text.slice(1) : "";
  const mentionOpen = !commandOpen && activeMention !== null;

  const getInteractionState = useCallback((): InteractionState => ({
    dialog: isTopLayer("dialog"),
    overlay: commandOpen ? "command" : mentionOpen ? "mention" : null,
    inspector: isTopLayer("inspector"),
    composer: isTopLayer("base"),
    runInterruptible: false,
    runActive,
  }), [commandOpen, isTopLayer, mentionOpen, runActive]);

  useEffect(() => {
    if (commandOpen) push("command", () => true);
    else pop("command");
    return () => pop("command");
  }, [commandOpen, pop, push]);

  useEffect(() => {
    if (mentionOpen) push("mention", () => true);
    else pop("mention");
    return () => pop("mention");
  }, [mentionOpen, pop, push]);

  useEffect(() => {
    if (!activeMention) {
      setMentionCandidates([]);
      return;
    }
    let stale = false;
    void searchMentionCandidates(activeMention.query, workspaceRoot).then((candidates) => {
      if (stale) return;
      setMentionCandidates(candidates);
      setMentionSelectedIndex((index) => Math.min(index, Math.max(0, candidates.length - 1)));
    });
    return () => { stale = true; };
  }, [activeMention, workspaceRoot]);

  const handleChange = useCallback((nextText: string, cursorOffset: number) => {
    setText(nextText);
    setCommandSelectedIndex(0);
    commandScrollRef.current?.scrollTo(0);
    const mention = findActiveMention(nextText, cursorOffset);
    activeMentionRef.current = mention;
    setActiveMention(mention);
    if (mention) {
      setMentionSelectedIndex(0);
      mentionScrollRef.current?.scrollTo(0);
    }
  }, []);

  const clearEditor = useCallback(() => {
    editorRef.current?.clear();
    activeMentionRef.current = null;
    setActiveMention(null);
  }, []);

  const executeCommand = useCallback((index: number) => {
    const intent = resolveComposerCommandIntent(commandQuery, index);
    if (!intent) return;
    clearEditor();
    void onIntent?.(intent);
  }, [clearEditor, commandQuery, onIntent]);

  const executeMention = useCallback((index: number) => {
    const mention = activeMentionRef.current;
    const candidate = mentionCandidates[index];
    const editor = editorRef.current;
    if (!mention || !candidate || !editor) return;
    const replacement = replaceActiveMention({
      text: editor.getText(),
      mention,
      candidate,
    });
    editor.setText(replacement.text, replacement.cursorOffset);
  }, [mentionCandidates]);

  const submit = useCallback(() => {
    if (disabled) return;
    const action = resolveInteractionAction("enter", getInteractionState());
    if (action?.action === "select-command") {
      executeCommand(commandSelectedIndex);
      return;
    }
    if (action?.action === "select-mention") {
      executeMention(mentionSelectedIndex);
      return;
    }
    if (action?.action !== "submit" && action?.action !== "follow-up") return;
    const value = editorRef.current?.getText().trim() ?? "";
    if (!value) return;
    if (action.action === "follow-up") onFollowUp?.(value);
    else onSubmit(value);
    clearEditor();
  }, [clearEditor, commandSelectedIndex, disabled, executeCommand, executeMention, getInteractionState, mentionSelectedIndex, onFollowUp, onSubmit]);

  const followUp = useCallback(() => {
    if (disabled || !onFollowUp || commandOpen || mentionOpen) return;
    const value = editorRef.current?.getText().trim() ?? "";
    if (!value) return;
    onFollowUp(value);
    clearEditor();
  }, [clearEditor, commandOpen, disabled, mentionOpen, onFollowUp]);

  const steer = useCallback(() => {
    if (disabled || !onSteer || commandOpen || mentionOpen) return;
    const value = editorRef.current?.getText().trim() ?? "";
    if (!value) return;
    onSteer(value);
    clearEditor();
  }, [clearEditor, commandOpen, disabled, mentionOpen, onSteer]);

  useKeyboard((key) => {
    if (disabled) return;
    const interactionKey = (key.name === "enter" || key.name === "return") && key.ctrl
      ? "steering"
      : key.name === "escape" || key.name === "up" || key.name === "down" || key.name === "tab"
        ? key.name
        : null;
    if (!interactionKey) return;

    const action = resolveInteractionAction(interactionKey, getInteractionState());
    if (!action) return;
    key.preventDefault();

    switch (action.action) {
      case "close-command":
        editorRef.current?.clear();
        return;
      case "close-mention":
        activeMentionRef.current = null;
        setActiveMention(null);
        return;
      case "command-prev":
      case "command-next": {
        const count = getFilteredCommands(commandQuery).length;
        setCommandSelectedIndex((index) => action.action === "command-prev"
          ? Math.max(0, index - 1)
          : Math.min(Math.max(0, count - 1), index + 1));
        return;
      }
      case "mention-prev":
      case "mention-next":
        setMentionSelectedIndex((index) => action.action === "mention-prev"
          ? Math.max(0, index - 1)
          : Math.min(Math.max(0, mentionCandidates.length - 1), index + 1));
        return;
      case "toggle-mode":
        void onIntent?.({ type: "change-mode", mode: mode === "BUILD" ? "PLAN" : "BUILD" });
        return;
      case "follow-up":
        key.stopPropagation();
        followUp();
        return;
      case "steering":
        key.stopPropagation();
        steer();
        return;
    }
  });

  return (
    <box width="100%" alignItems="center">
      <box width="100%" border={["left"]} borderColor={mode === "PLAN" ? colors.planMode : colors.primary}>
        <box position="relative" paddingX={2} paddingY={1} backgroundColor={colors.surface} width="100%" gap={1}>
          {commandOpen && (
            <box position="absolute" bottom="100%" left={0} width="100%" backgroundColor={colors.surface} zIndex={10}>
              <ComposerCommandMenu
                query={commandQuery}
                selectedIndex={commandSelectedIndex}
                scrollRef={commandScrollRef}
                onSelect={setCommandSelectedIndex}
                onIntent={(intent) => {
                  clearEditor();
                  void onIntent?.(intent);
                }}
              />
            </box>
          )}
          {mentionOpen && (
            <box position="absolute" bottom="100%" left={0} width="100%" backgroundColor={colors.surface} zIndex={10}>
              <MentionMenu
                candidates={mentionCandidates}
                selectedIndex={mentionSelectedIndex}
                scrollRef={mentionScrollRef}
                onSelect={setMentionSelectedIndex}
                onExecute={executeMention}
              />
            </box>
          )}
          <Editor
            ref={editorRef}
            disabled={disabled}
            focused={isTopLayer("base") || isTopLayer("command") || isTopLayer("mention")}
            onSubmit={submit}
            onChange={handleChange}
          />
        </box>
      </box>
    </box>
  );
}
