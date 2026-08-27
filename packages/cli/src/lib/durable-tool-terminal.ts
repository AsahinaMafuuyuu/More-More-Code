import { isToolUIPart } from "ai";
import {
    appendSessionEntries,
    projectSessionEntryPath,
    restoreSessionTree,
    type SessionEntryInput,
    type SessionEntryMetadata,
    type SessionToolCallEntry,
    type SessionToolResultEntry,
    type SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";
import {
    normalizeDurableSessionData,
    projectDurableSessionMessages,
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
 * Appends one canonical Tool Result (and optional semantic error) without
 * persisting a second copy into the assistant message. Terminal UI/provider
 * state is reconstructed later by Message Projection from `tool_result`.
 */
export function buildDurableToolTerminalState(input: Omit<
    PersistThenExposeToolTerminalInput,
    "authority" | "onCommitted" | "expose"
>): SessionTreeState<Message> {
    const metadata = normalizeDurableSessionData(
        input.metadata ?? {},
        "Durable Tool metadata",
    ) as SessionEntryMetadata;
    const lifecycle = inspectDurableToolCall(input.state, input.toolCallId);
    if (lifecycle.status !== "pending") {
        throw new Error(
            `Cannot persist tool result ${input.toolCallId}: expected one pending durable tool_call`,
        );
    }
    if (lifecycle.call.toolName !== input.toolName) {
        throw new Error(
            `Cannot persist tool result ${input.toolCallId}: tool name ${input.toolName} does not match durable call ${lifecycle.call.toolName}`,
        );
    }

    const matchedToolParts = projectDurableSessionMessages(input.state)
        .flatMap((message) => message.parts)
        .filter((part) => isToolUIPart(part) && part.toolCallId === input.toolCallId);
    if (matchedToolParts.length !== 1) {
        throw new Error(`Cannot make tool result ${input.toolCallId} durable because its UI tool call is absent`);
    }
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
    return appendSessionEntries(input.state, entries);
}

/**
 * Authority commit is the side-effect gate. UI/provider-facing tool output is
 * intentionally published only after the tree containing `tool_result` has
 * committed. Any commit rejection reaches AgentLoop so
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
