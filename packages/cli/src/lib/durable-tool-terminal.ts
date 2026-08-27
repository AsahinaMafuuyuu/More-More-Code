import { isToolUIPart } from "ai";
import {
    appendSessionEntries,
    projectSessionEntryPath,
    projectSessionTreeMessages,
    restoreSessionTree,
    type SessionEntryInput,
    type SessionEntryMetadata,
    type SessionToolCallEntry,
    type SessionToolResultEntry,
    type SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";
import {
    appendDurableSessionMessages,
    normalizeDurableMessage,
    normalizeDurableSessionData,
} from "./durable-session-message";

/** The narrow authority contract required by the durable Tool-terminal seam. */
export type DurableToolTerminalAuthority = {
    commit(input: {
        sessionId: string;
        state: SessionTreeState<Message>;
    }): Promise<{ state: SessionTreeState<Message> }>;
};

export type DurableToolOutputPresentation =
    | {
        state: "output-available";
        output: unknown;
    }
    | {
        state: "output-error";
        errorText: string;
    };

export type DurableToolTerminalResult = {
    status: NonNullable<SessionToolResultEntry["status"]>;
    source?: string;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
};

export type DurableToolTerminalError = {
    message: string;
    code: string;
    details?: unknown;
};

export type DurableToolCallState =
    | { status: "none" }
    | { status: "pending"; call: SessionToolCallEntry }
    | { status: "terminal"; result: SessionToolResultEntry };

export type PersistThenExposeToolTerminalInput = {
    authority: DurableToolTerminalAuthority;
    sessionId: string;
    state: SessionTreeState<Message>;
    toolCallId: string;
    toolName: string;
    presentation: DurableToolOutputPresentation;
    result: DurableToolTerminalResult;
    metadata?: SessionEntryMetadata;
    error?: DurableToolTerminalError;
    /** Called only after the full authority commit has succeeded. */
    onCommitted?: (state: SessionTreeState<Message>) => void | Promise<void>;
    /** The Chat/UI bridge. It must never receive a terminal before commit. */
    expose: () => void | Promise<void>;
};

function updateToolPart(
    part: Message["parts"][number],
    toolCallId: string,
    presentation: DurableToolOutputPresentation,
) {
    if (!isToolUIPart(part) || part.toolCallId !== toolCallId) {
        return { part, matched: false };
    }

    const cleanPart = normalizeDurableSessionData(part, "Durable Tool UI part") as Record<string, unknown>;
    const next = presentation.state === "output-available"
        ? (() => {
            const { errorText: _errorText, ...withoutErrorText } = cleanPart;
            return {
                ...withoutErrorText,
                state: "output-available" as const,
                output: normalizeDurableSessionData(presentation.output, "Durable Tool output"),
            };
        })()
        : (() => {
            const { output: _output, ...withoutOutput } = cleanPart;
            return {
                ...withoutOutput,
                state: "output-error" as const,
                errorText: presentation.errorText,
            };
        })();
    return { part: next as Message["parts"][number], matched: true };
}

/**
 * Returns the durable lifecycle state for one tool call on the active Session
 * branch. A pending call is intentionally not replayable: doing so could
 * repeat an external side effect after a restart.
 */
export function inspectDurableToolCall(
    state: SessionTreeState<Message>,
    toolCallId: string,
): DurableToolCallState {
    const path = projectSessionEntryPath(state);
    let call: SessionToolCallEntry | null = null;

    for (const entry of path) {
        if (entry.type === "tool_call" && entry.toolCallId === toolCallId) {
            call = entry;
            continue;
        }
        if (entry.type === "tool_result" && entry.toolCallId === toolCallId) {
            return { status: "terminal", result: entry };
        }
    }

    return call ? { status: "pending", call } : { status: "none" };
}

/**
 * Appends the model-visible terminal Tool Result and its matching immutable
 * Session `message_update` to one next tree state. This deliberately reuses
 * the CLI durable-message adapter over Harness' projection/update constructor
 * instead of introducing a second message-update or cleanup policy.
 */
export function buildDurableToolTerminalState(input: Omit<
    PersistThenExposeToolTerminalInput,
    "authority" | "onCommitted" | "expose"
>): SessionTreeState<Message> {
    const metadata = normalizeDurableSessionData(
        input.metadata ?? {},
        "Durable Tool metadata",
    ) as SessionEntryMetadata;
    const messages = projectSessionTreeMessages(input.state);
    let matched = false;
    const updatedMessages = messages.map((message) => {
        const nextParts = message.parts.map((part) => {
            const updated = updateToolPart(part, input.toolCallId, input.presentation);
            matched ||= updated.matched;
            return updated.part;
        });
        if (!nextParts.some((part, index) => part !== message.parts[index])) {
            return normalizeDurableMessage(message);
        }
        return normalizeDurableMessage({
            ...message,
            parts: nextParts,
        });
    });

    if (!matched) {
        throw new Error(`Cannot make tool result ${input.toolCallId} durable because its UI tool call is absent`);
    }

    const stateWithToolOutput = appendDurableSessionMessages(
        input.state,
        updatedMessages,
        metadata,
    );
    const terminal = {
        type: "tool_result" as const,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        status: input.result.status,
        ...(input.presentation.state === "output-available"
            ? {
                output: normalizeDurableSessionData(
                    input.presentation.output,
                    "Durable Tool result output",
                ),
            }
            : { error: input.presentation.errorText }),
        ...(input.result.source ? { source: input.result.source } : {}),
        ...(input.result.startedAt === undefined ? {} : { startedAt: input.result.startedAt }),
        ...(input.result.completedAt === undefined ? {} : { completedAt: input.result.completedAt }),
        ...(input.result.durationMs === undefined ? {} : { durationMs: input.result.durationMs }),
        ...metadata,
    };
    const entries: SessionEntryInput<Message>[] = [terminal];
    if (input.error) {
        entries.push({
            type: "error" as const,
            message: input.error.message,
            code: input.error.code,
            ...(input.error.details === undefined
                ? {}
                : {
                    details: normalizeDurableSessionData(
                        input.error.details,
                        "Durable Tool error details",
                    ),
                }),
            ...metadata,
        });
    }
    return appendSessionEntries(stateWithToolOutput, entries);
}

/**
 * Authority commit is the side-effect gate. UI/provider-facing tool output is
 * intentionally published only after the tree containing both `message_update`
 * and `tool_result` has committed. Any commit rejection reaches AgentLoop so
 * it records a failed Run instead of taking a continuation model step.
 */
export async function persistThenExposeToolTerminal(
    input: PersistThenExposeToolTerminalInput,
): Promise<SessionTreeState<Message>> {
    const next = buildDurableToolTerminalState(input);
    const snapshot = await input.authority.commit({
        sessionId: input.sessionId,
        state: next,
    });
    const committed = restoreSessionTree<Message>(snapshot.state);
    await input.onCommitted?.(committed);
    await input.expose();
    return committed;
}
