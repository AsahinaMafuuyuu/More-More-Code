import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { ModeType, SupportedChatModelId } from "@more-more-code/shared";
import type { ManualContextCompactionOutcome } from "../../lib/local-model-transport";

export type SessionTreeCommandEntry = {
    id: string;
    parentId: string | null;
    type: string;
    depth: number;
    createdAt: number;
    messageCount: number;
    preview: string;
    active: boolean;
};

/** @deprecated Session Tree v3 nodes are Session Entries. */
export type SessionTreeCommandNode = SessionTreeCommandEntry;

export type SessionTreeCommandApi = {
    rootEntryId: string;
    activeEntryId: string;
    entries: SessionTreeCommandEntry[];
    jump: (entryId: string) => void;
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
    compact?: () => Promise<ManualContextCompactionOutcome>;
}

export type Command = {
    name: string;
    description?: string;
    value: string;
    action?: (ctx: CommandContext) => void | Promise<void>;
}
