import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import { Mode } from "@more-more-code/database";

const AVAILABLE_MODES: Mode[] = [Mode.PLAN, Mode.BUILD];

type AgentsDialogContentProps = {
    // 添加其他属性
    currentMode: Mode,
    onSelecteMode: (mode: Mode) => void, // 选择模式
}

function getModeLabel(mode: Mode) {
    return mode === Mode.PLAN ? "Plan" : "Build";
}

export const AgentsDialogContent = ({
    currentMode,
    onSelecteMode
}: AgentsDialogContentProps) => {
    const dialog = useDialog();

    // 处理选择模式的回调函数
    const handleSelect = useCallback((mode: Mode) => {
        onSelecteMode(mode);
        dialog.close();
    }, [onSelecteMode, dialog]);


    return (
        <DialogSearchList
            items={AVAILABLE_MODES}
            onSelect={handleSelect}
            filterFn={(item, query) =>
                getModeLabel(item).
                    toLowerCase().
                    includes(query.toLowerCase())}
            // 渲染每个模式的列表项
            renderItem={(mode, isSelected) => {
                return (
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : "white"}
                    >
                        {/* 如果是原始主题，则添加一个圆点 */}
                        {mode === currentMode
                            ? "\u0020\u2022\u0020" : "\u0020\u0020\u0020"}
                        {getModeLabel(mode)}
                    </text>
                )
            }}
            getKey={(mode) => mode} // 
            placeholder="Search modes"
            emptyText="No matching modes"
        />
    )
};