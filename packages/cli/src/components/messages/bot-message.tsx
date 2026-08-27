// 展示智能体的相关消息 
import prettyMs from "pretty-ms";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { Message } from "../../hooks/use-chat";
import { Mode, type ModeType } from "@more-more-code/shared";
import { EmptyBorder } from "../border";
import type { ToolUseView } from "../../lib/tool-use-projection";
import { ToolUse } from "./tool-use";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<ClientMessagePart, { type: `tool-${string}` | "dynamic-tool" }>;

type Props = {
    parts: ClientMessagePart[];
    model: string;
    mode: ModeType;
    durationMs?: number;
    streaming?: boolean;
    interrupted?: boolean;
    toolUses: Readonly<Record<string, ToolUseView>>;
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
    return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

type PartGroup = {
    type: ClientMessagePart["type"];
    parts: ClientMessagePart[];
    key: string;
}

// 组合连续的相同类型的消息
function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
    const groups: PartGroup[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const lastGroup = groups[groups.length - 1];

        if (lastGroup && lastGroup.type === part.type) {
            lastGroup.parts.push(part); // 添加到当前组
        } else {
            // 创建一个新的组
            // 为每个组生成一个唯一的key，确保在渲染时不会出现重复的key
            // 例如：group-text-0, group-tool-call-1
            const key =
                isToolPart(part) ?
                    `group-tc-${part.toolCallId}`
                    :
                    `group-${part.type}-${i}`;

            groups.push({
                type: part.type,
                parts: [part],
                key
            })
        }
    }

    return groups;
}

// 
export function BotMessage({
    parts,
    model,
    mode,
    durationMs,
    streaming = false,
    toolUses,
}: Props) {
    const { colors } = useTheme();

    return (
        <box width="100%" alignItems="center">
            {
                groupConsecutiveParts(parts).map((group, i) => (
                    <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
                        {/* 每一个group也有很多个part */}
                        {group.parts.map((part, j) => {
                            if (part.type === "reasoning") {
                                return (
                                    <box
                                        key={`reasoning-${j}`}
                                        border={['left']}
                                        borderColor={colors.thinkingBorder}
                                        customBorderChars={{
                                            ...EmptyBorder,
                                            vertical: '│',
                                        }}
                                        width="100%"
                                        paddingX={2}
                                    >
                                        <text attributes={TextAttributes.DIM}>
                                            <em fg={colors.thinking}>
                                                Thinking:
                                            </em>
                                            {part.text}
                                        </text>
                                    </box>
                                )
                            }

                            if (isToolPart(part)) {
                                const toolName =
                                    part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
                                const toolUse = toolUses[part.toolCallId] ?? {
                                    toolCallId: part.toolCallId,
                                    toolName,
                                    status: "incomplete" as const,
                                    diagnostic: "integrity_error" as const,
                                };
                                return (
                                    <ToolUse key={part.toolCallId} view={toolUse} />
                                )
                            }

                            if (part.type === 'text') {
                                return (
                                    <box
                                        key={`text-${j}`}
                                        paddingX={3}
                                        width="100%"
                                    >
                                        <text>
                                            {part.text}
                                        </text>
                                    </box>
                                )
                            }

                            return null;
                        })}


                    </box>
                ))
            }
            <box paddingX={3} paddingY={1} gap={1} width="100%">
                <box flexDirection="row" gap={2}>

                    <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>◎</text>
                    <box flexDirection="row" gap={1}>
                        <text>
                            {mode === Mode.PLAN ? "Plan" : "Build"}
                        </text>

                        {/* 标识箭头> */}
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                            &gt;
                        </text>

                        <text attributes={TextAttributes.DIM}>{model}</text>

                        {(durationMs != null) && (
                            <>
                                {/* 标识箭头> */}
                                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                                    &gt;
                                </text>

                                <text attributes={TextAttributes.DIM}>
                                    { prettyMs(durationMs) }
                                </text>
                            </>
                        )}
                    </box>
                </box>
            </box>
        </box >
    );
};
