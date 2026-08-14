import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import InputBar from "./input-bar";
import { Spinner } from "./spinner";
import { usePromptConfig } from "../providers/prompt-config";
import type { SessionTreeCommandApi } from "./command-menu/types";
import type { ModeType, SupportedChatModelId } from "@more-more-code/shared";
import type { ManualContextCompactionOutcome } from "../lib/local-model-transport";

type Props = {
    children?: ReactNode;
    onSubmit: (text: string) => void;
    onFollowUp?: (text: string) => void;
    inputDisabled?: boolean;
    loading?: boolean;
    interruptible?: boolean;
    sessionTree?: SessionTreeCommandApi;
    onModeChange?: (mode: ModeType) => void;
    onModelChange?: (model: SupportedChatModelId) => void;
    onCompact?: () => Promise<ManualContextCompactionOutcome>;
};

export function SessionShell({ children,
    onSubmit,
    onFollowUp,
    inputDisabled = false,
    loading = false,
    interruptible = false, // 允许中断
    sessionTree,
    onModeChange,
    onModelChange,
    onCompact,
}
    : Props) {
    const { mode } = usePromptConfig()
    return (
        <box
            flexDirection="column"
            flexGrow={1}
            width="100%"
            height="100%"
            paddingY={1}
            paddingX={2}
            gap={1}
        >
            <scrollbox
                flexGrow={1}
                width="100%"
                stickyScroll
                stickyStart="bottom"
            >
                <box>{children}</box>
            </scrollbox>

            <box flexShrink={0}>
                <InputBar
                    onSubmit={onSubmit}
                    onFollowUp={onFollowUp}
                    disabled={inputDisabled}
                    sessionTree={sessionTree}
                    onModeChange={onModeChange}
                    onModelChange={onModelChange}
                    onCompact={onCompact}
                />
            </box>

            <box
                flexShrink={0}
                flexDirection="row"
                justifyContent="space-between"
                width="100%"
                height={1}
                gap={2}
                paddingLeft={1}

            >
                <box flexDirection="row" alignItems="center" gap={2}>
                    {
                        loading ? (
                            <>
                                <Spinner mode={mode} />
                                {interruptible && <text>enter steer · alt+enter follow-up · esc interrupt</text>}
                            </>
                        ) : null
                    }
                </box>

                {/* 按tab切换智能体 */}
                <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
                    <text>tab</text>
                    <text attributes={TextAttributes.DIM}>agents</text>
                </box>
            </box>
        </box>
    );
}