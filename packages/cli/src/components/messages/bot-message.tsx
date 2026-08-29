// 展示智能体的相关消息 
import { TextAttributes } from "@opentui/core";
import { useMemo, useState } from "react";
import { useTheme } from "../../providers/theme";
import type { Message } from "../../lib/chat-types";
import { EmptyBorder } from "../border";
import type { ToolUseView } from "../../lib/tool-use-projection";
import { ToolUse } from "./tool-use";
import { MessageTextDisclosure } from "./message-text-disclosure";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<ClientMessagePart, { type: `tool-${string}` | "dynamic-tool" }>;

type Props = {
    parts: ClientMessagePart[];
    toolUses: Readonly<Record<string, ToolUseView>>;
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
    return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

type PartGroup = {
    kind: ClientMessagePart["type"] | "tool";
    parts: ClientMessagePart[];
    key: string;
}

function presentationKind(part: ClientMessagePart): PartGroup["kind"] {
    return isToolPart(part) ? "tool" : part.type;
}

// Group adjacent semantic presentation kinds without reordering history.
function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
    const groups: PartGroup[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const lastGroup = groups[groups.length - 1];
        const kind = presentationKind(part);

        if (lastGroup && lastGroup.kind === kind) {
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
                kind,
                parts: [part],
                key
            })
        }
    }

    return groups;
}

const COLLAPSED_REASONING_PREVIEW_CHARS = 768;

export function createCollapsedReasoningPreview(text: string) {
    if (text.length <= COLLAPSED_REASONING_PREVIEW_CHARS) return text;
    return `${text.slice(0, COLLAPSED_REASONING_PREVIEW_CHARS - 1)}…`;
}

function ReasoningDisclosure({ text, active = false }: { text: string; active?: boolean }) {
    const { colors } = useTheme();
    const [expanded, setExpanded] = useState(false);
    const renderedText = expanded ? text : createCollapsedReasoningPreview(text);

    return (
        <box
            border={['left']}
            borderColor={colors.thinkingBorder}
            customBorderChars={{
                ...EmptyBorder,
                vertical: '│',
            }}
            width="100%"
            paddingX={2}
        >
            <box
                width="100%"
                flexDirection="column"
                onMouseDown={() => setExpanded((current) => !current)}
                height={expanded ? "auto" : 2}
                overflow={expanded ? "visible" : "hidden"}
            >
                <box width="100%" height={1} flexDirection="row" gap={1}>
                    <text fg={colors.thinking}>{expanded ? "▾" : "▸"}</text>
                    <text attributes={TextAttributes.DIM}>
                        <em fg={colors.thinking}>Thinking:</em>
                    </text>
                    {active && <text fg={colors.info}>· ● active</text>}
                </box>
                <box width="100%" paddingLeft={2} height={expanded ? "auto" : 1} overflow={expanded ? "visible" : "hidden"}>
                    <text attributes={TextAttributes.DIM}>{renderedText}</text>
                </box>
            </box>
        </box>
    );
}

type ToolStatusCounts = {
    total: number;
    completed: number;
    failed: number;
    active: number;
    cancelled: number;
};

function countToolStatuses(views: readonly ToolUseView[]): ToolStatusCounts {
    return views.reduce<ToolStatusCounts>((counts, view) => {
        counts.total += 1;
        if (view.status === "completed") counts.completed += 1;
        else if (["failed", "denied", "timed_out", "incomplete"].includes(view.status)) counts.failed += 1;
        else if (view.status === "cancelled") counts.cancelled += 1;
        else counts.active += 1;
        return counts;
    }, { total: 0, completed: 0, failed: 0, active: 0, cancelled: 0 });
}

function resolveToolUse(
    part: ToolPart,
    toolUses: Readonly<Record<string, ToolUseView>>,
): ToolUseView {
    const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
    return toolUses[part.toolCallId] ?? {
        toolCallId: part.toolCallId,
        toolName,
        status: "incomplete" as const,
        diagnostic: "integrity_error" as const,
    };
}

function ToolUseGroup({
    parts,
    toolUses,
}: {
    parts: ToolPart[];
    toolUses: Readonly<Record<string, ToolUseView>>;
}) {
    const { colors } = useTheme();
    const [expanded, setExpanded] = useState(false);
    const views = useMemo(
        () => parts.map((part) => resolveToolUse(part, toolUses)),
        [parts, toolUses],
    );
    const counts = useMemo(() => countToolStatuses(views), [views]);

    return (
        <box
            width="100%"
            border={["left"]}
            borderColor={colors.sessionTool}
            customBorderChars={{ ...EmptyBorder, vertical: "│" }}
            paddingX={2}
        >
            <box
                width="100%"
                flexDirection="row"
                gap={1}
                onMouseDown={() => setExpanded((current) => !current)}
            >
                <text fg={colors.sessionTool}>{expanded ? "▾" : "▸"}</text>
                <text attributes={TextAttributes.BOLD} fg={colors.sessionTool}>Tools {counts.total}</text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
                <text fg={colors.success}>✓ {counts.completed} completed</text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
                <text fg={colors.error}>× {counts.failed} failed</text>
                {counts.active > 0 && (
                    <>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
                        <text fg={colors.info}>● {counts.active} active</text>
                    </>
                )}
                {counts.cancelled > 0 && (
                    <>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
                        <text fg={colors.thinking}>■ {counts.cancelled} cancelled</text>
                    </>
                )}
            </box>
            {expanded && (
                <box width="100%" paddingLeft={1}>
                    {views.map((view) => (
                        <ToolUse key={view.toolCallId} view={view} />
                    ))}
                </box>
            )}
        </box>
    );
}

function ToolDisclosure({
    parts,
    toolUses,
}: {
    parts: ToolPart[];
    toolUses: Readonly<Record<string, ToolUseView>>;
}) {
    if (parts.length === 1) {
        return <ToolUse view={resolveToolUse(parts[0]!, toolUses)} />;
    }
    return <ToolUseGroup parts={parts} toolUses={toolUses} />;
}

// 
export function BotMessage({
    parts,
    toolUses,
}: Props) {
    return (
        <box width="100%" alignItems="center">
            {
                groupConsecutiveParts(parts).map((group, i) => (
                    <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
                        {group.kind === "tool" ? (
                            <ToolDisclosure
                                parts={group.parts.filter(isToolPart)}
                                toolUses={toolUses}
                            />
                        ) : group.parts.map((part, j) => {
                            if (part.type === "reasoning") {
                                return (
                                    <ReasoningDisclosure
                                        key={`reasoning-${j}`}
                                        text={part.text}
                                        active={part.state === "streaming"}
                                    />
                                );
                            }

                            if (part.type === 'text') {
                                return (
                                    <box
                                        key={`text-${j}`}
                                        paddingX={3}
                                        width="100%"
                                    >
                                        <MessageTextDisclosure text={part.text} />
                                    </box>
                                )
                            }

                            return null;
                        })}
                    </box>
                ))
            }
        </box >
    );
};
