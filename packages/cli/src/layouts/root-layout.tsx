import { Outlet } from "react-router";
import { ToastProvider } from "../providers/toast";
import { KeyboardLayerProvider } from "../providers/keyboard-layer";
import { DialogProvider } from "../providers/dialog";
import { ThemeProvider } from "../providers/theme";
import { ThemedRoot } from "./themed-root";
import { PromptConfigProvider } from "../providers/prompt-config";
import { TerminalDimensionsProvider } from "../providers/terminal-dimensions";

export function RootLayout() {
    return (
        <TerminalDimensionsProvider>
            <ThemeProvider>
                <ToastProvider>
                    <KeyboardLayerProvider>
                        <DialogProvider>
                            <PromptConfigProvider>
                                <ThemedRoot>
                                    <Outlet />
                                </ThemedRoot>
                            </PromptConfigProvider>
                        </DialogProvider>
                    </KeyboardLayerProvider>
                </ToastProvider>
            </ThemeProvider>
        </TerminalDimensionsProvider>
    );
};
