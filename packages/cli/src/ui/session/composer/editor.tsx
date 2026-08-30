import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";

export const COMPOSER_TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
  { name: "return", shift: true, action: "newline" },
];

export type EditorHandle = {
  getText(): string;
  getCursorOffset(): number;
  setText(text: string, cursorOffset?: number): void;
  clear(): void;
};

export const Editor = forwardRef<EditorHandle, {
  disabled?: boolean;
  focused: boolean;
  onSubmit: () => void;
  onChange: (text: string, cursorOffset: number) => void;
}>(function Editor({ disabled = false, focused, onSubmit, onChange }, forwardedRef) {
  const textareaRef = useRef<TextareaRenderable>(null);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  useImperativeHandle(forwardedRef, () => ({
    getText: () => textareaRef.current?.plainText ?? "",
    getCursorOffset: () => textareaRef.current?.cursorOffset ?? 0,
    setText(text, cursorOffset) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.replaceText(text);
      textarea.cursorOffset = cursorOffset ?? text.length;
      onChange(text, textarea.cursorOffset);
    },
    clear() {
      textareaRef.current?.setText("");
      onChange("", 0);
    },
  }), [onChange]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.onSubmit = () => submitRef.current();
  }, []);

  return (
    <textarea
      ref={textareaRef}
      focused={!disabled && focused}
      placeholder={'Ask anything..."Fix a bug in the database"'}
      width="100%"
      overflow="scroll"
      keyBindings={COMPOSER_TEXTAREA_KEY_BINDINGS}
      onContentChange={() => {
        const textarea = textareaRef.current;
        if (textarea) onChange(textarea.plainText, textarea.cursorOffset);
      }}
    />
  );
});
