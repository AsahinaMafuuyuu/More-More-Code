// 输入框整体
import { readdir } from "fs/promises";
import { isAbsolute, resolve, relative } from "node:path";
import { TextAttributes } from "@opentui/core";

import { type KeyBinding } from "@opentui/core";
import { useRef, useState, useCallback, useEffect, type RefObject } from "react";
import type { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useNavigate } from "react-router";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { Command } from "./command-menu/types";
import { CommandMenu } from "./command-menu";
import StatusBar from "./status-bar";
import { useCommandsMenu } from "./command-menu/use-commands-menu";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode } from "@more-more-code/database";
import { reallyExit } from "node:process";
import { en } from "zod/locales";
import { set } from "zod";
import { handle } from "hono/cloudflare-pages";
import { text } from "node:stream/consumers";

// 这些变量主要用于@提及功能的实现
const MAX_VISIBLE_MENTIONS = 8; // 最大可见的提及数量
const CURRENT_DIRECTORY = process.cwd(); // 当前工作目录
const MAX_FALLBACK_MENTION_CANDIDATES = 32; // 最大回退提及候选数量
const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/; // 规定@后面允许出现的字符类型
const RECURSIVE_MENTION_IGNORE_DIRECTORIES = new Set(['node_modules']); // 递归提及忽略的目录集合

// 提及匹配类型
/**
 * 
 * MentionMatch
    type MentionMatch = {
        start: number;
        end: number;
        query: string;
    };

    表示当前识别出的一个有效 @提及。

    例如：

    分析 @src/index.ts 的代码

    假设 @ 位于索引 3，那么结果大致为：

    {
        start: 3,
        end: 16,
        query: "src/index.ts"
    }

    其中：

    start：包含 @ 的起始索引；
    end：提及结束位置，不包含该位置字符；
    query：去掉 @ 后的查询内容。


 */
type MentionMatch = {
    start: number;
    end: number;
    query: string;
}

type MentionCandidate = {
    path: string;
    kind: "file" | "directory";
}

function isWithinCurrentDirectory(targetPath: string) {
    const relativePath = relative(CURRENT_DIRECTORY, targetPath);
    // 如果相对路径为空，说明是当前目录
    // 如果相对路径不以..开头，说明是当前目录的子目录
    // 如果相对路径不是绝对路径，说明是当前目录的子目录
    return relativePath === ""
        || (!relativePath.startsWith("..")
            && !isAbsolute(relativePath));
}

// 对正则判断的简单封装。
function isMentionQueryCharacter(char: string): boolean {
    return MENTION_QUERY_CHARACTER.test(char);
}

// 它负责判断：
// 当前光标是否处于一个有效的 @提及 范围内。
// 如果是，返回提及位置和查询内容；否则返回 null。
/**
 * 流程未：
 * 1. 先通过空白字符来确定光标所在的 token 范围；
 * 2. 然后在 token 范围内查找最后一个 @ 符号，确定提及的起始位置；
 * 但以下形式允许：
    (@src/index.ts)
    因为 @ 前面是 (，不是查询字符。
    3. 然后从 @ 符号开始向后查找，直到遇到非查询字符，确定提及的结束位置；
    例如：
        (@src/index.ts),
        识别结果只包括：
        @src/index.ts
        不会包括：
        (
        )
        ,
        因为这些字符不属于：
        [A-Za-z0-9._/-]
 */
