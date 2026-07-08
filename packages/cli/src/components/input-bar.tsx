// 输入框整体
import { type KeyBinding } from "@opentui/core";
import { useRef, useCallback, useEffect, use } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import type { Command } from "./command-menu/types";
import { CommandMenu } from "./command-menu";
import StatusBar from "./status-bar";
import { useCommandsMenu } from "./command-menu/use-commands-menu";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";

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
    const textareaRef = useRef<TextareaRenderable>(null);
    const onSubmitRef = useRef<() => void>(() => { });
    const renderer = useRenderer();
    const toast = useToast(); // 使用useToast()获取toast上下文对象
    const dialog = useDialog(); // 使用useDialog()获取dialog上下文对象
    const { isTopLayer, setResponder } = useKeyboardLayer();
    const { colors } = useTheme();

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


    const handleTextareaContentChange = useCallback(() => {
        // 当用户输入内容时，触发该回调
        const textarea = textareaRef.current;
        if (!textarea) {
            // 如果没有文本框
            return;
        }

        handleContentChange(textarea.plainText); // 更新输入框内容
    }, [])

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
            }); // 执行命令的action
        } else {
            textarea.insertText(command.value + ' ') // 插入命令的value
        }
    }, [renderer, toast, dialog])

    const handleCommandExecute = useCallback((index: number) => {
        // 当用户执行一个命令时，执行该命令的回调
        const command = resolveCommand(index);
        handleCommand(command);
    }, [resolveCommand, handleCommand])
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

    return (
        <box
            width="100%"
            alignItems="center">
            {/* 添加左侧边框显色 */}
            <box width="80%" border={["left"]} borderColor={colors.primary}
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

                    <textarea
                        ref={textareaRef}
                        focused={!disabled && (isTopLayer("base") || isTopLayer("command"))}
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