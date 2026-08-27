import {
    appendSessionEntry,
    appendSessionTreeMessages,
    projectSessionRuntimeState,
    type SessionTreeState,
} from "@more-more-code/harness";
import type { ModelRef, ModeType } from "@more-more-code/shared";
import { createAgentUserMessage } from "./agent-chat-message";
import type { Message } from "./chat-types";
import type { LocalSessionAuthority } from "./local-session-authority";

export type DurableSessionTurnSelection = {
    mode: ModeType;
    model: ModelRef;
};

export type DurableSessionTurnInput<TResult> = {
    authority: Pick<LocalSessionAuthority, "commit">;
    sessionId: string;
    state: SessionTreeState<Message>;
    userText: string;
    selection: DurableSessionTurnSelection;
    inputMessageId?: string;
    runAgent: (input: {
        state: SessionTreeState<Message>;
        message: Message;
        inputMessageId: string;
    }) => Promise<TResult>;
};

export type DurableSessionTurnState = {
    state: SessionTreeState<Message>;
    message: Message;
    inputMessageId: string;
};

/**
 * Builds a semantic user intent as one append-only Session Tree transition.
 * Model/mode selection belongs in the same durable transition so a restart
 * can resume with the exact context and provider selection that created it.
 */
export function buildDurableSessionTurnState(input: Omit<
    DurableSessionTurnInput<never>,
    "authority" | "runAgent"
>): DurableSessionTurnState {
    const text = input.userText.trim();
    if (!text) throw new Error("Cannot submit an empty user message");

    const inputMessageId = input.inputMessageId ?? crypto.randomUUID();
    const message = createAgentUserMessage({
        id: inputMessageId,
        text,
        mode: input.selection.mode,
        model: input.selection.model,
    });
    const runtime = projectSessionRuntimeState(input.state);
    let state = input.state;

    if (
        runtime.model !== input.selection.model.modelId
        || runtime.provider !== input.selection.model.providerId
    ) {
        state = appendSessionEntry(state, {
            type: "model_change",
            model: input.selection.model.modelId,
            provider: input.selection.model.providerId,
        });
    }
    if (runtime.mode !== input.selection.mode) {
        state = appendSessionEntry(state, {
            type: "mode_change",
            mode: input.selection.mode,
        });
    }

    return {
        state: appendSessionTreeMessages(state, [message]),
        message,
        inputMessageId,
    };
}

/**
 * The durable-first turn gate. No model or tool work is handed to runAgent
 * until the complete user intent has committed successfully.
 */
export async function runDurableSessionTurn<TResult>(
    input: DurableSessionTurnInput<TResult>,
): Promise<TResult> {
    const next = buildDurableSessionTurnState(input);
    const snapshot = await input.authority.commit({
        sessionId: input.sessionId,
        state: next.state,
    });

    return input.runAgent({
        state: snapshot.state,
        message: next.message,
        inputMessageId: next.inputMessageId,
    });
}
