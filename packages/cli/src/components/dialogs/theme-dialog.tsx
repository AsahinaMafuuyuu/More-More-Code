import { useCallback, useEffect, useRef } from "react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { THEMES } from "../../theme";
import type { Theme } from "../../theme";

export const ThemeDialogContent = () => {
    const dialog = useDialog();
    const { setTheme, currentTheme } = useTheme();
    const originalThemeRef = useRef(currentTheme); // 用于存储原始主题，防止在关闭对话框时重复调用setTheme
    const confirmedRef = useRef(false); // 防止在关闭对话框时重复调用setTheme

    // 当用户没有确认时，关闭对话框时恢复原始主题
    useEffect(() => {
        return () => {
            if (!confirmedRef.current) {
                setTheme(originalThemeRef.current);
            }
        };
    }, [setTheme]);

    // 处理选择主题的回调函数
    const handleSelect = useCallback((theme: Theme) => {
        setTheme(theme);
        confirmedRef.current = true;
        dialog.close();
    }, [setTheme, dialog]);

    // 处理高亮主题的回调函数
    const handleHighlight = useCallback((theme: Theme) => {
        setTheme(theme); // 预览高亮主题, 但是不确认
    }, [setTheme]);

    return (
        <DialogSearchList
            items={THEMES}
            onSelect={handleSelect}
            onHighlight={handleHighlight}
            filterFn={(item, query) => item.name.
                toLowerCase().
                includes(query.toLowerCase())} // 过滤函数
            renderItem={(theme, isSelected) => {
                return (
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : "white"}
                    >
                        {/* 如果是原始主题，则添加一个圆点 */}
                        {theme.name === originalThemeRef.current.name
                            ? "\u0020\u2022\u0020" : "\u0020\u0020\u0020"}
                        {theme.name}
                    </text>
                )
            }}
            getKey={(item) => item.name}
            placeholder="Search themes"
            emptyText="No matching themes"
        />
    )
};