function findActiveMention(text: string, cursorOffset: number): MentionMatch | null {
    const safeOffset = Math.max(0, Math.min(cursorOffset, text.length)); // 确保光标偏移量不超过文本长度

    let start = safeOffset; // 从光标位置开始向前查找提及的起始位置
    // 主要找空白文本
    // 这里的空白包括：
    // 普通空格；
    // 换行；
    // Tab；
    // 其他 Unicode 空白字符。
    while (start > 0 && !/\s/.test(text[start - 1]!)) {
        start--;
    }

    let end = safeOffset; // 从光标位置开始向后查找提及的结束位置
    // 也是找空白文本
    while (end < text.length && !/\s/.test(text[end]!)) {
        end++;
    }

    const token = text.slice(start, end); // 获取提及的文本
    const relativeCursor = safeOffset - start; // 计算光标在提及文本中的相对位置
    const mentionStart = token.lastIndexOf("@", relativeCursor); // 查找提及的起始位置

    if (mentionStart === -1) { // 如果没有找到@符号，说明当前光标所在文本不是提及
        return null;
    }

    const previousCharacter = token[mentionStart - 1]; // 获取@符号前一个字符
    if (previousCharacter && isMentionQueryCharacter(previousCharacter)) { // 如果@符号前一个字符是合法字符（也就不是空白字符，则可能是内容，比如邮箱）
        return null;
    }

    let mentionEnd = mentionStart + 1; // 从@符号后一个字符开始向后查找提及的结束位置
    while (mentionEnd < token.length && isMentionQueryCharacter(token[mentionEnd]!)) { // 如果当前字符是提及查询字符，则继续向后查找
        mentionEnd++;
    }

    if (relativeCursor < mentionStart || relativeCursor > mentionEnd) { // 如果光标不在提及范围内，则说明没有提及
        return null;
    }

    return {
        start: start + mentionStart, // 提及的起始位置
        end: start + mentionEnd, // 提及的结束位置
        query: token.slice(mentionStart + 1, mentionEnd) // 提及的查询文本
    }
}

async function getMentionCandidates(query: string): Promise<MentionCandidate[]> {
    const normalizedQuery = query.startsWith('./') ? query.slice(2) : query; // 去掉开头的 ./，因为它是冗余的
    if (normalizedQuery.startsWith('/')) {
        // 如果以 / 开头，说明是绝对路径，直接返回空数组
        return [];
    }

    const hasTrailingSlash = normalizedQuery.endsWith('/'); // 判断是否以 / 结尾,如果是的话证明当前是一个目录，需要加载更多的内容
    const lastSlashIndex = hasTrailingSlash
        ? normalizedQuery.length - 1
        : normalizedQuery.lastIndexOf('/'); // 查找最后一个 / 的索引位置, -1代表没有找到 /，说明是当前目录下的文件或目录

    const directoryPart = hasTrailingSlash
        ? normalizedQuery.slice(0, -1) // 去掉最后一个 /，获取目录部分
        : lastSlashIndex === -1
            ? ""
            : normalizedQuery.slice(0, lastSlashIndex); // 获取目录部分

    const namePrefix = hasTrailingSlash
        ? ""
        : lastSlashIndex === -1
            ? normalizedQuery
            : normalizedQuery.slice(lastSlashIndex + 1); // 获取文件名部分

    const absoluteDirectoryPath = resolve(CURRENT_DIRECTORY, directoryPart || "."); // 获取目录的绝对路径
    if (!isWithinCurrentDirectory(absoluteDirectoryPath)) { // 如果不在当前目录下，返回空数组
        return [];
    }

    try {
        const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true }); // 读取目录内容
        const lowercasePrefix = namePrefix.toLowerCase(); // 将文件名部分转换为小写
        const showHiddenEntries = namePrefix.startsWith('.'); // 如果文件名部分以 . 开头，则显示隐藏文件

        const directMatches = entries
            .filter((entry) => {
                return showHiddenEntries || !entry.name.startsWith('.'); // 如果不显示隐藏文件，则过滤掉以 . 开头的文件
            })
            .filter((entry) => {
                // 如果文件名部分为空，则显示所有文件，否则过滤掉不匹配的文件
                return lowercasePrefix === "" || entry.name.toLowerCase().startsWith(lowercasePrefix);
            })
            .sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) {
                    return a.isDirectory() ? -1 : 1; // 目录排在前面
                }
                return a.name.localeCompare(b.name); // 按照字母顺序排序
            })
            .map((entry) => {
                // 拼接路径,如果目录部分为空，则直接使用文件名，否则使用目录部分加上文件名
                const path = directoryPart ? `${directoryPart}/${entry.name}` : entry.name;

                const kind: MentionCandidate['kind'] = entry.isDirectory() ? "directory" : "file"; // 判断是文件还是目录
                return {
                    path: kind === "directory" ? `${path}/` : path, // 如果是目录，则在路径后面加上 /，否则直接使用路径
                    kind,
                }
            })

        // 如果有直接匹配的文件，或者目录部分不为空，或者文件名部分为空，则直接返回直接匹配的文件 
        if (directMatches.length > 0 || directoryPart !== "" || namePrefix === "") {
            return directMatches;
        }

        const fallbackMatches: MentionCandidate[] = []; // 回退匹配的文件
        const visit = async (
            absoluteDirectory: string,
            directoryPart: string
        ): Promise<void> => {
            const entries = await readdir(absoluteDirectory, { withFileTypes: true }); // 读取目录内容

            for (const entry of entries) {
                if (!showHiddenEntries && entry.name.startsWith('.')) {
                    continue; // 如果不显示隐藏文件，则跳过以 . 开头的文件
                }

                if (entry.isDirectory() && RECURSIVE_MENTION_IGNORE_DIRECTORIES.has(entry.name)) {
                    continue; // 如果是忽略的目录，则跳过
                }

                const path = directoryPart ? `${directoryPart}/${entry.name}` : entry.name; // 拼接路径
                const kind: MentionCandidate['kind'] = entry.isDirectory() ? "directory" : "file"; // 判断是文件还是目录

                // 如果文件名部分匹配，则添加到回退匹配的文件中
                if (entry.name.toLowerCase().startsWith(lowercasePrefix)) {
                    fallbackMatches.push({
                        path: kind === "directory" ? `${path}/` : path, // 如果是目录，则在路径后面加上 /，否则直接使用路径
                        kind,
                    });

                    if (fallbackMatches.length >= MAX_FALLBACK_MENTION_CANDIDATES) {
                        return; // 如果回退匹配的文件数量超过最大值，则返回
                    }
                }

                if (entry.isDirectory()) {
                    await visit(resolve(absoluteDirectory, entry.name), path); // 递归访问子目录
                    if (fallbackMatches.length >= MAX_FALLBACK_MENTION_CANDIDATES) {
                        return; // 如果回退匹配的文件数量超过最大值，则返回
                    }
                }

            }
        }

        await visit(CURRENT_DIRECTORY, ""); // 访问当前目录
        return fallbackMatches
            .sort((a, b) => a.path.localeCompare(b.path)) // 按照字母顺序排序
    } catch (error) {
        return []; // 如果读取目录失败，返回空数组
    }
}

