/**
 * 本项目中的 Toast 是一种短暂的、非阻塞式的终端提示组件。它用于告诉用户某件事已经发生、正在发生，或者请求失败，但不会打断当前页面、输入框或对话流。

        例如：

        ┌──────────── 终端右上角 ────────────┐
        │ Failed to create session           │
        └────────────────────────────────────┘
        默认显示 3 秒后自动消失。

 */
import {
    createContext,
    useContext,
    useCallback,
    useRef,
    useState,
    use,
    useMemo
} from 'react';

import type { ReactNode } from 'react'; // ReactNode类型表示React组件的子节点类型
import { useTerminalDimensions } from '@opentui/react'; // useTerminalDimensions是一个自定义hook，用于获取终端的宽高
import type { ToastOptions, ToastVariant } from './types'; // 导入ToastOptions类型
import { DEFAULT_DURATION } from './types'; // 导入默认持续时间
import { SplitBorderChars } from '../../components/border';
import { useTheme } from '../theme';

export type ToastContextValue = {
    show: (options: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null); // 创建一个ToastContext上下文对象，初始值为null

export function useToast(): ToastContextValue {
    const value = useContext(ToastContext); // 使用useContext获取ToastContext的值
    if (!value) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return value; // 返回ToastContext的值
}

type ToastProviderProps = {
    children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
    const [currentToast, setCurrentToast] = useState<ToastOptions | null>(null); // 定义一个状态变量toasts，用于存储当前显示的toast列表
    const timeoutHandlerRef = useRef<NodeJS.Timeout | null>(null); // 定义一个ref，用于存储定时器的id

    const clearCurrentTimeout = useCallback(() => {
        if (timeoutHandlerRef.current) {
            clearTimeout(timeoutHandlerRef.current);
            timeoutHandlerRef.current = null;
        }
    }, []); // 定义一个清除当前定时器的回调函数

    const show = useCallback((options: ToastOptions) => {
        const duration = options.duration ?? DEFAULT_DURATION; // 如果options中没有duration，则使用默认持续时间

        clearCurrentTimeout(); // 清除当前定时器

        setCurrentToast({
            variant: options.variant ?? 'info', // 如果options中没有variant，则使用默认类型info
            ...options,
            duration,
        });

        timeoutHandlerRef.current = setTimeout(() => {
            setCurrentToast(null);
        }, duration).unref();
    }, [clearCurrentTimeout])

    const value = useMemo(() => ({ show }), [show]); // 使用useMemo缓存show函数，避免不必要的重新渲染

    return (
        <ToastContext.Provider value={value}>
            {children}
            <Toast currentToast={currentToast} />
        </ToastContext.Provider>
    );
};

type ToastProps = {
    currentToast: ToastOptions | null;
};

function Toast({ currentToast }: ToastProps) {
    const { width } = useTerminalDimensions(); // 获取终端的宽度
    const { colors } = useTheme(); // 获取主题颜色

    if (!currentToast) {
        return null; // 如果没有当前toast，则不渲染任何内容
    }

    const variantColors: Record<ToastVariant, string> = {
        success: colors.success,
        error: colors.error,
        info: colors.info,
    };

    const borderColor = currentToast.variant ?
        variantColors[currentToast.variant]
        : variantColors.info; // 根据当前toast的类型设置边框颜色

    return (
        <box
            position='absolute'
            justifyContent='center'
            alignItems='flex-start'
            top={2}
            right={2}
            width={Math.max(1, Math.min(60, width - 6))} // 限制toast的最大宽度为60，最小宽度为1
            padding={1}
            backgroundColor={colors.surface}
            borderColor={borderColor}
            border={['right', 'left']}
            customBorderChars={SplitBorderChars}
        >
            <box
                flexDirection='column'
                gap={1}
                width="100%"
            >
                <text
                fg="e1e1e1"
                wrapMode='word'
                width="100%"
                >
                    {currentToast.message}
                </text>
            </box>
        </box>
    )
}