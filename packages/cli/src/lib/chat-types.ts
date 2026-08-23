import type {
    InferUITools,
    LanguageModelUsage,
    UIMessage,
} from "ai";
import type {
    ModelRef,
    ModeType,
    ToolContracts,
} from "@more-more-code/shared";

export type ChatMessageMetadata = {
    mode?: ModeType;
    model?: ModelRef | string;
    durationMs?: number;
    usage?: LanguageModelUsage;
};

export type ChatTools = {
    [Name in keyof InferUITools<ToolContracts>]: {
        input: InferUITools<ToolContracts>[Name]["input"];
        output: unknown;
    };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;
