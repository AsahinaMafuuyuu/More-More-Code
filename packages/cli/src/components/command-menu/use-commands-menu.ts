import { useRef, useState, useMemo, type RefObject } from "react";
import { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { getFilteredCommands } from "./filter-commands";
import type { Command } from "./types";

type useCommandsMenuReturn = {
    showCommandMenu: boolean; // 是否显示命令菜单
    commandQuery: string; // 命令菜单的查询条件
    selectedIndex: number; // 选中的命令索引
    scrollRef: RefObject<ScrollBoxRenderable | null>; // 滚动条引用
    handleContentChange: (text: string) => void; // 输入框内容改变的回调
    resolveCommand: (index: number) => Command | undefined; // 解析命令的回调
    setSelectedIndex: (index: number) => void; // 设置选中的命令索引的回调
};

export function useCommandsMenu(): useCommandsMenuReturn {
    const [showCommandMenu, setShowCommandMenu] = useState(false); // 是否显示命令菜单
    const [textValue, setTextValue] = useState(""); // 输入框内容
    const [selectedIndex, setSelectedIndex] = useState(0); // 选中的命令索引
    const scrollRef = useRef<ScrollBoxRenderable | null>(null);
    const commandQuery = showCommandMenu && textValue.startsWith('/') ? textValue.slice(1) : ''; // 命令菜单的查询条件

    const filteredCommands = useMemo(() => {
        return getFilteredCommands(commandQuery);
    }, [commandQuery]); // 获取过滤后的命令

    // 输入框内容改变的回调
    const handleContentChange = (text: string) => {
        setTextValue(text); // 设置输入框内容
        setSelectedIndex(0); // 重置选中的命令索引

        // 当用户输入新的字符的时候，滚动到顶部
        const scrollBox = scrollRef.current;
        if (scrollBox) {
            scrollBox.scrollTo(0);
        }

        const prefix = text.startsWith('/') ? text.slice(1) : null; // 获取输入的命令前缀
        // 如果前缀是/并且后面一个字符不是空格，则显示命令菜单
        if (prefix !== null && !prefix.includes(' ')) {
            setShowCommandMenu(true);
        } else {
            setShowCommandMenu(false);
        }
    };

    // 解析命令的回调,也就是当用户选中一个命令的时候，会调用这个回调
    const resolveCommand = (index: number) => {
        const command = filteredCommands[index]; // 获取选中的命令
        if (command) {
            setShowCommandMenu(false);
        }
        return command;
    };

    // 监听键盘事件,上下键切换命令菜单的选中项
    useKeyboard((key) => {
        if (!showCommandMenu) {
            return;
        }
        if (key.name === 'escape') {
            setShowCommandMenu(false);

        } else if (key.name === 'up') {
            key.preventDefault();
            setSelectedIndex((i: number) => {
                const newIndex = Math.max(0, i - 1); // 确保索引不小于0
                const sb = scrollRef.current; // 获取滚动条引用
                // 由于在终端内，每一个选项的高度是1行，所以这里减1
                if (sb && newIndex < sb.scrollTop) {
                    sb.scrollTo(newIndex); // 滚动到指定索引
                }
                return newIndex;
            });

        } else if (key.name === 'down') {
            key.preventDefault();
            setSelectedIndex((i: number) => {
                // 如果命令列表为空，则返回当前索引
                if (filteredCommands.length === 0) {
                    return 0;
                }
                const newIndex = Math.min(filteredCommands.length - 1, i + 1); // 确保索引不超过命令列表的长度
                const sb = scrollRef.current; // 获取滚动条引用
                // 由于在终端内，每一个选项的高度是1行，所以这里加1
                if (sb ) {
                    const viewportHeight = sb.viewport.height; // 获取终端的视口高度
                    const visibleEnd = sb.scrollTop + viewportHeight - 1; // 获取终端的可见区域的结束索引
                    if (newIndex > visibleEnd) {
                        // 如果新索引超过可见区域的结束索引，则滚动到指定索引
                        sb.scrollTo(newIndex - viewportHeight + 1); // 滚动到指定索引
                    }
                }
                return newIndex;
            })

        } else if (key.name === 'enter'|| key.name === 'tab') {
            // 监听回车和tab键，触发解析命令的回调
            const command = resolveCommand(selectedIndex);
            if (command) {

            }
        }
    })

    return {
        showCommandMenu,
        commandQuery,
        selectedIndex,
        scrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex
    };
}