type FileMentionMenuProps = {
    candidates: MentionCandidate[];
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    onSelect: (index: number) => void;
    onExecute: (index: number) => void;
}

function FileMentionMenu({
    candidates,
    selectedIndex,
    scrollRef,
    onSelect,
    onExecute
}: FileMentionMenuProps) {
    const { colors } = useTheme();
    const visibleHeight = Math.min(candidates.length, MAX_VISIBLE_MENTIONS); // 计算可见的提及数量

    if (candidates.length === 0) {
        return (
            <box
                paddingX={1}
            >
                <text attributes={TextAttributes.DIM}>No matching files or directories</text>
            </box>
        )
    }

    return (
        <scrollbox
            ref={scrollRef}
            height={visibleHeight}
        >
            {candidates.map((candidate, index) => {
                const isSelected = index === selectedIndex; // 判断当前提及是否被选中
                return (
                    <box
                        key={candidate.path}
                        flexDirection="row"
                        width="100%"
                        paddingX={1}
                        height={1}
                        overflow="hidden"
                        justifyContent="space-between"
                        backgroundColor={isSelected ? colors.selection : undefined}
                        onMouseMove={() => onSelect(index)}
                        onMouseDown={() => onExecute(index)}
                    >
                        <box flexGrow={1} flexShrink={1} overflow="hidden">
                            <text selectable={false} fg={isSelected ? "black" : "white"}>
                                {candidate.path}
                            </text>
                        </box>

                        <box flexShrink={0}>
                            <text selectable={false} fg={isSelected ? "black" : "gray"}>
                                {candidate.kind === "directory" ? "📁" : "📄"}
                            </text>
                        </box>
                    </box>
                )
            })}
        </scrollbox>
    )
}

