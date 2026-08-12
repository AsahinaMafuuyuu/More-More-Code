import type { ModeType, SupportedChatModelId } from "@more-more-code/shared";

export function createAgentUserMessage(params: {
    id: string;
    text: string;
    mode: ModeType;
    model: SupportedChatModelId;
}) {
    return {
        id: params.id,
        role: "user" as const,
        parts: [{ type: "text" as const, text: params.text }],
        metadata: {
            mode: params.mode,
            model: params.model,
        },
    };
}
