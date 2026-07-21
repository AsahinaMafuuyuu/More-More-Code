// 展示智能体的相关消息 
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { ClientMessagePart, ClientToolCallPart } from "../../hooks/use-chat";
import { Mode } from "@more-more-code/database";
import { EmptyBorder } from "../border";

type Props = {
    parts: ClientMessagePart[];
    model: string;
    mode: Mode;
    duration?: string;
    streaming?: boolean;
    interrupted?: boolean;
}

// 格式化工具名称，将驼峰命名转换为带空格的格式
// 例如：myToolName -> My Tool Name
function formatToolName(name: string): string {
    return name
        .replace(/^([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase());
}

// 格式化工具参数，将对象参数转换为字符串表示
// 例如：{ arg1: "value1", arg2: "value2" } -> "value1 value2"
function formatToolArgs(tc: ClientToolCallPart): string {
    return Object.values(tc.args).map(String).join(" ");
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
                part.type === "tool-call" ?
                    `group-tc-${part.id}`
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
    duration,
    streaming = false,
    interrupted = false, // 不允许中断
}: Props) {
    const { colors } = useTheme();

    return (
        <box width="100%" alignItems="center">
            {
                groupConsecutiveParts(parts).map((group) => (
                    <box key={group.key} paddingX={1} width="100%">
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

                            if (part.type === "tool-call") {
                                return (
                                    <box
                                        key={part.id}
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
                                            <em fg={colors.info}>
                                                {/* 格式化工具名称 */}
                                                {formatToolName(part.name)}
                                            </em>
                                            {formatToolArgs(part)}
                                            {part.status === "calling" ? '...' : ''}
                                        </text>
                                    </box>
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
            <box paddingX={3} paddingBottom={1} gap={1} width="100%">
                <box flexDirection="row" gap={2}>

                    <text
                        attributes={interrupted ? TextAttributes.DIM : 0}
                        fg={interrupted ? undefined : mode === Mode.PLAN ? colors.planMode : colors.primary}
                    >
                        ◉
                    </text>

                    <box flexDirection="row" gap={1}>
                        <text
                            attributes={interrupted ? TextAttributes.DIM : 0}
                        >
                            {mode === Mode.PLAN ? "Plan" : "Build"}
                        </text>

                        {/* 标识箭头> */}
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                            &gt;
                        </text>

                        <text attributes={TextAttributes.DIM}>{model}</text>

                        {(duration || interrupted) && (
                            <>
                                {/* 标识箭头> */}
                                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                                    &gt;
                                </text>

                                <text attributes={TextAttributes.DIM}>{interrupted ? "interrupted" : duration}</text>
                            </>
                        )}
                    </box>
                </box>
            </box>
        </box>
    );
};