import type { CompactionCheckpointV2, ContextCompactionTrigger } from "./context";

export const SESSION_TREE_VERSION = 3 as const;

export type SessionEntryType =
  | "session_start"
  | "user_message"
  | "assistant_message"
  | "custom_message"
  | "message_update"
  | "tool_call"
  | "tool_result"
  | "error"
  | "model_change"
  | "mode_change"
  | "config_change"
  | "compaction"
  | "branch_summary"
  | "custom";

export type SessionEntryMetadata = {
  runId?: string;
  turnId?: string;
  stepId?: string;
  inputMessageId?: string;
};

export type SessionEntryBase = SessionEntryMetadata & {
  id: string;
  parentId: string | null;
  createdAt: number;
  type: SessionEntryType;
};

export type SessionStartEntry = SessionEntryBase & {
  type: "session_start";
};

export type SessionMessageEntry<TMessage = unknown> = SessionEntryBase & {
  type: "user_message" | "assistant_message" | "custom_message";
  messageId: string;
  message: TMessage;
};

export type SessionMessageUpdateEntry<TMessage = unknown> = SessionEntryBase & {
  type: "message_update";
  messageId: string;
  message: TMessage;
};

export type SessionToolCallEntry = SessionEntryBase & {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type SessionToolResultStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "denied"
  | "approval_required";

export type SessionToolResultEntry = SessionEntryBase & {
  type: "tool_result";
  toolCallId: string;
  toolName?: string;
  output?: unknown;
  error?: string;
  status?: SessionToolResultStatus;
  source?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
};

export type SessionErrorEntry = SessionEntryBase & {
  type: "error";
  message: string;
  code?: string;
  details?: unknown;
};

export type SessionModelChangeEntry = SessionEntryBase & {
  type: "model_change";
  model: string;
  provider?: string;
};

export type SessionModeChangeEntry = SessionEntryBase & {
  type: "mode_change";
  mode: string;
};

export type SessionConfigChangeEntry = SessionEntryBase & {
  type: "config_change";
  key: string;
  value: unknown;
  previousValue?: unknown;
};

export type SessionCompactionEntry = SessionEntryBase & {
  type: "compaction";
  summary: unknown;
  checkpointV2?: CompactionCheckpointV2;
  compactionPlanId?: string;
  tokensBefore?: number;
  trigger?: ContextCompactionTrigger;
  inputTokensBefore?: number;
  inputTokensAfter?: number;
  inputBudgetTokens?: number;
  targetInputTokens?: number;
  targetSummaryTokens?: number;
  compactedThroughRecordId?: string;
  compactedThroughMessageId?: string;
  compactedMessageIds?: string[];
  retainedTailMessageIds?: string[];
  compactedRecordIds?: string[];
  retainedTailRecordIds?: string[];
};

export type SessionBranchSummaryEntry = SessionEntryBase & {
  type: "branch_summary";
  summary: unknown;
  transfer?: SessionBranchSummaryTransferMetadata;
};

export type SessionBranchSummaryTransferMetadata = {
  sourceTipEntryId: string;
  targetEntryId: string;
  commonAncestorEntryId: string;
  coveredEntryIds: string[];
  previousTransferEntryIds?: string[];
};

export type SessionCustomEntry = SessionEntryBase & {
  type: "custom";
  customType: string;
  data: unknown;
};

export type SessionEntry<TMessage = unknown> =
  | SessionStartEntry
  | SessionMessageEntry<TMessage>
  | SessionMessageUpdateEntry<TMessage>
  | SessionToolCallEntry
  | SessionToolResultEntry
  | SessionErrorEntry
  | SessionModelChangeEntry
  | SessionModeChangeEntry
  | SessionConfigChangeEntry
  | SessionCompactionEntry
  | SessionBranchSummaryEntry
  | SessionCustomEntry;

export type SessionEntryInput<TMessage = unknown> =
  | (SessionEntryMetadata & {
      type: "user_message" | "assistant_message" | "custom_message";
      messageId: string;
      message: TMessage;
    })
  | (SessionEntryMetadata & {
      type: "message_update";
      messageId: string;
      message: TMessage;
    })
  | (SessionEntryMetadata & {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    })
  | (SessionEntryMetadata & {
      type: "tool_result";
      toolCallId: string;
      toolName?: string;
      output?: unknown;
      error?: string;
      status?: SessionToolResultStatus;
      source?: string;
      startedAt?: number;
      completedAt?: number;
      durationMs?: number;
    })
  | (SessionEntryMetadata & {
      type: "error";
      message: string;
      code?: string;
      details?: unknown;
    })
  | (SessionEntryMetadata & {
      type: "model_change";
      model: string;
      provider?: string;
    })
  | (SessionEntryMetadata & {
      type: "mode_change";
      mode: string;
    })
  | (SessionEntryMetadata & {
      type: "config_change";
      key: string;
      value: unknown;
      previousValue?: unknown;
    })
  | (SessionEntryMetadata & {
      type: "compaction";
      summary: unknown;
      checkpointV2?: CompactionCheckpointV2;
      compactionPlanId?: string;
      tokensBefore?: number;
      trigger?: ContextCompactionTrigger;
      inputTokensBefore?: number;
      inputTokensAfter?: number;
      inputBudgetTokens?: number;
      targetInputTokens?: number;
      targetSummaryTokens?: number;
      compactedThroughRecordId?: string;
      compactedThroughMessageId?: string;
      compactedMessageIds?: string[];
      retainedTailMessageIds?: string[];
      compactedRecordIds?: string[];
      retainedTailRecordIds?: string[];
    })
  | (SessionEntryMetadata & {
      type: "branch_summary";
      summary: unknown;
      transfer?: SessionBranchSummaryTransferMetadata;
    })
  | (SessionEntryMetadata & {
      type: "custom";
      customType: string;
      data: unknown;
    });

export type SessionTreeState<TMessage = unknown> = {
  version: typeof SESSION_TREE_VERSION;
  rootEntryId: string;
  activeEntryId: string;
  entries: SessionEntry<TMessage>[];
};

export type SessionRuntimeState = {
  model?: string;
  provider?: string;
  mode?: string;
  config: Record<string, unknown>;
};

type LegacySessionTreeNode<TMessage = unknown> = {
  id: string;
  parentId: string | null;
  createdAt: number;
  messages: TMessage[];
  runId?: string;
  inputMessageId?: string;
};

type LegacySessionTreeState<TMessage = unknown> = {
  version: 1;
  rootNodeId: string;
  activeNodeId: string;
  nodes: LegacySessionTreeNode<TMessage>[];
};

type V2SessionHistoryEvent<TMessage = unknown> = {
  id: string;
  nodeId: string;
  kind: "message-upsert";
  messageId: string;
  createdAt: number;
  message: TMessage;
};

type V2SessionTreeNode = {
  id: string;
  parentId: string | null;
  createdAt: number;
  eventIds: string[];
  runId?: string;
  inputMessageId?: string;
};

type V2SessionTreeState<TMessage = unknown> = {
  version: 2;
  rootNodeId: string;
  activeNodeId: string;
  nodes: V2SessionTreeNode[];
  events: V2SessionHistoryEvent<TMessage>[];
};

export type SessionTreeOptions<TMessage = unknown> = {
  createId?: () => string;
  now?: () => number;
  getMessageId?: (message: TMessage, index: number) => string;
  getMessageRole?: (message: TMessage) => "user" | "assistant" | "custom";
  messagesEqual?: (left: TMessage, right: TMessage) => boolean;
};

function defaultCreateId() {
  return crypto.randomUUID();
}

function defaultGetMessageId<TMessage>(message: TMessage, index: number) {
  if (message && typeof message === "object" && "id" in message) {
    const id = (message as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return `index:${index}`;
}

function defaultGetMessageRole<TMessage>(message: TMessage): "user" | "assistant" | "custom" {
  if (message && typeof message === "object" && "role" in message) {
    const role = (message as { role?: unknown }).role;
    if (role === "user" || role === "assistant") return role;
  }
  return "custom";
}

function defaultMessagesEqual<TMessage>(left: TMessage, right: TMessage) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue<TValue>(value: TValue): TValue {
  return structuredClone(value) as TValue;
}

function cloneEntry<TMessage>(entry: SessionEntry<TMessage>): SessionEntry<TMessage> {
  return cloneValue(entry);
}

function cloneState<TMessage>(state: SessionTreeState<TMessage>): SessionTreeState<TMessage> {
  return {
    ...state,
    entries: state.entries.map(cloneEntry),
  };
}

function entryTypeForMessageRole(role: "user" | "assistant" | "custom") {
  if (role === "user") return "user_message" as const;
  if (role === "assistant") return "assistant_message" as const;
  return "custom_message" as const;
}

export function getSessionEntry<TMessage>(state: SessionTreeState<TMessage>, entryId: string) {
  return state.entries.find((entry) => entry.id === entryId) ?? null;
}

export function getActiveSessionEntry<TMessage>(state: SessionTreeState<TMessage>) {
  const entry = getSessionEntry(state, state.activeEntryId);
  if (!entry) throw new Error(`Active session entry ${state.activeEntryId} does not exist`);
  return entry;
}

export function getParentSessionEntry<TMessage>(state: SessionTreeState<TMessage>) {
  const active = getActiveSessionEntry(state);
  return active.parentId ? getSessionEntry(state, active.parentId) : null;
}

export function projectSessionEntryPath<TMessage>(
  state: SessionTreeState<TMessage>,
  entryId = state.activeEntryId,
) {
  const entryById = new Map(state.entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry<TMessage>[] = [];
  const seen = new Set<string>();
  let current = entryById.get(entryId);

  while (current) {
    if (seen.has(current.id)) throw new Error(`Session tree contains a cycle at ${current.id}`);
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? entryById.get(current.parentId) : undefined;
  }

  if (path.at(-1)?.id !== state.rootEntryId) {
    throw new Error(`Session entry ${entryId} is not connected to root ${state.rootEntryId}`);
  }

  return path.reverse().map(cloneEntry);
}

export function projectSessionTreeMessages<TMessage>(
  state: SessionTreeState<TMessage>,
  entryId = state.activeEntryId,
): TMessage[] {
  const order: string[] = [];
  const messages = new Map<string, TMessage>();

  for (const entry of projectSessionEntryPath(state, entryId)) {
    if (
      entry.type === "user_message"
      || entry.type === "assistant_message"
      || entry.type === "custom_message"
    ) {
      if (!messages.has(entry.messageId)) order.push(entry.messageId);
      messages.set(entry.messageId, cloneValue(entry.message));
      continue;
    }

    if (entry.type === "message_update") {
      if (!messages.has(entry.messageId)) {
        throw new Error(`Session message update ${entry.id} references unknown message ${entry.messageId}`);
      }
      messages.set(entry.messageId, cloneValue(entry.message));
    }
  }

  return order.map((messageId) => messages.get(messageId)!);
}

export function projectLatestSessionCompaction<TMessage>(
  state: SessionTreeState<TMessage>,
  entryId = state.activeEntryId,
): SessionCompactionEntry | null {
  const path = projectSessionEntryPath(state, entryId);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index]!;
    if (entry.type === "compaction") return cloneEntry(entry) as SessionCompactionEntry;
  }
  return null;
}

export function projectSessionRuntimeState<TMessage>(
  state: SessionTreeState<TMessage>,
  entryId = state.activeEntryId,
): SessionRuntimeState {
  const runtime: SessionRuntimeState = { config: {} };

  for (const entry of projectSessionEntryPath(state, entryId)) {
    if (entry.type === "model_change") {
      runtime.model = entry.model;
      runtime.provider = entry.provider;
    } else if (entry.type === "mode_change") {
      runtime.mode = entry.mode;
    } else if (entry.type === "config_change") {
      runtime.config[entry.key] = cloneValue(entry.value);
    }
  }

  return runtime;
}

export function appendSessionEntry<TMessage>(
  state: SessionTreeState<TMessage>,
  input: SessionEntryInput<TMessage>,
  options: SessionTreeOptions<TMessage> = {},
): SessionTreeState<TMessage> {
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? Date.now;
  const parent = getActiveSessionEntry(state);
  const entry = {
    ...cloneValue(input),
    id: createId(),
    parentId: parent.id,
    createdAt: now(),
  } as SessionEntry<TMessage>;
  const cloned = cloneState(state);

  return {
    ...cloned,
    activeEntryId: entry.id,
    entries: [...cloned.entries, entry],
  };
}

export function appendSessionEntries<TMessage>(
  state: SessionTreeState<TMessage>,
  inputs: readonly SessionEntryInput<TMessage>[],
  options: SessionTreeOptions<TMessage> = {},
) {
  return inputs.reduce(
    (current, input) => appendSessionEntry(current, input, options),
    state,
  );
}

export function appendSessionTreeMessages<TMessage>(
  state: SessionTreeState<TMessage>,
  messages: readonly TMessage[],
  metadata: SessionEntryMetadata = {},
  options: SessionTreeOptions<TMessage> = {},
): SessionTreeState<TMessage> {
  const getMessageId = options.getMessageId ?? defaultGetMessageId<TMessage>;
  const getMessageRole = options.getMessageRole ?? defaultGetMessageRole<TMessage>;
  const messagesEqual = options.messagesEqual ?? defaultMessagesEqual<TMessage>;
  const previousMessages = projectSessionTreeMessages(state);
  const previousById = new Map<string, TMessage>();

  previousMessages.forEach((message, index) => {
    previousById.set(getMessageId(message, index), message);
  });

  let nextState = state;
  messages.forEach((message, index) => {
    const messageId = getMessageId(message, index);
    const previous = previousById.get(messageId);

    if (previous === undefined) {
      nextState = appendSessionEntry(nextState, {
        type: entryTypeForMessageRole(getMessageRole(message)),
        messageId,
        message: cloneValue(message),
        ...metadata,
      }, options);
      previousById.set(messageId, message);
      return;
    }

    if (!messagesEqual(previous, message)) {
      nextState = appendSessionEntry(nextState, {
        type: "message_update",
        messageId,
        message: cloneValue(message),
        ...metadata,
      }, options);
      previousById.set(messageId, message);
    }
  });

  return nextState;
}

export function createSessionTree<TMessage>(
  initialMessages: readonly TMessage[] = [],
  options: SessionTreeOptions<TMessage> = {},
): SessionTreeState<TMessage> {
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? Date.now;
  const rootEntryId = createId();
  const root: SessionStartEntry = {
    id: rootEntryId,
    parentId: null,
    createdAt: now(),
    type: "session_start",
  };
  const state: SessionTreeState<TMessage> = {
    version: SESSION_TREE_VERSION,
    rootEntryId,
    activeEntryId: rootEntryId,
    entries: [root],
  };

  return appendSessionTreeMessages(state, initialMessages, {}, options);
}

export function jumpToSessionEntry<TMessage>(
  state: SessionTreeState<TMessage>,
  entryId: string,
): SessionTreeState<TMessage> {
  if (!getSessionEntry(state, entryId)) throw new Error(`Session entry ${entryId} does not exist`);
  return { ...cloneState(state), activeEntryId: entryId };
}

export function jumpToSessionRoot<TMessage>(state: SessionTreeState<TMessage>) {
  return jumpToSessionEntry(state, state.rootEntryId);
}

function validateSessionTreeState<TMessage>(state: SessionTreeState<TMessage>) {
  const entryById = new Map<string, SessionEntry<TMessage>>();

  for (const entry of state.entries) {
    if (entryById.has(entry.id)) throw new Error(`Duplicate session entry ${entry.id}`);
    entryById.set(entry.id, entry);
  }

  const root = entryById.get(state.rootEntryId);
  if (!root) throw new Error(`Root session entry ${state.rootEntryId} does not exist`);
  if (root.type !== "session_start") throw new Error("Root session entry must be session_start");
  if (root.parentId !== null) throw new Error("Root session entry must not have a parent");
  if (!entryById.has(state.activeEntryId)) {
    throw new Error(`Active session entry ${state.activeEntryId} does not exist`);
  }

  for (const entry of state.entries) {
    if (entry.id !== state.rootEntryId && entry.parentId === null) {
      throw new Error(`Session entry ${entry.id} must have a parent`);
    }
    if (entry.parentId !== null && !entryById.has(entry.parentId)) {
      throw new Error(`Parent session entry ${entry.parentId} does not exist`);
    }
    projectSessionEntryPath(state, entry.id);
  }

  projectSessionTreeMessages(state);
}

function isSessionEntry(value: unknown): value is SessionEntry<unknown> {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SessionEntry<unknown>> & Record<string, unknown>;
  if (
    typeof entry.id !== "string"
    || (entry.parentId !== null && typeof entry.parentId !== "string")
    || typeof entry.createdAt !== "number"
    || typeof entry.type !== "string"
  ) return false;

  switch (entry.type) {
    case "session_start":
      return true;
    case "user_message":
    case "assistant_message":
    case "custom_message":
    case "message_update":
      return typeof entry.messageId === "string" && "message" in entry;
    case "tool_call":
      return typeof entry.toolCallId === "string"
        && typeof entry.toolName === "string"
        && "input" in entry;
    case "tool_result":
      return typeof entry.toolCallId === "string"
        && (entry.toolName === undefined || typeof entry.toolName === "string")
        && (entry.error === undefined || typeof entry.error === "string")
        && (entry.status === undefined || [
          "completed",
          "failed",
          "cancelled",
          "timed_out",
          "denied",
          "approval_required",
        ].includes(entry.status as string))
        && (entry.source === undefined || typeof entry.source === "string")
        && (entry.startedAt === undefined || typeof entry.startedAt === "number")
        && (entry.completedAt === undefined || typeof entry.completedAt === "number")
        && (entry.durationMs === undefined || typeof entry.durationMs === "number");
    case "error":
      return typeof entry.message === "string"
        && (entry.code === undefined || typeof entry.code === "string");
    case "model_change":
      return typeof entry.model === "string"
        && (entry.provider === undefined || typeof entry.provider === "string");
    case "mode_change":
      return typeof entry.mode === "string";
    case "config_change":
      return typeof entry.key === "string" && "value" in entry;
    case "compaction":
      return "summary" in entry;
    case "branch_summary":
      return "summary" in entry
        && (entry.transfer === undefined || isBranchSummaryTransferMetadata(entry.transfer));
    case "custom":
      return typeof entry.customType === "string" && "data" in entry;
    default:
      return false;
  }
}

function isBranchSummaryTransferMetadata(value: unknown): value is SessionBranchSummaryTransferMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionBranchSummaryTransferMetadata>;
  return typeof candidate.sourceTipEntryId === "string"
    && typeof candidate.targetEntryId === "string"
    && typeof candidate.commonAncestorEntryId === "string"
    && Array.isArray(candidate.coveredEntryIds)
    && candidate.coveredEntryIds.every((id) => typeof id === "string")
    && (candidate.previousTransferEntryIds === undefined
      || (Array.isArray(candidate.previousTransferEntryIds)
        && candidate.previousTransferEntryIds.every((id) => typeof id === "string")));
}

export function isSessionTreeState(value: unknown): value is SessionTreeState<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionTreeState<unknown>>;
  return candidate.version === SESSION_TREE_VERSION
    && typeof candidate.rootEntryId === "string"
    && typeof candidate.activeEntryId === "string"
    && Array.isArray(candidate.entries)
    && candidate.entries.every(isSessionEntry);
}

