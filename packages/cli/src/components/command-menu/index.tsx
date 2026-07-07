// 开发命令菜单组件
import type { RefObject } from 'react';
import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { getFilteredCommands } from './filter-commands';
import { COMMANDS } from './commands';
import { useTheme } from '../../providers/theme';

const MAX_VISIBLE_ITEMS = 8; // 最大可见命令数
const COMMAND_COL_WIDTH = Math.max(...COMMANDS.map(cmd => cmd.name.length)) + 4; // 找出最长命令名的长度，并加上额外的空格用于对齐

// 命令菜单组件的属性类型定义
type CommandMenuProps = {
    query: string; // 输入的查询字符串
    selectedIndex: number; // 当前选中的命令索引
    scrollRef: RefObject<ScrollBoxRenderable | null>; // 滚动容器的引用
    onSelect: (index: number) => void; // 选中命令的回调函数
    onExecute: (index: number) => void; // 执行命令的回调函数
};

export function CommandMenu({
    query,
    selectedIndex,
    scrollRef,
    onSelect,
    onExecute
}: CommandMenuProps) {
    const { colors } = useTheme(); // 使用useTheme()获取主题颜色
    const filteredCommands = getFilteredCommands(query); // 根据查询字符串过滤命令列表
    const visibleHeight = Math.min(filteredCommands.length, MAX_VISIBLE_ITEMS); // 计算可见命令的高度

    // 如果没有匹配的命令，则返回一个提示信息
    if (filteredCommands.length === 0) {
        return (
            <box
                padding={1}
            >
                <text attributes={TextAttributes.DIM}>
                    No matching commands
                </text>
            </box>
        );
    }
    return (
        <scrollbox ref={scrollRef} height={visibleHeight}>
            {filteredCommands.map((command, index) => {
                const isSelected = index === selectedIndex; // 判断当前命令是否被选中
                return (
                    <box
                        key={index}
                        flexDirection='row'
                        paddingLeft={1}
                        height={1}
                        backgroundColor={isSelected ? colors.selection : undefined}
                        onMouseMove={() => onSelect(index)}
                        onMouseDown={() => onExecute(index)}
                    >
                        {/* 用来装title和description */}
                        <box width={COMMAND_COL_WIDTH} flexShrink={0}>
                            <text selectable={false} fg={isSelected ? "black" : "white"}>/{command.name}</text>
                        </box>
                        <box flexGrow={1} flexShrink={1} overflow='hidden'>
                            <text selectable={false} fg={isSelected ? "black" : "grey"}>{command.description}</text>
                        </box>
                    </box>
                )
            }
            )}
        </scrollbox>
    )
}