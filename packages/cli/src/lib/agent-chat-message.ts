import type { ModeType, SupportedChatModelId } from "@more-more-code/shared";

export function createAgentUserMessage(params: {
    id: string;
    text: string;
    mode: ModeType;
    model: SupportedChatModelId;
}) {
    return {
        id: params.id,
        role: "user",
        parts: [{ type: "text", text: params.text }],
        metadata: {
            mode: params.mode,
            model: params.model,
        },
    } as const;
}
