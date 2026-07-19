// 终端可以开启多个会话，而我们只需要监听是否处于最上方的cli的会话的键盘事件监听即可
/**
 * 终端中可能同时有输入框、命令菜单、Dialog 等多个区域监听键盘；
 * 同一个按键必须由最上层、最符合当前交互状态的 UI 处理，不能让所有组件同时响应。
 */
import React, {
    createContext,
    useContext,
    useEffect,
    useCallback,
    useRef,
    useState,
    use
} from 'react';
import { useKeyboard, useRenderer } from '@opentui/react'; // 导入useKeyboard和useRenderer钩子函数

type Responder = () => boolean;

// KeyboardLayerContextValue类型定义了一个上下文对象的值，包含四个方法：
type KeyboardLayerContextValue = {
    push: (id: string, responder: Responder) => void; // 添加push方法
    pop: (id: string) => void;
    isTopLayer: (id: string) => boolean;
    setResponder: (id: string, responder: Responder | null) => void; // 添加setResponder方法
}

const KeyboardLayerContext = createContext<KeyboardLayerContextValue | null>(null);

export function KeyboardLayerProvider({ children }: { children: React.ReactNode }) {
    const [stack, setStack] = useState<string[]>(["base"]); // 定义一个状态变量stack，用于存储键盘事件处理函数的栈
    const stackRef = useRef(stack); // 定义一个ref，用于存储stack的引用
    stackRef.current = stack;

    const responders = useRef<Map<string, Responder>>(new Map()); // 定义一个ref，用于存储键盘事件处理函数的映射
    const renderer = useRenderer(); // 获取渲染器对象

    const push = useCallback((id: string, responder?: Responder) => {
        if (responder) {
            responders.current.set(id, responder); // 将键盘事件处理函数添加到映射中
        }

        setStack((prev) => {
            if (prev.includes(id)) {
                return prev;
                // 如果栈中已经存在该id，则返回原栈
            }
            return [...prev, id]; // 返回新的栈
        })
    }, []); // 定义一个回调函数push，用于将键盘事件处理函数添加到栈中

    const pop = useCallback((id: string) => {
        responders.current.delete(id); // 将键盘事件处理函数从映射中删除
        setStack((prev) => {
            return prev.filter((item) => item !== id); // 返回新的栈
        })
    }, []);

    const isTopLayer = useCallback((id: string) => {
        return stackRef.current[stackRef.current.length - 1] === id; // 判断当前栈顶的键盘事件处理函数是否为指定id的键盘事件处理函数
    }, [stack]);

    const setResponder = useCallback((id: string, responder: Responder | null) => {
        if (responder) {
            responders.current.set(id, responder); // 将键盘事件处理函数添加到映射中
        } else {
            responders.current.delete(id); // 如果responder为null，则将键盘事件处理函数从映射中删除
        }
    }, []);

    useKeyboard((key) => {
        if (!key.ctrl || key.name !== 'c') {
            // 如果ctrl键没有按下，或者按键名称不是c，则返回false
            return;
        }
        const currentStack = stackRef.current; // 获取当前栈
        // 遍历栈，从栈底到栈顶
        for (let i = currentStack.length - 1; i >= 0; i--) {
            const id = currentStack[i]!;
            const responder = responders.current.get(id); // 获取当前id的键盘事件处理函数
            if (responder && responder()) {
                return;
            }
        }

        // 如果没有任何键盘事件处理函数返回true，则退出程序
        renderer.destroy();
    });

    return (
        <KeyboardLayerContext.Provider value={{ push, pop, isTopLayer, setResponder }}>
            {children}
        </KeyboardLayerContext.Provider>
    );
}

// useKeyboardLayer是一个自定义hook，用于获取键盘事件处理函数的上下文对象
export function useKeyboardLayer() {
    const context = useContext(KeyboardLayerContext); // 获取键盘事件处理函数的上下文对象
    if (!context) {
        throw new Error("useKeyboardLayer must be used within a KeyboardLayerProvider");
    }
    return context;
}