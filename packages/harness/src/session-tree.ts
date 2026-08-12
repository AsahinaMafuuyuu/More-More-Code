export const SESSION_TREE_VERSION = 1 as const;

export type SessionTreeNode<TMessage = unknown> = {
  id: string;
  parentId: string | null;
  createdAt: number;
  messages: TMessage[];
  runId?: string;
  inputMessageId?: string;
};

export type SessionTreeState<TMessage = unknown> = {
  version: typeof SESSION_TREE_VERSION;
  rootNodeId: string;
  activeNodeId: string;
  nodes: SessionTreeNode<TMessage>[];
};

type SessionTreeOptions = {
  createId?: () => string;
  now?: () => number;
};

function defaultCreateId() {
  return crypto.randomUUID();
}

function cloneMessages<TMessage>(messages: readonly TMessage[]): TMessage[] {
  return structuredClone(messages) as TMessage[];
}

function cloneState<TMessage>(state: SessionTreeState<TMessage>): SessionTreeState<TMessage> {
  return {
    ...state,
    nodes: state.nodes.map((node) => ({
      ...node,
      messages: cloneMessages(node.messages),
    })),
  };
}

export function createSessionTree<TMessage>(
  initialMessages: readonly TMessage[] = [],
  options: SessionTreeOptions = {},
): SessionTreeState<TMessage> {
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? Date.now;
  const rootNodeId = createId();

  return {
    version: SESSION_TREE_VERSION,
    rootNodeId,
    activeNodeId: rootNodeId,
    nodes: [
      {
        id: rootNodeId,
        parentId: null,
        createdAt: now(),
        messages: cloneMessages(initialMessages),
      },
    ],
  };
}

export function getSessionTreeNode<TMessage>(
  state: SessionTreeState<TMessage>,
  nodeId: string,
) {
  return state.nodes.find((node) => node.id === nodeId) ?? null;
}

export function getActiveSessionTreeNode<TMessage>(state: SessionTreeState<TMessage>) {
  const node = getSessionTreeNode(state, state.activeNodeId);
  if (!node) {
    throw new Error(`Active session tree node ${state.activeNodeId} does not exist`);
  }
  return node;
}

export function appendSessionTreeNode<TMessage>(
  state: SessionTreeState<TMessage>,
  messages: readonly TMessage[],
  metadata: { runId?: string; inputMessageId?: string } = {},
  options: SessionTreeOptions = {},
): SessionTreeState<TMessage> {
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? Date.now;
  const parent = getActiveSessionTreeNode(state);
  const node: SessionTreeNode<TMessage> = {
    id: createId(),
    parentId: parent.id,
    createdAt: now(),
    messages: cloneMessages(messages),
    ...metadata,
  };

  const cloned = cloneState(state);

  return {
    ...cloned,
    activeNodeId: node.id,
    nodes: [...cloned.nodes, node],
  };
}

export function jumpToSessionTreeNode<TMessage>(
  state: SessionTreeState<TMessage>,
  nodeId: string,
): SessionTreeState<TMessage> {
  if (!getSessionTreeNode(state, nodeId)) {
    throw new Error(`Session tree node ${nodeId} does not exist`);
  }

  return {
    ...cloneState(state),
    activeNodeId: nodeId,
  };
}

export function getParentSessionTreeNode<TMessage>(state: SessionTreeState<TMessage>) {
  const active = getActiveSessionTreeNode(state);
  return active.parentId ? getSessionTreeNode(state, active.parentId) : null;
}

function validateSessionTreeState<TMessage>(state: SessionTreeState<TMessage>) {
  const nodeById = new Map<string, SessionTreeNode<TMessage>>();

  for (const node of state.nodes) {
    if (nodeById.has(node.id)) {
      throw new Error(`Duplicate session tree node ${node.id}`);
    }
    nodeById.set(node.id, node);
  }

  const root = nodeById.get(state.rootNodeId);
  if (!root) throw new Error(`Root session tree node ${state.rootNodeId} does not exist`);
  if (root.parentId !== null) throw new Error("Root session tree node must not have a parent");
  if (!nodeById.has(state.activeNodeId)) {
    throw new Error(`Active session tree node ${state.activeNodeId} does not exist`);
  }

  for (const node of state.nodes) {
    if (node.parentId !== null && !nodeById.has(node.parentId)) {
      throw new Error(`Parent session tree node ${node.parentId} does not exist`);
    }

    const visited = new Set<string>();
    let current: SessionTreeNode<TMessage> | undefined = node;
    while (current?.parentId) {
      if (visited.has(current.id)) {
        throw new Error(`Session tree contains a cycle at ${current.id}`);
      }
      visited.add(current.id);
      current = nodeById.get(current.parentId);
    }
  }
}

export function isSessionTreeState(value: unknown): value is SessionTreeState<unknown> {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<SessionTreeState<unknown>>;
  return candidate.version === SESSION_TREE_VERSION
    && typeof candidate.rootNodeId === "string"
    && typeof candidate.activeNodeId === "string"
    && Array.isArray(candidate.nodes)
    && candidate.nodes.every((node) => {
      if (!node || typeof node !== "object") return false;
      const candidateNode = node as Partial<SessionTreeNode<unknown>>;
      return typeof candidateNode.id === "string"
        && (candidateNode.parentId === null || typeof candidateNode.parentId === "string")
        && typeof candidateNode.createdAt === "number"
        && Array.isArray(candidateNode.messages);
    });
}

/** Restores v1 tree snapshots and upgrades legacy linear message arrays. */
export function restoreSessionTree<TMessage>(
  persisted: unknown,
  options: SessionTreeOptions = {},
): SessionTreeState<TMessage> {
  if (isSessionTreeState(persisted)) {
    const state = cloneState(persisted as SessionTreeState<TMessage>);
    validateSessionTreeState(state);
    return state;
  }

  if (Array.isArray(persisted)) {
    return createSessionTree(persisted as TMessage[], options);
  }

  return createSessionTree<TMessage>([], options);
}
