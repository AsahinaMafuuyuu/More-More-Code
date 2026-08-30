import type { ApprovalRequest } from "@more-more-code/harness";
import type { ModeType } from "@more-more-code/shared";
import type { AgentActivityView } from "../../../lib/agent-activity-projection";
import type { Message } from "../../../lib/chat-types";
import type { ConversationRunView } from "../../../lib/conversation-rounds";
import type { ToolUseView } from "../../../lib/tool-use-projection";

export type ConversationView = Readonly<{
  messages: readonly Message[];
  hiddenMessageCount: number;
  toolUses: Readonly<Record<string, ToolUseView>>;
  currentRun: ConversationRunView | null;
  errorMessage: string | null;
  runErrorMessage: string | null;
}>;

export type SessionStatusView = Readonly<{
  mode: ModeType;
  modelLabel: string;
  contextLabel: string;
  contextUtilizationRatio: number | null;
  costLabel: string;
  cacheLabel: string;
}>;

export type ComposerRuntimeView = Readonly<{
  disabled: boolean;
  runActive: boolean;
  canInterrupt: boolean;
  followUpAvailable: boolean;
}>;

export type PendingInteractionQueueItemView = Readonly<{
  id: string;
  kind: "steering" | "follow-up";
  text: string;
  createdAt: number;
}>;

export type PendingInteractionOutcomeView = Readonly<{
  id: string;
  kind: "steering" | "follow-up";
  text: string;
  reason: "run-interrupted" | "run-failed";
}>;

export type InteractionQueueView = Readonly<{
  pending: readonly PendingInteractionQueueItemView[];
  outcomes: readonly PendingInteractionOutcomeView[];
}>;

export type ActiveRuntimePhase = "idle" | "thinking" | "tools" | "responding" | "settling" | "compaction";

export type ActiveRuntimeCompactionPhase =
  | "compaction-starting"
  | "compaction-reducing"
  | "compaction-validating"
  | "compaction-fallback"
  | "compaction-applying"
  | "compaction-rebased"
  | "compaction-aborted"
  | "compaction-failed";

export type ActiveRuntimeCompactionView = Readonly<{
  planId: string;
  phase: ActiveRuntimeCompactionPhase;
  inputTokensBefore?: number;
  inputTokensAfter?: number;
}>;

export type ActiveRuntimeToolBatchView = Readonly<{
  total: number;
  active: number;
  completed: number;
  failed: number;
}>;

export type ActiveRuntimeView = Readonly<{
  phase: ActiveRuntimePhase;
  runId: string | null;
  startedAt: number | null;
  tools: ActiveRuntimeToolBatchView | null;
  compaction: ActiveRuntimeCompactionView | null;
}>;

export type ApprovalUiView = Readonly<ApprovalRequest>;

export type RecoveryUiView = Readonly<{
  key: string;
  message: string;
}>;

export type InspectorSection =
  | "tree"
  | "context"
  | "usage"
  | "runtime"
  | "security";

export type InspectorShellState = Readonly<{
  open: boolean;
  section: InspectorSection;
}>;

export type SessionUiState = Readonly<{
  conversation: ConversationView;
  activity: AgentActivityView | null;
  status: SessionStatusView;
  composerRuntime: ComposerRuntimeView;
  interactionQueue: InteractionQueueView;
  activeRuntime: ActiveRuntimeView;
  approval: ApprovalUiView | null;
  recovery: RecoveryUiView | null;
  inspector: InspectorShellState;
}>;

export type SessionUiSlice = keyof SessionUiState;
export type SessionUiSelector<T> = (state: SessionUiState) => T;
export type SessionUiEquality<T> = (left: T, right: T) => boolean;
export type SessionUiListener = () => void;

export interface SessionUiStore {
  getSnapshot(): SessionUiState;
  subscribe(listener: SessionUiListener): () => void;
  subscribeSelector<T>(
    selector: SessionUiSelector<T>,
    listener: SessionUiListener,
    equality?: SessionUiEquality<T>,
  ): () => void;
  setSlice<K extends SessionUiSlice>(key: K, value: SessionUiState[K]): void;
  update(patch: Partial<SessionUiState>): void;
  destroy(): void;
}

