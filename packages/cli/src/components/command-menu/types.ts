import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { ModeType, SupportedChatModelId } from "@more-more-code/shared";

export type SessionTreeCommandNode = {
    id: string;
    parentId: string | null;
    depth: number;
    createdAt: number;
    messageCount: number;
    preview: string;
    active: boolean;
};

export type SessionTreeCommandApi = {
    rootNodeId: string;
    activeNodeId: string;
    nodes: SessionTreeCommandNode[];
    jump: (nodeId: string) => void;
    jumpParent: () => boolean;
    jumpRoot: () => void;
};

export type CommandContext = {
    exit: () => void;
    toast: ToastContextValue;
    dialog: DialogContextValue
    navigate: (path: string) => void;
    mode: ModeType,
    setMode: (mode: ModeType) => void;
    setModel: (model: SupportedChatModelId) => void;
    sessionTree?: SessionTreeCommandApi;
}

export type Command = {
    name: string;
    description?: string;
    value: string;
    action?: (ctx: CommandContext) => void | Promise<void>;
}