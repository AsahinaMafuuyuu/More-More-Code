import { useTerminalDimensions } from "@opentui/react";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export type TerminalDimensions = {
  width: number;
  height: number;
};

const TerminalDimensionsContext = createContext<TerminalDimensions | null>(null);

export function TerminalDimensionsProvider({ children }: { children: ReactNode }) {
  // OpenTUI's hook owns one CliRenderer "resize" listener. Keep that
  // subscription at the application boundary and fan dimensions out through
  // React context so persistent transcript rows cannot accumulate listeners.
  const dimensions = useTerminalDimensions();
  const value = useMemo(
    () => ({ width: dimensions.width, height: dimensions.height }),
    [dimensions.height, dimensions.width],
  );

  return (
    <TerminalDimensionsContext.Provider value={value}>
      {children}
    </TerminalDimensionsContext.Provider>
  );
}

export function useUiTerminalDimensions(): TerminalDimensions {
  const value = useContext(TerminalDimensionsContext);
  if (!value) {
    throw new Error(
      "useUiTerminalDimensions must be used within a TerminalDimensionsProvider",
    );
  }
  return value;
}
