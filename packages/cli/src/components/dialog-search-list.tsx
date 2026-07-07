import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ScrollBox,
  TextAttributes,
  type InputRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useTheme } from "../providers/theme";

// 定义最大可见项数
const MAX_VISIBLE_ITEMS = 6;

type DialogSearchListProps<T> = {
  items: T[];
  onSelect: (item: T) => void;
  onHighlight?: (item: T) => void;
  filterFn: (item: T, query: string) => boolean;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  getKey: (item: T) => string;
  placeholder?: string;
  emptyText?: string;
};

export function DialogSearchList<T>({
  items,
  onSelect,
  onHighlight,
  filterFn,
  renderItem,
  getKey,
  placeholder = "Search",
  emptyText = "No results",
}: DialogSearchListProps<T>) {
  const { colors } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { isTopLayer } = useKeyboardLayer();

  const handleContentChange = useCallback(() => {
    const text = inputRef.current?.value ?? ""; // 获取输入框的值
    setSearchValue(text); // 设置搜索值
    setSelectedIndex(0); // 重置选中的索引

    const scrollBox = scrollRef.current; // 获取滚动框
    if (scrollBox) {
      scrollBox.scrollTo(0); // 滚动到顶部
    }
  }, [])

  // 过滤出符合搜索条件的项
  const filtered = searchValue ? items.filter((item) => filterFn(item, searchValue)) : items;

  // 计算可见项的高度
  const visibleHeight = Math.min(filtered.length, MAX_VISIBLE_ITEMS);

  useKeyboard((key) => {
    if (!isTopLayer('dialog')) return; // 如果当前不是dialog层，则不处理键盘事件
    if (key.name === 'return' || key.name === 'enter') { // 如果按下了回车键
      // 如果有选中的项，则触发onSelect回调
      const item = filtered[selectedIndex];
      if (item) onSelect(item);
    } else if (key.name === 'up') {
      setSelectedIndex((i) => {
        const newIndex = Math.max(0, i - 1); // 计算新的选中索引
        const sb = scrollRef.current; // 获取滚动框
        if (sb && newIndex < sb.scrollTop) { // 如果新的索引小于滚动框的滚动位置,
          // 则滚动到新的索引
          sb.scrollTo(newIndex);
        }
        const item = filtered[newIndex]; // 获取新的选中项
        if (item && onHighlight) onHighlight(item); // 如果有onHighlight回调，则触发
        return newIndex; // 返回新的选中索引
      });
    } else if (key.name === 'down') {
      setSelectedIndex((i) => {
        const newIndex = Math.min(filtered.length - 1, i + 1); // 计算新的选中索引
        const sb = scrollRef.current; // 获取滚动框
        if (sb) {
          const viewportHeight = sb.viewport.height;
          const visibleHeight = sb.scrollTop + viewportHeight - 1; // 计算可见项的高度
          if (newIndex > visibleHeight) { // 如果新的索引大于可见项的高度
            sb.scrollTo(newIndex - viewportHeight + 1); // 滚动到新的索引
          }
        }
        const item = filtered[newIndex]; // 获取新的选中项
        if (item && onHighlight) onHighlight(item); // 如果有onHighlight回调，则触发
        return newIndex;
      })
    }
  })

  return (
    <box
      flexDirection="column"
      gap={1}
    >
      <input
        ref={inputRef}
        placeholder={placeholder}
        focused
        onContentChange={handleContentChange}
      />
      {filtered.length === 0 ? (
        <text
          attributes={TextAttributes.DIM}
        >
          {emptyText}
        </text>
      ) : (
        <scrollbox
          ref={scrollRef}
          height={visibleHeight}
        >
          {filtered.map((item, index) => {
            const isSelected = index === selectedIndex; // 判断当前项是否被选中
            return (
              <box
                key={getKey(item)}
                flexDirection="row"
                height={1}
                overflow="hidden"
                backgroundColor={isSelected ? colors.selection : undefined}   // TODO :用主题颜色进行颜色替换

                onMouseMove={() => {
                  setSelectedIndex(index); // 鼠标移动时，设置选中索引
                  if (onHighlight) onHighlight(item); // 如果有onHighlight回调，则触发
                }}
                onMouseDown={() => onSelect(item)} // 鼠标点击时，触发onSelect回调
              >
                {renderItem(item, isSelected)}
              </box>
            )
          })}
        </scrollbox>
      )}
    </box>
  )
}