export function createInitialSessionUiState(
  overrides: Partial<SessionUiState> = {},
): SessionUiState {
  return freezeSnapshot({
    conversation: {
      messages: [],
      hiddenMessageCount: 0,
      toolUses: {},
      currentRun: null,
      errorMessage: null,
      runErrorMessage: null,
    },
    activity: null,
    status: {
      mode: "BUILD",
      modelLabel: "unknown",
      contextLabel: "—",
      contextUtilizationRatio: null,
      costLabel: "$—",
      cacheLabel: "Cache —",
    },
    composerRuntime: {
      disabled: false,
      runActive: false,
      canInterrupt: false,
      followUpAvailable: false,
    },
    interactionQueue: {
      pending: [],
      outcomes: [],
    },
    activeRuntime: {
      phase: "idle",
      runId: null,
      startedAt: null,
      tools: null,
      compaction: null,
    },
    approval: null,
    recovery: null,
    inspector: {
      open: false,
      section: "tree",
    },
    ...overrides,
  });
}

export function createSessionUiStore(initialState: SessionUiState): SessionUiStore {
  let snapshot = freezeSnapshot(initialState);
  let destroyed = false;
  const listeners = new Set<SessionUiListener>();

  const subscribe = (listener: SessionUiListener) => {
    if (destroyed) return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const commit = (next: SessionUiState) => {
    if (destroyed || next === snapshot) return;
    snapshot = freezeSnapshot(next, snapshot);
    for (const listener of [...listeners]) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe,
    subscribeSelector(selector, listener, equality = Object.is) {
      let selected = selector(snapshot);
      return subscribe(() => {
        const nextSelected = selector(snapshot);
        if (equality(selected, nextSelected)) return;
        selected = nextSelected;
        listener();
      });
    },
    setSlice(key, value) {
      if (destroyed || Object.is(snapshot[key], value)) return;
      commit({ ...snapshot, [key]: value });
    },
    update(patch) {
      if (destroyed) return;
      let changed = false;
      for (const key of Object.keys(patch) as SessionUiSlice[]) {
        if (!Object.is(snapshot[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      commit({ ...snapshot, ...patch });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  };
}

function freezeSnapshot(
  state: SessionUiState,
  previous?: SessionUiState,
): SessionUiState {
  return Object.freeze({
    ...state,
    conversation: previous && state.conversation === previous.conversation
      ? previous.conversation
      : Object.freeze({
          ...state.conversation,
          messages: Object.freeze([...state.conversation.messages]),
          toolUses: Object.freeze({ ...state.conversation.toolUses }),
          currentRun: state.conversation.currentRun
            ? Object.freeze({ ...state.conversation.currentRun })
            : null,
        }),
    activity: previous && state.activity === previous.activity
      ? previous.activity
      : state.activity
        ? Object.freeze({ ...state.activity })
        : null,
    status: previous && state.status === previous.status
      ? previous.status
      : Object.freeze({ ...state.status }),
    composerRuntime: previous && state.composerRuntime === previous.composerRuntime
      ? previous.composerRuntime
      : Object.freeze({ ...state.composerRuntime }),
    interactionQueue: previous && state.interactionQueue === previous.interactionQueue
      ? previous.interactionQueue
      : Object.freeze({
          pending: Object.freeze(state.interactionQueue.pending.map((item) => Object.freeze({ ...item }))),
          outcomes: Object.freeze(state.interactionQueue.outcomes.map((item) => Object.freeze({ ...item }))),
        }),
    activeRuntime: previous && state.activeRuntime === previous.activeRuntime
      ? previous.activeRuntime
      : Object.freeze({
          ...state.activeRuntime,
          tools: state.activeRuntime.tools
            ? Object.freeze({ ...state.activeRuntime.tools })
            : null,
          compaction: state.activeRuntime.compaction
            ? Object.freeze({ ...state.activeRuntime.compaction })
            : null,
        }),
    approval: previous && state.approval === previous.approval
      ? previous.approval
      : state.approval
        ? Object.freeze({ ...state.approval })
        : null,
    recovery: previous && state.recovery === previous.recovery
      ? previous.recovery
      : state.recovery
        ? Object.freeze({ ...state.recovery })
        : null,
    inspector: previous && state.inspector === previous.inspector
      ? previous.inspector
      : Object.freeze({ ...state.inspector }),
  });
}
