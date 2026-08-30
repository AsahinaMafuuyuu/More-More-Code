import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  SessionUiEquality,
  SessionUiSelector,
  SessionUiStore,
} from "./session-ui-store";

const SessionUiStoreContext = createContext<SessionUiStore | null>(null);

export function SessionUiStoreProvider({
  store,
  children,
}: {
  store: SessionUiStore;
  children: ReactNode;
}) {
  return (
    <SessionUiStoreContext.Provider value={store}>
      {children}
    </SessionUiStoreContext.Provider>
  );
}

export function useSessionUiStore(): SessionUiStore {
  const store = useContext(SessionUiStoreContext);
  if (!store) {
    throw new Error("SessionUiStoreProvider is required for Session UI consumers");
  }
  return store;
}

export function useSessionUiSelector<T>(
  selector: SessionUiSelector<T>,
  equality: SessionUiEquality<T> = Object.is,
): T {
  const store = useSessionUiStore();
  const readSelected = useMemo(
    () => createSelectedSnapshotReader(store, selector, equality),
    [store, selector, equality],
  );
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeSelector(selector, listener, equality),
    [store, selector, equality],
  );

  return useSyncExternalStore(subscribe, readSelected, readSelected);
}

function createSelectedSnapshotReader<T>(
  store: SessionUiStore,
  selector: SessionUiSelector<T>,
  equality: SessionUiEquality<T>,
): () => T {
  let initialized = false;
  let selected: T;
  return () => {
    const next = selector(store.getSnapshot());
    if (!initialized || !equality(selected, next)) {
      selected = next;
      initialized = true;
    }
    return selected;
  };
}
