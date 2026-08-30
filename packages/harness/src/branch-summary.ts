import {
  getSessionEntry,
  projectSessionEntryPath,
  type SessionBranchSummaryEntry,
  type SessionBranchSummaryTransferMetadata,
  type SessionCustomEntry,
  type SessionEntry,
  type SessionTreeState,
} from "./session-tree";

export type BranchSummaryNavigationAnalysis<TMessage = unknown> = {
  sourceTipEntryId: string;
  targetEntryId: string;
  commonAncestorEntryId: string;
  targetContainsSourcePath: boolean;
  sourceOnlyEntries: SessionEntry<TMessage>[];
  semanticEntries: SessionEntry<TMessage>[];
  coveredEntryIds: string[];
  previouslyCoveredEntryIds: string[];
  previousTransferEntryIds: string[];
  requiresKnowledgeTransfer: boolean;
};

export type BranchSummaryAnalysisOptions<TMessage = unknown> = {
  isSemanticCustomEntry?: (entry: SessionCustomEntry) => boolean;
};

export type BranchSummaryReducerInput<TMessage = unknown> = {
  entries: readonly SessionEntry<TMessage>[];
  targetTokens: number;
  transfer: SessionBranchSummaryTransferMetadata;
};

export type BranchSummaryReducer<TMessage = unknown> = {
  reduce(input: BranchSummaryReducerInput<TMessage>): Promise<string | null> | string | null;
};

export function resolveBranchSummaryTokenBudget(effectiveInputBudgetTokens: number) {
  if (!Number.isFinite(effectiveInputBudgetTokens) || effectiveInputBudgetTokens <= 0) return 0;
  return Math.min(4096, Math.floor(effectiveInputBudgetTokens * 0.04));
}

function isSemanticEntry<TMessage>(
  entry: SessionEntry<TMessage>,
  options: BranchSummaryAnalysisOptions<TMessage>,
) {
  switch (entry.type) {
    case "user_message":
    case "assistant_message":
    case "custom_message":
    case "message_update":
    case "tool_call":
    case "tool_result":
    case "error":
    case "compaction":
    case "branch_summary":
      return true;
    case "custom":
      return options.isSemanticCustomEntry?.(entry) ?? false;
    case "session_start":
    case "model_change":
    case "mode_change":
    case "config_change":
      return false;
  }
}

function hasTransferMetadata<TMessage>(
  entry: SessionEntry<TMessage>,
): entry is SessionBranchSummaryEntry & { transfer: SessionBranchSummaryTransferMetadata } {
  return entry.type === "branch_summary" && entry.transfer !== undefined;
}

function findRelevantPreviousTransfers<TMessage>(input: {
  state: SessionTreeState<TMessage>;
  sourcePathIds: ReadonlySet<string>;
  targetPathIds: ReadonlySet<string>;
}) {
  return input.state.entries.filter((entry): entry is SessionBranchSummaryEntry & {
    transfer: SessionBranchSummaryTransferMetadata;
  } => {
    if (!hasTransferMetadata(entry)) return false;
    return input.targetPathIds.has(entry.id)
      && input.sourcePathIds.has(entry.transfer.sourceTipEntryId)
      && input.targetPathIds.has(entry.transfer.targetEntryId);
  });
}

/**
 * Purely compares the current active path with a requested target path.
 * It never changes activeEntryId and never appends Session Entries.
 */
export function analyzeBranchSummaryNavigation<TMessage>(
  state: SessionTreeState<TMessage>,
  targetEntryId: string,
  options: BranchSummaryAnalysisOptions<TMessage> = {},
): BranchSummaryNavigationAnalysis<TMessage> {
  if (!getSessionEntry(state, targetEntryId)) {
    throw new Error(`Session entry ${targetEntryId} does not exist`);
  }

  const sourcePath = projectSessionEntryPath(state, state.activeEntryId);
  const targetPath = projectSessionEntryPath(state, targetEntryId);
  const limit = Math.min(sourcePath.length, targetPath.length);
  let commonIndex = -1;
  for (let index = 0; index < limit; index += 1) {
    if (sourcePath[index]!.id !== targetPath[index]!.id) break;
    commonIndex = index;
  }
  if (commonIndex < 0) {
    throw new Error("Session source and target paths do not share the same root");
  }

  const commonAncestor = sourcePath[commonIndex]!;
  const targetContainsSourcePath = commonIndex === sourcePath.length - 1;
  const sourceOnlyEntries = targetContainsSourcePath
    ? []
    : sourcePath.slice(commonIndex + 1);

  const sourcePathIds = new Set(sourcePath.map((entry) => entry.id));
  const targetPathIds = new Set(targetPath.map((entry) => entry.id));
  const previousTransfers = findRelevantPreviousTransfers({
    state,
    sourcePathIds,
    targetPathIds,
  });
  const previouslyCovered = new Set(
    previousTransfers.flatMap((entry) => entry.transfer.coveredEntryIds),
  );
  const semanticEntries = sourceOnlyEntries.filter((entry) =>
    isSemanticEntry(entry, options) && !previouslyCovered.has(entry.id));

  return {
    sourceTipEntryId: state.activeEntryId,
    targetEntryId,
    commonAncestorEntryId: commonAncestor.id,
    targetContainsSourcePath,
    sourceOnlyEntries,
    semanticEntries,
    coveredEntryIds: semanticEntries.map((entry) => entry.id),
    previouslyCoveredEntryIds: [...previouslyCovered],
    previousTransferEntryIds: previousTransfers.map((entry) => entry.id),
    requiresKnowledgeTransfer: semanticEntries.length > 0,
  };
}

export function createBranchSummaryTransferMetadata<TMessage>(
  analysis: BranchSummaryNavigationAnalysis<TMessage>,
): SessionBranchSummaryTransferMetadata {
  return {
    sourceTipEntryId: analysis.sourceTipEntryId,
    targetEntryId: analysis.targetEntryId,
    commonAncestorEntryId: analysis.commonAncestorEntryId,
    coveredEntryIds: [...analysis.coveredEntryIds],
    ...(analysis.previousTransferEntryIds.length > 0
      ? { previousTransferEntryIds: [...analysis.previousTransferEntryIds] }
      : {}),
  };
}
