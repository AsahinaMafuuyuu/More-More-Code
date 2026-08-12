import { apiClient } from "./api-client";
import { getErrorMessage } from "./http-errors";
import type { Message } from "./chat-types";

/**
 * Cloud session persistence. This is intentionally outside the Agent Runtime:
 * failures here must not affect local model/tool execution.
 */
export async function persistSessionMessages(
    sessionId: string,
    messages: Message[],
) {
    const response = await apiClient.sessions[":id"].messages.$post({
        param: { id: sessionId },
        json: { messages },
    });

    if (!response.ok) {
        throw new Error(await getErrorMessage(response));
    }
}
