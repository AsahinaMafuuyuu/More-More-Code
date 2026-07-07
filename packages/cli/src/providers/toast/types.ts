// 声明类型
export type ToastVariant = 'success' | 'error' | 'info'; // 提示类型

export type ToastOptions = {
    message: string;
    variant?: ToastVariant;
    duration?: number;
}

export const DEFAULT_DURATION = 3000; // 默认持续时间