export type SessionTreeCommandEntry = {
    id: string;
    parentId: string | null;
    type: string;
    depth: number;
    createdAt: number;
    messageCount: number;
    preview: string;
    navigationTargetEntryId: string;
    selectable: boolean;
    active: boolean;
};

/** @deprecated Session Tree v3 nodes are Session Entries. */
export type SessionTreeCommandNode = SessionTreeCommandEntry;

export type SessionTreeNavigationDecision = "carry" | "no-carry" | "cancel";

export type SessionTreeNavigationIntent = {
    action: "jump" | "ask" | "carry";
    policy: "ask" | "always" | "never";
    sourceTipEntryId: string;
    targetEntryId: string;
    commonAncestorEntryId: string;
    coveredEntryIds: string[];
};

export type SessionTreeNavigationResult = {
    status: "decision-required" | "cancelled" | "jumped" | "carried" | "carry-failed";
    fallbackUsed?: boolean;
    fallbackReason?: string;
};

export type SessionTreeCommandApi = {
    rootEntryId: string;
    activeEntryId: string;
    parentEntryId: string | null;
    entries: SessionTreeCommandEntry[];
    inspectJump: (entryId: string) => SessionTreeNavigationIntent;
    jump: (
        entryId: string,
        decision?: SessionTreeNavigationDecision,
    ) => Promise<SessionTreeNavigationResult>;
};

export type Command = {
    name: string;
    description?: string;
    value: string;
}
