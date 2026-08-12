import { apiClient } from "./api-client";
import { getErrorMessage } from "./http-errors";
import type { SessionTreeState } from "@more-more-code/harness";
import type { Message } from "./chat-types";

/**
 * Cloud session persistence. This is intentionally outside the Agent Runtime:
 * failures here must not affect local model/tool execution.
 */
export async function persistSessionState(
    sessionId: string,
    state: SessionTreeState<Message>,
) {
    const response = await apiClient.sessions[":id"].state.$post({
        param: { id: sessionId },
        json: { state },
    });

    if (!response.ok) {
        throw new Error(await getErrorMessage(response));
    }
}