function isLegacySessionTreeState(value: unknown): value is LegacySessionTreeState<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacySessionTreeState<unknown>>;
  return candidate.version === 1
    && typeof candidate.rootNodeId === "string"
    && typeof candidate.activeNodeId === "string"
    && Array.isArray(candidate.nodes)
    && candidate.nodes.every((node) => {
      if (!node || typeof node !== "object") return false;
      const candidateNode = node as Partial<LegacySessionTreeNode<unknown>>;
      return typeof candidateNode.id === "string"
        && (candidateNode.parentId === null || typeof candidateNode.parentId === "string")
        && typeof candidateNode.createdAt === "number"
        && Array.isArray(candidateNode.messages);
    });
}

function isV2SessionTreeState(value: unknown): value is V2SessionTreeState<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<V2SessionTreeState<unknown>>;
  return candidate.version === 2
    && typeof candidate.rootNodeId === "string"
    && typeof candidate.activeNodeId === "string"
    && Array.isArray(candidate.nodes)
    && Array.isArray(candidate.events)
    && candidate.nodes.every((node) => {
      if (!node || typeof node !== "object") return false;
      const candidateNode = node as Partial<V2SessionTreeNode>;
      return typeof candidateNode.id === "string"
        && (candidateNode.parentId === null || typeof candidateNode.parentId === "string")
        && typeof candidateNode.createdAt === "number"
        && Array.isArray(candidateNode.eventIds);
    })
    && candidate.events.every((event) => {
      if (!event || typeof event !== "object") return false;
      const candidateEvent = event as Partial<V2SessionHistoryEvent<unknown>>;
      return typeof candidateEvent.id === "string"
        && typeof candidateEvent.nodeId === "string"
        && candidateEvent.kind === "message-upsert"
        && typeof candidateEvent.messageId === "string"
        && typeof candidateEvent.createdAt === "number"
        && "message" in candidateEvent;
    });
}

