
import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type { SupportedChatModelId } from "@more-more-code/shared";

type ModelsDialogContentProps = {
    // 添加其他属性
    models: SupportedChatModelId[],
    onSelectModel: (model: SupportedChatModelId) => void, // 选择模型
}
export const ModelsDialogContent = ({
    models,
    onSelectModel
}: ModelsDialogContentProps) => {
    const dialog = useDialog();

    // 处理选择模型的回调函数
    const handleSelect = useCallback((model: SupportedChatModelId) => {
        onSelectModel(model);
        dialog.close();
    }, [onSelectModel, dialog]);


    return (
        <DialogSearchList
            items={models}
            onSelect={handleSelect}
            filterFn={(modelId, query) =>
                modelId.
                    toLowerCase().
                    includes(query.toLowerCase())}
            // 渲染每个模式的列表项
            renderItem={(modelId, isSelected) => {
                return (
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : "white"}
                    >
                        {modelId}
                    </text>
                )
            }}
            getKey={(modelId) => modelId} // 
            placeholder="Search models"
            emptyText="No matching models"
        />
    )
};