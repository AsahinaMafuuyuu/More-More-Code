import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { ThemeColors, Theme } from "../../theme";
import { DEFAULT_THEME, THEMES } from "../../theme";

const CONFIG_DIR = join(homedir(), ".more-more-code");
const THEME_PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

type ThemePreferences = {
    themeName: string;
};

function getInitialTheme(): Theme {
    try {
        const preferences = JSON.parse(
            readFileSync(THEME_PREFERENCES_PATH, "utf8"),
        ) as Partial<ThemePreferences>;
        const savedTheme = THEMES.find((theme) => theme.name === preferences.themeName);
        return savedTheme ?? DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
};

function persistTheme(theme: Theme) {
    try {
        mkdirSync(CONFIG_DIR, { recursive: true }); // 创建配置目录
        writeFileSync(
            THEME_PREFERENCES_PATH,
            JSON.stringify({ themeName: theme.name } satisfies
                ThemePreferences,
                null,
                2
            ), // 将主题名称写入配置文件
            "utf8"
        ); // 保存主题名称

    } catch {
    }
}

type ThemeContextValue = {
    colors: ThemeColors;
    currentTheme: Theme;
    setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null); // 创建主题上下文

// 定义ThemeProvider组件
export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext); // 获取主题上下文
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}

type ThemeProviderProps = {
    children: ReactNode;
}

// 定义ThemeProvider组件
export function ThemeProvider({ children }: ThemeProviderProps) {
    const [currentTheme, setCurrentTheme] = useState<Theme>(getInitialTheme()); // 获取初始主题

    const setTheme = useCallback((theme: Theme) => {
        setCurrentTheme(theme);
        persistTheme(theme);
    }, []);  // 定义设置主题的函数

    return (
        <ThemeContext.Provider value={{
            colors: currentTheme.colors,
            currentTheme, setTheme
        }}>
            {children}
        </ThemeContext.Provider>
    );
}
