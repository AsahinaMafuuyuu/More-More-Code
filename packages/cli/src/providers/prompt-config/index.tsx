// 主要用于在应用中提供一个上下文，用于管理和共享提示配置的状态，
// 包括模式（Mode）和动态模型引用（ModelRef）。
// 通过使用 React 的 Context API，组件可以方便地访问和修改这些配置，而无需通过 props 层层传递。
import { createContext, useContext, useState, type ReactNode } from "react";
import { type ModelRef, type ModeType, Mode } from "@more-more-code/shared";
import { getAgentEnvironment } from "../../lib/agent-environment";

type PromptConfigContextValue = {
    mode: ModeType;
    toggleMode: () => void;
    setMode: (mode: ModeType) => void;
    model: ModelRef;
    setModel: (model: ModelRef) => void;
}

const PromptConfigContext = createContext<PromptConfigContextValue | null>(null);

export function usePromptConfig(): PromptConfigContextValue {
    // 使用钩子获取上下文值
    const value = useContext(PromptConfigContext)

    if (!value) {
        throw new Error("usePromptConfig must be used within a PromptConfigProvider")
    }
    return value;
}

type PromptConfigProviderProps = {
    children: ReactNode;
}

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
    const [mode, setMode] = useState<ModeType>(Mode.BUILD); // 默认模式为构建模式
    const [model, setModel] = useState<ModelRef>(() => ({
        ...getAgentEnvironment().config.resolved.model,
    }));

    // 切换模式
    const toggleMode = () => {
        setMode(mode === Mode.BUILD ? Mode.PLAN : Mode.BUILD);
    }

    return (
        <PromptConfigContext.Provider

            value={{
                mode,
                toggleMode,
                setMode,
                model,
                setModel
            }}>
            {children}
        </PromptConfigContext.Provider>
    )
}

