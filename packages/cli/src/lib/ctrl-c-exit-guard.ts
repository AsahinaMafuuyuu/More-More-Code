export const CTRL_C_EXIT_WINDOW_MS = 1000;

export type CtrlCExitDecision = {
  shouldExit: boolean;
  nextPressedAt: number | null;
};

export function resolveCtrlCExit(
  previousPressedAt: number | null,
  pressedAt: number,
): CtrlCExitDecision {
  if (
    previousPressedAt !== null &&
    pressedAt >= previousPressedAt &&
    pressedAt - previousPressedAt <= CTRL_C_EXIT_WINDOW_MS
  ) {
    return {
      shouldExit: true,
      nextPressedAt: null,
    };
  }

  return {
    shouldExit: false,
    nextPressedAt: pressedAt,
  };
}
