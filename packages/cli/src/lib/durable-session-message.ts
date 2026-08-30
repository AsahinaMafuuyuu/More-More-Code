import { isToolUIPart } from "./chat-types";
import {
    appendSessionEntry,
    appendSessionTreeMessages,
    projectSessionEntryPath,
    projectSessionTreeMessages,
    type SessionEntryMetadata,
    type SessionToolResultEntry,
    type SessionTreeOptions,
    type SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";

/**
 * Canonicalizes one runtime/UI message for durable Session history.
 *
 * This is intentionally narrower than a generic JavaScript serializer:
 * `undefined` is canonicalized only where JSON has an unambiguous absence
 * representation, while values that cannot round-trip losslessly still fail.
 */
export function normalizeDurableMessage(message: Message): Message {
    return normalizeDurableSessionData(message, "Durable message");
}

export function normalizeDurableMessages(messages: readonly Message[]): Message[] {
    return messages.map((message, index) => normalizeDurableSessionData(
        message,
        `Durable messages[${index}]`,
    ));
}

/**
 * The single CLI message-to-Session-Tree append boundary. Callers supply
 * runtime/UI messages; only their normalized durable representations reach the
 * provider-independent Harness constructor.
 */
export function appendDurableSessionMessages(
    state: SessionTreeState<Message>,
    messages: readonly Message[],
    metadata: SessionEntryMetadata = {},
    options: SessionTreeOptions<Message> = {},
): SessionTreeState<Message> {
    return appendSessionTreeMessages(
        state,
        normalizeDurableMessages(messages),
        metadata,
        options,
    );
}

/**
 * Appends exactly one finalized assistant response. Normal streaming/UI
 * revisions are intentionally not represented as durable `message_update`
 * entries. Existing legacy messages remain readable through the normal
 * projection path, but a second incompatible finalization fails closed.
 */
export function appendFinalizedDurableAssistantMessage(
    state: SessionTreeState<Message>,
    message: Message,
    metadata: SessionEntryMetadata = {},
    options: SessionTreeOptions<Message> = {},
): SessionTreeState<Message> {
    if (message.role !== "assistant") {
        throw new Error(`Finalized durable model message ${message.id} must be assistant role`);
    }

    const normalized = normalizeDurableMessage(message);
    const existingBase = projectSessionEntryPath(state).find((entry) => (
        (entry.type === "user_message"
            || entry.type === "assistant_message"
            || entry.type === "custom_message")
        && entry.messageId === normalized.id
    ));

    if (!existingBase) {
        return appendSessionEntry(state, {
            type: "assistant_message",
            messageId: normalized.id,
            message: normalized,
            ...normalizeDurableSessionData(metadata, "Durable finalized message metadata"),
        }, options);
    }

    const effective = projectSessionTreeMessages(state).find((candidate) => candidate.id === normalized.id);
    if (effective && JSON.stringify(effective) === JSON.stringify(normalized)) {
        return state;
    }

    throw new Error(
        `Finalized durable assistant message ${normalized.id} already exists with different content`,
    );
}

/**
 * A UI runtime may keep one assistant message alive across Tool continuations
 * and append a `step-start` marker before each new model step. Durable Session
 * semantics are step-scoped instead: every completed AgentLoop Model Step is
 * one immutable assistant_message Entry.
 *
 * The durable identity therefore comes from Harness' stepId rather than the
 * aggregate UIMessage id, and only the parts produced by the current step are
 * persisted. This prevents a legal Tool continuation from looking like an
 * incompatible rewrite of an already-finalized assistant message.
 */
export function appendFinalizedDurableAssistantStep(
    state: SessionTreeState<Message>,
    aggregateMessage: Message,
    metadata: SessionEntryMetadata,
    options: SessionTreeOptions<Message> = {},
): SessionTreeState<Message> {
    const stepId = metadata.stepId?.trim();
    if (!stepId) {
        throw new Error("Finalized durable assistant Model Step requires stepId");
    }

    return appendFinalizedDurableAssistantMessage(
        state,
        createFinalizedDurableAssistantStepMessage(aggregateMessage, stepId),
        metadata,
        options,
    );
}

export function createFinalizedDurableAssistantStepMessage(
    aggregateMessage: Message,
    stepId: string,
): Message {
    if (aggregateMessage.role !== "assistant") {
        throw new Error(`Finalized durable model message ${aggregateMessage.id} must be assistant role`);
    }

    const durableStepId = stepId.trim();
    if (!durableStepId) {
        throw new Error("Finalized durable assistant Model Step requires stepId");
    }

    let currentStepStart = -1;
    for (let index = aggregateMessage.parts.length - 1; index >= 0; index -= 1) {
        if (aggregateMessage.parts[index]?.type !== "step-start") continue;
        currentStepStart = index;
        break;
    }

    const currentStepParts = aggregateMessage.parts.slice(currentStepStart + 1);
    if (currentStepParts.length === 0) {
        throw new Error(`Finalized durable assistant Model Step ${durableStepId} has no semantic parts`);
    }

    return normalizeDurableMessage({
        ...aggregateMessage,
        id: `assistant-step:${durableStepId}`,
        parts: currentStepParts,
    });
}

function terminalToolPresentation(
    part: Message["parts"][number],
    result: SessionToolResultEntry,
): Message["parts"][number] {
    const cleanPart = structuredClone(part) as Record<string, unknown>;
    const status = result.status ?? (result.error !== undefined ? "failed" : "completed");

    if (status === "completed") {
        const { errorText: _errorText, ...withoutError } = cleanPart;
        return {
            ...withoutError,
            state: "output-available",
            output: structuredClone(result.output),
        } as Message["parts"][number];
    }

    const { output: _output, ...withoutOutput } = cleanPart;
    return {
        ...withoutOutput,
        state: "output-error",
        errorText: result.error ?? `Tool ended with status ${status}`,
    } as Message["parts"][number];
}

/**
 * Reconstructs effective runtime/UI messages from canonical Session facts.
 * Legacy `message_update` entries are replayed by Harness first; terminal Tool
 * state is then joined from exact `tool_call`/`tool_result` facts. The source
 * Session Tree is never mutated.
 */
export function projectDurableSessionMessages(
    state: SessionTreeState<Message>,
    entryId = state.activeEntryId,
): Message[] {
    const messages = projectSessionTreeMessages(state, entryId);
    const path = projectSessionEntryPath(state, entryId);
    const calls = new Map<string, Extract<(typeof path)[number], { type: "tool_call" }>>();
    const results = new Map<string, Extract<(typeof path)[number], { type: "tool_result" }>>();

    for (const entry of path) {
        if (entry.type === "tool_call") {
            if (calls.has(entry.toolCallId)) {
                throw new Error(`Duplicate tool_call ${entry.toolCallId} on one Session branch`);
            }
            calls.set(entry.toolCallId, entry);
            continue;
        }
        if (entry.type !== "tool_result") continue;
        if (!calls.has(entry.toolCallId)) {
            throw new Error(`Orphan tool_result ${entry.toolCallId} has no matching tool_call`);
        }
        if (results.has(entry.toolCallId)) {
            throw new Error(`Duplicate terminal tool_result ${entry.toolCallId} on one Session branch`);
        }
        results.set(entry.toolCallId, entry);
    }

    const toolPartLocations = new Map<string, Array<{ messageIndex: number; partIndex: number }>>();
    messages.forEach((message, messageIndex) => {
        if (message.role !== "assistant") return;
        message.parts.forEach((part, partIndex) => {
            if (!isToolUIPart(part)) return;
            const locations = toolPartLocations.get(part.toolCallId) ?? [];
            locations.push({ messageIndex, partIndex });
            toolPartLocations.set(part.toolCallId, locations);
        });
    });

    for (const toolCallId of calls.keys()) {
        const locations = toolPartLocations.get(toolCallId) ?? [];
        if (locations.length !== 1) {
            throw new Error(
                `Tool call ${toolCallId} expected exactly one matching assistant Tool part, found ${locations.length}`,
            );
        }
    }

    for (const [toolCallId, result] of results) {
        const match = toolPartLocations.get(toolCallId)![0]!;
        const message = messages[match.messageIndex]!;
        const parts = [...message.parts];
        parts[match.partIndex] = terminalToolPresentation(parts[match.partIndex]!, result);
        messages[match.messageIndex] = {
            ...message,
            parts,
        };
    }

    return messages;
}

/**
 * Shared Session-data policy used by the Tool-terminal adapter for metadata,
 * Tool output, and error details. It is exported only inside the CLI semantic
 * adapter layer so message and Tool persistence cannot drift into two cleanup
 * policies.
 */
export function normalizeDurableSessionData<T>(value: T, label = "Durable Session data"): T {
    return normalizeValue(value, label, new Set<object>()) as T;
}

function normalizeValue(value: unknown, path: string, ancestors: Set<object>): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${path} contains a non-finite number`);
        }
        return value;
    }

    if (typeof value !== "object") {
        throw new TypeError(`${path} must be JSON-safe`);
    }

    if (ancestors.has(value)) {
        throw new TypeError(`${path} contains a cycle and cannot be persisted`);
    }
    ancestors.add(value);

    try {
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new TypeError(`${path} contains symbol properties`);
        }

        if (Array.isArray(value)) {
            const result: unknown[] = new Array(value.length);
            for (let index = 0; index < value.length; index += 1) {
                const hasValue = Object.prototype.hasOwnProperty.call(value, index);
                const child = hasValue ? value[index] : undefined;
                result[index] = child === undefined
                    ? null
                    : normalizeValue(child, `${path}[${index}]`, ancestors);
            }
            return result;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${path} contains a non-plain object`);
        }

        const result = Object.create(prototype) as Record<string, unknown>;
        for (const key of Object.keys(value)) {
            const child = (value as Record<string, unknown>)[key];
            if (child === undefined) continue;

            Object.defineProperty(result, key, {
                value: normalizeValue(child, `${path}.${key}`, ancestors),
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}
