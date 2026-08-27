import {
    type LocalSession,
    type LocalSessionMetadata,
    type LocalSessionSnapshot,
    type LocalSessionStore,
} from "@more-more-code/session-store";
import {
    createSessionTree,
    restoreSessionTree,
    type SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";

export type LocalSessionSummary = Pick<
    LocalSession,
    "id" | "title" | "metadata" | "createdAt" | "updatedAt" | "archivedAt" | "revision"
>;

export type LocalSessionAuthority = {
    create(input: {
        id?: string;
        title: string;
        metadata?: LocalSessionMetadata;
    }): Promise<LocalSessionSnapshot<Message>>;
    list(): Promise<LocalSessionSummary[]>;
    open(sessionId: string): Promise<LocalSessionSnapshot<Message> | null>;
    commit(input: {
        sessionId: string;
        state: SessionTreeState<Message>;
        title?: string;
        metadata?: LocalSessionMetadata;
    }): Promise<LocalSessionSnapshot<Message>>;
    archive(sessionId: string): Promise<void>;
};

export type LocalSessionAuthorityOptions = {
    store: LocalSessionStore;
    createId?: () => string;
    now?: () => number;
};

function cloneSnapshot(snapshot: LocalSessionSnapshot<Message>) {
    return structuredClone(snapshot) as LocalSessionSnapshot<Message>;
}

async function requireSnapshot(
    store: LocalSessionStore,
    sessionId: string,
): Promise<LocalSessionSnapshot<Message>> {
    const snapshot = await store.load<Message>(sessionId);
    if (!snapshot) {
        throw new Error(`Local session ${sessionId} disappeared after it was persisted`);
    }
    return cloneSnapshot(snapshot);
}

/**
 * The CLI's local semantic-session boundary. It deliberately owns only
 * Session Tree persistence; AgentLoop, tools, model execution, and context
 * projection remain outside this module.
 */
export function createLocalSessionAuthority(
    options: LocalSessionAuthorityOptions,
): LocalSessionAuthority {
    const createId = options.createId ?? (() => crypto.randomUUID());
    const now = options.now ?? Date.now;

    return {
        async create(input) {
            const title = input.title.trim();
            if (!title) {
                throw new Error("A local session needs a non-empty title");
            }

            const id = input.id ?? createId();
            // A session becomes visible only after its durable root fact is in
            // the local store. The first user message is committed separately
            // by the durable turn seam before AgentLoop starts.
            const state = createSessionTree<Message>([], { createId, now });
            await options.store.create({
                id,
                title,
                state,
                ...(input.metadata ? { metadata: input.metadata } : {}),
            });
            return requireSnapshot(options.store, id);
        },

        async list() {
            const sessions = await options.store.list();
            return sessions.map((session) => ({
                id: session.id,
                title: session.title,
                metadata: structuredClone(session.metadata) as LocalSessionMetadata,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                archivedAt: session.archivedAt,
                revision: session.revision,
            }));
        },

        async open(sessionId) {
            const snapshot = await options.store.load<Message>(sessionId);
            return snapshot ? cloneSnapshot(snapshot) : null;
        },

        async commit(input) {
            // restoreSessionTree both clones the caller-owned value and keeps
            // legacy import handling at the authority boundary. The backing
            // store independently validates append-only invariants atomically.
            const state = restoreSessionTree<Message>(input.state);
            await options.store.commit({
                sessionId: input.sessionId,
                state,
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
            });
            return requireSnapshot(options.store, input.sessionId);
        },

        async archive(sessionId) {
            await options.store.archive(sessionId);
        },
    };
}
