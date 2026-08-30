import type {
  SessionUiState,
  SessionUiStore,
} from "../store/session-ui-store";

export type PresentationPatch = Partial<Pick<
  SessionUiState,
  "conversation" | "activity" | "status"
>>;

export type ImmediatePatch = Partial<Pick<
  SessionUiState,
  "composerRuntime" | "interactionQueue" | "activeRuntime" | "approval" | "recovery"
>>;

export type SessionUiCommitScheduler = Readonly<{
  enqueuePresentation(patch: PresentationPatch): void;
  commitImmediate(patch: ImmediatePatch): void;
  flush(): void;
  dispose(): void;
}>;

type TimerHandle = unknown;

export type SessionUiCommitSchedulerOptions = Readonly<{
  store: SessionUiStore;
  commitHz: number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}>;

export function createSessionUiCommitScheduler(
  options: SessionUiCommitSchedulerOptions,
): SessionUiCommitScheduler {
  if (!Number.isFinite(options.commitHz) || options.commitHz <= 0) {
    throw new Error("Session UI commit rate must be a positive finite frequency.");
  }

  const intervalMs = Math.ceil(1000 / options.commitHz);
  const scheduleTimeout = options.scheduleTimeout
    ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancelTimeout = options.clearTimeout
    ?? ((handle: TimerHandle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pending: PresentationPatch | null = null;
  let timer: TimerHandle | null = null;
  let disposed = false;

  const flush = () => {
    if (disposed || !pending) return;
    if (timer !== null) {
      cancelTimeout(timer);
      timer = null;
    }
    const patch = pending;
    pending = null;
    options.store.update(patch);
  };

  return Object.freeze({
    enqueuePresentation(patch) {
      if (disposed || Object.keys(patch).length === 0) return;
      pending = pending ? { ...pending, ...patch } : { ...patch };
      if (timer !== null) return;
      timer = scheduleTimeout(() => {
        timer = null;
        if (disposed || !pending) return;
        const next = pending;
        pending = null;
        options.store.update(next);
      }, intervalMs);
    },
    commitImmediate(patch) {
      if (disposed || Object.keys(patch).length === 0) return;
      flush();
      options.store.update(patch);
    },
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      if (timer !== null) {
        cancelTimeout(timer);
        timer = null;
      }
    },
  });
}
