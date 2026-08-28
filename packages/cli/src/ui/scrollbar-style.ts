import type { ScrollBoxOptions } from "@opentui/core";
import type { ThemeColors } from "../theme";

export function createTerminalScrollbarOptions(
  colors: ThemeColors,
): NonNullable<ScrollBoxOptions["verticalScrollbarOptions"]> {
  return {
    showArrows: false,
    trackOptions: {
      backgroundColor: colors.background,
      foregroundColor: colors.dimSeparator,
    },
  };
}
