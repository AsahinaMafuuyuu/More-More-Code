import type { ModelRef, ModeType } from "@more-more-code/shared";

export async function commitPromptModelChange(input: {
  model: ModelRef;
  onModelChange?: (model: ModelRef) => void | Promise<void>;
  setModel: (model: ModelRef) => void;
}) {
  await input.onModelChange?.(input.model);
  input.setModel(input.model);
}

export async function commitPromptModeChange(input: {
  mode: ModeType;
  onModeChange?: (mode: ModeType) => void | Promise<void>;
  setMode: (mode: ModeType) => void;
}) {
  await input.onModeChange?.(input.mode);
  input.setMode(input.mode);
}
