import { isToolUIPart } from "./chat-types";
import type {
    SessionEntry,
    SessionToolResultEntry,
    SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";

export type SessionNavigationNode = {
    id: string;
    parentId: string | null;
    type: string;
    depth: number;
    createdAt: number;
    preview: string;
    navigationTargetEntryId: string;
    selectable: boolean;
    active: boolean;
    toolCallId?: string;
    callEntryId?: string;
    resultEntryId?: string;
    status?: "pending" | NonNullable<SessionToolResultEntry["status"]>;
};

export type SessionNavigationTree = {
    nodes: SessionNavigationNode[];
};

function getMessageText(message: Message) {
    return message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
}

function isToolOnlyAssistant(entry: SessionEntry<Message>) {
    return entry.type === "assistant_message"
        && entry.message.parts.length > 0
        && entry.message.parts.every((part) => isToolUIPart(part));
}

function formatToolPreview(toolName: string, input: unknown) {
    let detail = "";
    try {
        const serialized = JSON.stringify(input);
        if (serialized && serialized !== "{}") {
            detail = serialized.length > 96 ? `${serialized.slice(0, 93)}...` : serialized;
        }
    } catch {
        detail = "";
    }
    return detail ? `[${toolName}: ${detail}]` : `[${toolName}]`;
}

function getEntryPreview(entry: SessionEntry<Message>) {
    switch (entry.type) {
        case "user_message":
        case "assistant_message":
        case "custom_message":
        case "message_update":
            return getMessageText(entry.message) || entry.messageId;
        case "tool_call":
            return `${entry.toolName}(${entry.toolCallId.slice(0, 8)})`;
        case "tool_result":
            return `${entry.toolName ?? "tool"} result ${entry.toolCallId.slice(0, 8)}`;
        case "error":
            return entry.message;
        case "compaction":
            return "Context compaction";
        case "branch_summary":
            return "Branch summary";
        case "custom":
            return entry.customType;
        case "session_start":
            return "Session start";
        case "model_change":
            return `Model → ${entry.model}`;
        case "mode_change":
            return `Mode → ${entry.mode}`;
        case "config_change":
            return `Config changed: ${entry.key}`;
    }
}

function isVisibleEntry(entry: SessionEntry<Message>) {
    switch (entry.type) {
        case "session_start":
        case "message_update":
        case "model_change":
        case "mode_change":
        case "config_change":
        case "custom":
            return false;
        case "assistant_message":
            return !isToolOnlyAssistant(entry);
        case "tool_call":
        case "tool_result":
            return false;
        default:
            return true;
    }
}

/**
 * Builds a semantic, non-mutating navigation index over the canonical Session
 * Entry Tree. Hidden bookkeeping rows are topology-transparent; visual depth
 * is derived from visible branch points rather than raw Entry depth.
 */
export function projectSessionNavigationTree(
    state: SessionTreeState<Message>,
): SessionNavigationTree {
    const entriesById = new Map(state.entries.map((entry) => [entry.id, entry]));
    const childrenByParent = new Map<string | null, SessionEntry<Message>[]>();
    for (const entry of state.entries) {
        const children = childrenByParent.get(entry.parentId) ?? [];
        children.push(entry);
        childrenByParent.set(entry.parentId, children);
    }

    const nodes: SessionNavigationNode[] = [];
    const nodeById = new Map<string, SessionNavigationNode>();
    const projectedAncestorByEntryId = new Map<string, string | null>();

    const visit = (
        entryId: string,
        visibleParentId: string | null,
        messageNodesById: Map<string, SessionNavigationNode>,
        toolNodesByCallId: Map<string, SessionNavigationNode>,
        effectiveMessagesById: Map<string, Message>,
    ) => {
        const entry = entriesById.get(entryId);
        if (!entry) return;

        let nextVisibleParentId = visibleParentId;
        let nextMessageNodesById = messageNodesById;
        let nextToolNodesByCallId = toolNodesByCallId;
        let nextEffectiveMessagesById = effectiveMessagesById;

        if (entry.type === "message_update") {
            const messageNode = messageNodesById.get(entry.messageId);
            if (messageNode) {
                messageNode.preview = getEntryPreview(entry);
            }
            if (!effectiveMessagesById.has(entry.messageId)) {
                throw new Error(
                    `Legacy message_update ${entry.id} references unknown message ${entry.messageId}`,
                );
            }
            nextEffectiveMessagesById = new Map(effectiveMessagesById);
            nextEffectiveMessagesById.set(entry.messageId, structuredClone(entry.message));
            projectedAncestorByEntryId.set(entry.id, visibleParentId);
        } else if (entry.type === "tool_call") {
            if (toolNodesByCallId.has(entry.toolCallId)) {
                throw new Error(`Duplicate tool_call ${entry.toolCallId} on one navigation branch`);
            }
            const matchingToolParts = [...effectiveMessagesById.values()]
                .filter((message) => message.role === "assistant")
                .flatMap((message) => message.parts)
                .filter((part) => isToolUIPart(part) && part.toolCallId === entry.toolCallId);
            if (matchingToolParts.length !== 1) {
                throw new Error(
                    `tool_call ${entry.toolCallId} expected exactly one matching assistant Tool part, found ${matchingToolParts.length}`,
                );
            }
            const node: SessionNavigationNode = {
                id: `tool-use:${entry.id}`,
                parentId: visibleParentId,
                type: "tool_use",
                depth: 0,
                createdAt: entry.createdAt,
                preview: formatToolPreview(entry.toolName, entry.input),
                navigationTargetEntryId: entry.id,
                selectable: false,
                active: false,
                toolCallId: entry.toolCallId,
                callEntryId: entry.id,
                status: "pending",
            };
            nodes.push(node);
            nodeById.set(node.id, node);
            projectedAncestorByEntryId.set(entry.id, node.id);
            nextVisibleParentId = node.id;
            nextToolNodesByCallId = new Map(toolNodesByCallId);
            nextToolNodesByCallId.set(entry.toolCallId, node);
        } else if (entry.type === "tool_result") {
            const toolNode = toolNodesByCallId.get(entry.toolCallId);
            if (!toolNode) {
                throw new Error(`Orphan tool_result ${entry.toolCallId} has no matching tool_call on this branch`);
            }
            if (toolNode.resultEntryId) {
                throw new Error(`Duplicate terminal tool_result ${entry.toolCallId} on one navigation branch`);
            }
            toolNode.resultEntryId = entry.id;
            toolNode.navigationTargetEntryId = entry.id;
            toolNode.status = entry.status
                ?? (entry.error !== undefined ? "failed" : "completed");
            toolNode.selectable = true;
            projectedAncestorByEntryId.set(entry.id, toolNode.id);
            nextVisibleParentId = toolNode.id;
        } else if (isVisibleEntry(entry)) {
            const node: SessionNavigationNode = {
                id: entry.id,
                parentId: visibleParentId,
                type: entry.type,
                depth: 0,
                createdAt: entry.createdAt,
                preview: getEntryPreview(entry),
                navigationTargetEntryId: entry.id,
                selectable: true,
                active: false,
            };
            nodes.push(node);
            nodeById.set(node.id, node);
            projectedAncestorByEntryId.set(entry.id, node.id);
            nextVisibleParentId = node.id;

            if (
                entry.type === "user_message"
                || entry.type === "assistant_message"
                || entry.type === "custom_message"
            ) {
                nextEffectiveMessagesById = new Map(effectiveMessagesById);
                nextEffectiveMessagesById.set(entry.messageId, structuredClone(entry.message));
                nextMessageNodesById = new Map(messageNodesById);
                nextMessageNodesById.set(entry.messageId, node);
            }
        } else {
            if (
                entry.type === "user_message"
                || entry.type === "assistant_message"
                || entry.type === "custom_message"
            ) {
                nextEffectiveMessagesById = new Map(effectiveMessagesById);
                nextEffectiveMessagesById.set(entry.messageId, structuredClone(entry.message));
            }
            projectedAncestorByEntryId.set(entry.id, visibleParentId);
        }

        for (const child of childrenByParent.get(entry.id) ?? []) {
            visit(
                child.id,
                nextVisibleParentId,
                nextMessageNodesById,
                nextToolNodesByCallId,
                nextEffectiveMessagesById,
            );
        }
    };

    visit(state.rootEntryId, null, new Map(), new Map(), new Map());

    const visibleChildrenByParent = new Map<string | null, SessionNavigationNode[]>();
    for (const node of nodes) {
        const children = visibleChildrenByParent.get(node.parentId) ?? [];
        children.push(node);
        visibleChildrenByParent.set(node.parentId, children);
    }

    const setDepth = (node: SessionNavigationNode, depth: number) => {
        node.depth = depth;
        const children = visibleChildrenByParent.get(node.id) ?? [];
        const childDepth = depth + (children.length > 1 ? 1 : 0);
        for (const child of children) setDepth(child, childDepth);
    };
    for (const rootNode of visibleChildrenByParent.get(null) ?? []) {
        setDepth(rootNode, 0);
    }

    const activeProjectionId = projectedAncestorByEntryId.get(state.activeEntryId) ?? null;
    if (activeProjectionId) {
        const activeNode = nodeById.get(activeProjectionId);
        if (activeNode) activeNode.active = true;
    }

    return { nodes };
}