function projectV2Messages<TMessage>(state: V2SessionTreeState<TMessage>, nodeId: string) {
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  const eventById = new Map(state.events.map((event) => [event.id, event]));
  const path: V2SessionTreeNode[] = [];
  const seen = new Set<string>();
  let current = nodeById.get(nodeId);

  while (current) {
    if (seen.has(current.id)) throw new Error(`V2 session tree contains a cycle at ${current.id}`);
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  if (path.at(-1)?.id !== state.rootNodeId) {
    throw new Error(`V2 session node ${nodeId} is not connected to root ${state.rootNodeId}`);
  }

  const order: string[] = [];
  const messages = new Map<string, TMessage>();
  for (const node of path.reverse()) {
    for (const eventId of node.eventIds) {
      const event = eventById.get(eventId);
      if (!event) throw new Error(`V2 session event ${eventId} does not exist`);
      if (event.nodeId !== node.id) throw new Error(`V2 session event ${eventId} has wrong node owner`);
      if (!messages.has(event.messageId)) order.push(event.messageId);
      messages.set(event.messageId, cloneValue(event.message));
    }
  }
  return order.map((messageId) => messages.get(messageId)!);
}

function upgradeTreeSnapshots<TMessage>(
  rootNodeId: string,
  activeNodeId: string,
  nodes: readonly {
    id: string;
    parentId: string | null;
    runId?: string;
    inputMessageId?: string;
  }[],
  projectMessages: (nodeId: string) => TMessage[],
  options: SessionTreeOptions<TMessage>,
) {
  const children = new Map<string | null, typeof nodes[number][]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const root = nodes.find((node) => node.id === rootNodeId);
  if (!root) throw new Error(`Legacy root session tree node ${rootNodeId} does not exist`);

  let nextState = createSessionTree<TMessage>([], options);
  const mappedActiveEntry = new Map<string, string>();

  const visit = (node: typeof nodes[number], parentEntryId: string) => {
    nextState = jumpToSessionEntry(nextState, parentEntryId);
    nextState = appendSessionTreeMessages(
      nextState,
      projectMessages(node.id),
      {
        ...(node.runId ? { runId: node.runId } : {}),
        ...(node.inputMessageId ? { inputMessageId: node.inputMessageId } : {}),
      },
      options,
    );
    const mappedEntryId = nextState.activeEntryId;
    mappedActiveEntry.set(node.id, mappedEntryId);

    for (const child of children.get(node.id) ?? []) {
      visit(child, mappedEntryId);
    }
  };

  visit(root, nextState.rootEntryId);
  const mappedActive = mappedActiveEntry.get(activeNodeId);
  if (!mappedActive) throw new Error(`Legacy active session tree node ${activeNodeId} does not exist`);
  nextState = jumpToSessionEntry(nextState, mappedActive);
  validateSessionTreeState(nextState);
  return nextState;
}

function upgradeLegacyTree<TMessage>(
  legacy: LegacySessionTreeState<TMessage>,
  options: SessionTreeOptions<TMessage>,
) {
  const nodeById = new Map(legacy.nodes.map((node) => [node.id, node]));
  return upgradeTreeSnapshots(
    legacy.rootNodeId,
    legacy.activeNodeId,
    legacy.nodes,
    (nodeId) => cloneValue(nodeById.get(nodeId)?.messages ?? []),
    options,
  );
}

function upgradeV2Tree<TMessage>(
  legacy: V2SessionTreeState<TMessage>,
  options: SessionTreeOptions<TMessage>,
) {
  return upgradeTreeSnapshots(
    legacy.rootNodeId,
    legacy.activeNodeId,
    legacy.nodes,
    (nodeId) => projectV2Messages(legacy, nodeId),
    options,
  );
}

/** Restores v3 entry trees and upgrades v2/v1/legacy linear snapshots. */
export function restoreSessionTree<TMessage>(
  persisted: unknown,
  options: SessionTreeOptions<TMessage> = {},
): SessionTreeState<TMessage> {
  if (isSessionTreeState(persisted)) {
    const state = cloneState(persisted as SessionTreeState<TMessage>);
    validateSessionTreeState(state);
    return state;
  }
  if (isV2SessionTreeState(persisted)) {
    return upgradeV2Tree(persisted as V2SessionTreeState<TMessage>, options);
  }
  if (isLegacySessionTreeState(persisted)) {
    return upgradeLegacyTree(persisted as LegacySessionTreeState<TMessage>, options);
  }
  if (Array.isArray(persisted)) return createSessionTree(persisted as TMessage[], options);
  return createSessionTree<TMessage>([], options);
}

/** @deprecated Use appendSessionTreeMessages or appendSessionEntry. */
export const appendSessionTreeNode = appendSessionTreeMessages;
/** @deprecated Use getSessionEntry. */
export const getSessionTreeNode = getSessionEntry;
/** @deprecated Use getActiveSessionEntry. */
export const getActiveSessionTreeNode = getActiveSessionEntry;
/** @deprecated Use getParentSessionEntry. */
export const getParentSessionTreeNode = getParentSessionEntry;
/** @deprecated Use jumpToSessionEntry. */
export const jumpToSessionTreeNode = jumpToSessionEntry;
/** @deprecated Session Tree v3 nodes are Session Entries. */
export type SessionTreeNode<TMessage = unknown> = SessionEntry<TMessage>;
/** @deprecated Session Tree v3 no longer uses separate message-upsert events. */
export type SessionHistoryEvent<TMessage = unknown> = SessionMessageEntry<TMessage> | SessionMessageUpdateEntry<TMessage>;