interface Props {
    onSubmit: Function,
    disabled?: Boolean
}

export const TEXTAREA_KEY_BINDING: KeyBinding[] = [
    {
        name: 'return',
        action: 'submit'
    },
    {
        name: 'enter',
        action: 'submit'
    },
    {
        name: 'enter',
        shift: true,
        action: 'newline'
    },
    {
        name: 'return',
        shift: true,
        action: 'newline'
    }
]
export default function InputBar({ onSubmit, disabled = false }: Props) {
    const { mode, model, toggleMode, setMode, setModel } = usePromptConfig();
    const textareaRef = useRef<TextareaRenderable>(null);
    const onSubmitRef = useRef<() => void>(() => { });

    const activeMentionRef = useRef<MentionMatch | null>(null);
    const mentionScrollRef = useRef<ScrollBoxRenderable>(null);

    const renderer = useRenderer();
    const toast = useToast(); // 使用useToast()获取toast上下文对象
    const dialog = useDialog(); // 使用useDialog()获取dialog上下文对象
    const { isTopLayer, push, pop, setResponder } = useKeyboardLayer();
    const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
    const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
    const [mentionSelectedIndex, setMentionSelectedIndex] = useState<number>(0);
    const { colors } = useTheme();
    const navigate = useNavigate();

    // 结构useCommandsMenu()返回的对象
    const {
        showCommandMenu,
        commandQuery,
        selectedIndex,
        scrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex
    } = useCommandsMenu();

    const showMentionMenu = activeMention !== null; // 是否显示提及菜单

    const closeMentionMenu = useCallback(() => {
        activeMentionRef.current = null;
        setActiveMention(null);
        setMentionCandidates([]);
        pop('mention')
    }, [pop])

    const syncMentionCandidates = useCallback((
        text: string,
        cursorOffset: number
    ) => {
        const nextMention = findActiveMention(text, cursorOffset); // 查找当前光标所在的提及范围 
        const previousMention = activeMentionRef.current; // 获取上一次的提及范围
        const mentionChanged =
            previousMention?.start !== nextMention?.start
            || previousMention?.end !== nextMention?.end
            || previousMention?.query !== nextMention?.query; // 判断提及范围是否发生变化

        if (!nextMention) {
            if (previousMention) {
                closeMentionMenu(); // 如果没有提及范围，则关闭提及菜单
            }
            return; // 如果没有提及范围，则不需要更新提及候选
        }

        activeMentionRef.current = nextMention; // 更新当前提及范围
        setActiveMention(nextMention); // 更新当前提及范围
        push('mention', () => {
            closeMentionMenu(); // 关闭提及菜单
            return true; // 阻止事件继续传递
        })

        if (mentionChanged) {
            setMentionSelectedIndex(0); // 如果提及范围发生变化，则重置选中的提及索引
            mentionScrollRef.current?.scrollTo(0); // 滚动到顶部
        }

    }, [closeMentionMenu, push])

    const handleTextareaContentChange = useCallback(() => {
        // 当用户输入内容时，触发该回调
        const textarea = textareaRef.current;
        if (!textarea) {
            // 如果没有文本框
            return;
        }

        const text = textarea.plainText; // 获取输入框的内容

        handleContentChange(textarea.plainText); // 更新输入框内容
        syncMentionCandidates(text, textarea.cursorOffset); // 同步提及候选
    }, [handleContentChange, syncMentionCandidates]);

    const handleMentionExecute = useCallback((index: number) => {
        const textarea = textareaRef.current;
        const mention = activeMentionRef.current;
        const candidate = mentionCandidates[index];

        if (!textarea || !mention || !candidate) {
            return;
        }

        // 加了空格以后就不会打开对应的@提及菜单了
        const insertion = candidate.kind === "directory" ? `${candidate.path}` : `${candidate.path} `; // 如果是目录，则不加空格，如果是文件，则加空格
        const nextText = `${textarea.plainText.slice(0, mention.start)}@${insertion}${textarea.plainText.slice(mention.end)}`; // 插入提及内容

        textarea.replaceText(nextText); // 替换输入框内容
        textarea.cursorOffset = mention.start + insertion.length + 1; // 设置光标位置
        syncMentionCandidates(nextText, textarea.cursorOffset); // 同步提及候选
    }, [mentionCandidates, syncMentionCandidates]);

    const handleTextareaCursorChange = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }

        syncMentionCandidates(textarea.plainText, textarea.cursorOffset); // 同步提及候选
    }, [syncMentionCandidates])

    const handleSubmit = useCallback(() => {
        // 当用户按下回车键时，触发提交事件
        if (disabled) return;

        const textarea = textareaRef.current;
        if (!textarea) {
            // 如果没有文本框
            return;
        }

        const text = textarea.plainText.trim(); // 获取输入框的内容
        if (text.length === 0) {
            // 如果输入框内容为空，则不触发提交事件
            return;
        }
        onSubmit(text); // 触发提交事件

        textarea.setText(''); // 清空输入框
    }, [disabled, onSubmit]); // 监听disabled属性的变化

    const handleCommand = useCallback((command: Command | undefined) => {
        //  当用户选中一个命令时，执行该命令的回调
        const textarea = textareaRef.current
        if (!textarea || !command) {
            // 如果没有文本框或者没有选中命令
            return;
        }
        textarea.setText('') // 清空输入框
        if (command.action) {
            command.action({
                exit: () => renderer.destroy(), // 销毁渲染器
                toast, // 显示toast
                dialog,
                navigate,
                mode, // 获取模式
                setMode, // 设置模式
                setModel, // 设置模型
            }); // 执行命令的action
        } else {
            textarea.insertText(command.value + ' ') // 插入命令的value
        }
    }, [renderer, toast, dialog, navigate, mode, setMode, setModel])

    const handleCommandExecute = useCallback((index: number) => {
        // 当用户执行一个命令时，执行该命令的回调
        const command = resolveCommand(index);
        handleCommand(command);
    }, [resolveCommand, handleCommand])

    // 当用户按下Tab键时，切换模式Plan和Build
    useKeyboard((key) => {
        if (disabled) return;
        if (!isTopLayer("base")) return;
        if (key.name === "tab") {
            // 如果按下Tab键，则显示命令菜单
            key.preventDefault();
            toggleMode(); // 切换模式
        }
    })

    useEffect(() => {
        if (!activeMention) {
            setMentionCandidates([]); // 如果没有提及范围，则清空提及候选
            return;
        }

        let ignore = false; // 用于标记是否忽略异步操作的结果
        const loadCandidates = async () => {
            const nextCandidates = await getMentionCandidates(activeMention.query); // 获取提及候选
            if (ignore) {
                return;
            }

            setMentionCandidates(nextCandidates); // 设置提及候选
            setMentionSelectedIndex((currentIndex) => {
                if (nextCandidates.length === 0) {
                    return 0;
                }
                return Math.min(currentIndex, nextCandidates.length - 1); // 如果当前选中的索引大于提及候选的长度，则设置为最后一个索引
            })
        }

        void loadCandidates(); // 调用异步函数加载提及候选

        return () => {
            ignore = true; // 在组件卸载时，忽略异步操作的结果
        }
    }, [activeMention])

    useEffect(() => {
        // 添加提交事件
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }

        textarea.onSubmit = () => {
            onSubmitRef.current(); // 触发提交事件
        }
    }, []);

    onSubmitRef.current = () => {
        // 当用户按下回车键时，触发提交事件
        if (disabled) {
            return;
        }
        if (showCommandMenu) {
            // 如果命令菜单显示，则执行选中的命令
            const command = resolveCommand(selectedIndex);
            handleCommand(command);
            return;
        }

        if (showMentionMenu) {
            // 如果提及菜单显示，则执行选中的提及
            handleMentionExecute(mentionSelectedIndex);
            return;
        }

        handleSubmit(); // 触发提交事件
    }

    // 当用户按下Ctrl+C时，清空输入框内容
    useEffect(() => {
        setResponder("base", () => {
            if (disabled) {
                return false;
            }
            const textarea = textareaRef.current;
            if (textarea && textarea.plainText.length > 0) {
                textarea.setText(''); // 清空输入框
                return true;
            }
            return false;
        })
        return () => setResponder("base", null)
    }, [disabled, setResponder]);

    useKeyboard((key) => {
        if (disabled) return;
        if (!showMentionMenu && !isTopLayer("mention")) return; // 如果没有显示提及菜单，并且当前不是提及菜单的顶层，则不处理键盘事件

        if (key.name === "escape") {
            key.preventDefault();
            closeMentionMenu(); // 关闭提及菜单
        } else if (key.name === "up") {
            key.preventDefault();
            setMentionSelectedIndex((currentIndex) => {
                const nextIndex = Math.max(0, currentIndex - 1); // 如果当前选中的索引大于0，则选中上一个索引，否则选中第一个索引
                const scrollBox = mentionScrollRef.current;
                if (scrollBox && nextIndex < scrollBox.scrollTop) { // 如果下一个索引小于滚动框的滚动位置，则滚动到下一个索引
                    scrollBox.scrollTo(nextIndex);
                }
                return nextIndex;
            })
        } else if (key.name === "down") {
            key.preventDefault();
            setMentionSelectedIndex((currentIndex) => {
                if (mentionCandidates.length === 0) {
                    return 0; // 如果没有提及候选，则返回0
                }

                // 如果当前选中的索引小于提及候选的长度，则选中下一个索引，否则选中最后一个索引
                const nextIndex = Math.min(mentionCandidates.length - 1, currentIndex + 1);
                const scrollbox = mentionScrollRef.current;

                if (scrollbox) {
                    const viewportHeight = scrollbox.viewport.height; // 获取滚动框的高度
                    const visibleEnd = scrollbox.scrollTop + viewportHeight - 1; // 计算可见区域的结束位置
                    if (nextIndex > visibleEnd) { // 如果下一个索引大于可见区域的结束位置，则滚动到下一个索引
                        scrollbox.scrollTo(nextIndex - viewportHeight + 1);
                    }
                }

                return nextIndex; // 返回下一个索引
            })

        }
    })

    return (
        <box
            width="100%"
            alignItems="center">
            {/* 添加左侧边框显色 */}
            <box width="80%" border={["left"]} borderColor={mode === "PLAN" ? colors.planMode : colors.primary}
            >
                {/* 添加输入框 */}
                <box
                    position="relative"
                    justifyContent="center"
                    paddingX={2}
                    paddingY={1}
                    backgroundColor={colors.surface}
                    width="100%"
                    gap={1}
                >

                    {showCommandMenu && (<box
                        position="absolute"
                        bottom='100%'
                        left={0}
                        width="100%"
                        backgroundColor={colors.surface}
                        zIndex={10}
                    >
                        <CommandMenu
                            query={commandQuery}
                            selectedIndex={selectedIndex}
                            scrollRef={scrollRef}
                            onSelect={setSelectedIndex}
                            onExecute={handleCommandExecute}
                        />
                    </box>)
                    }


                    {!showCommandMenu && showMentionMenu && (
                        <box
                            position="absolute"
                            bottom='100%'
                            left={0}
                            width="100%"
                            backgroundColor={colors.surface}
                            zIndex={10}
                        >
                            <FileMentionMenu
                                candidates={mentionCandidates}
                                selectedIndex={mentionSelectedIndex}
                                scrollRef={mentionScrollRef}
                                onSelect={setMentionSelectedIndex}
                                onExecute={handleMentionExecute}
                            />
                        </box>
                    )}
                    <textarea
                        ref={textareaRef}
                        focused={!disabled && (isTopLayer("base") || isTopLayer("command") || isTopLayer("mention"))}
                        placeholder='Ask anything..."Fix a bug in the database"'
                        width="100%"
                        overflow="scroll"
                        onContentChange={handleTextareaContentChange}
                        keyBindings={TEXTAREA_KEY_BINDING}
                    >
                    </textarea>
                    <StatusBar />
                </box>
            </box>
        </box>
    )
}