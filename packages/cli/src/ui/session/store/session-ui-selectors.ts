import type {
  SessionUiState,
} from "./session-ui-store";

export const selectConversation = (state: SessionUiState) => state.conversation;
export const selectActivity = (state: SessionUiState) => state.activity;
export const selectStatus = (state: SessionUiState) => state.status;
export const selectComposerRuntime = (state: SessionUiState) => state.composerRuntime;
export const selectInteractionQueue = (state: SessionUiState) => state.interactionQueue;
export const selectActiveRuntime = (state: SessionUiState) => state.activeRuntime;
export const selectApproval = (state: SessionUiState) => state.approval;
export const selectRecovery = (state: SessionUiState) => state.recovery;
export const selectInspector = (state: SessionUiState) => state.inspector;
