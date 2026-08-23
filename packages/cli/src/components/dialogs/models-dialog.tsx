
import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type { ModelRef } from "@more-more-code/shared";

type ModelsDialogContentProps = {
    // 添加其他属性
    models: ModelRef[],
    onSelectModel: (model: ModelRef) => void, // 选择模型
}
export const ModelsDialogContent = ({
    models,
    onSelectModel
}: ModelsDialogContentProps) => {
    const dialog = useDialog();

    // 处理选择模型的回调函数
    const handleSelect = useCallback((model: ModelRef) => {
        onSelectModel(model);
        dialog.close();
    }, [onSelectModel, dialog]);


    return (
        <DialogSearchList
            items={models}
            onSelect={handleSelect}
            filterFn={(modelRef, query) =>
                `${modelRef.providerId}/${modelRef.modelId}`
                    .toLowerCase()
                    .includes(query.toLowerCase())}
            // 渲染每个模式的列表项
            renderItem={(modelRef, isSelected) => {
                return (
                    <text
                        selectable={false}
                        fg={isSelected ? "black" : "white"}
                    >
                        {modelRef.providerId}/{modelRef.modelId}
                    </text>
                )
            }}
            getKey={(modelRef) => `${modelRef.providerId}:${modelRef.modelId}`}
            placeholder="Search models"
            emptyText="No matching models"
        />
    )
};
