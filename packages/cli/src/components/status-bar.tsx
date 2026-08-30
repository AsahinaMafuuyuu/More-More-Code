// 显示模型状态栏
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode } from "@more-more-code/shared";
import {
    formatStatusBarObservability,
    type SessionObservability,
} from "../lib/session-observability";
import { ContextUtilizationBar } from "../ui/session/surfaces/context-utilization-bar";

export default function StatusBar({ observability }: { observability?: SessionObservability }) {
    const {mode, model} = usePromptConfig();
    const { colors } = useTheme();
    const metrics = formatStatusBarObservability(observability);
    return(
        <box flexDirection="row" gap={1}>
            <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
                {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                &#8250;
            </text>
            <text>{model.providerId}/{model.modelId}</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
            <text>{metrics.context}</text>
            <ContextUtilizationBar ratio={metrics.contextUtilizationRatio} />
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
            <text>{metrics.cost}</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
            <text>{metrics.cache}</text>
        </box>
    )
}
