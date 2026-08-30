import { describe, expect, test } from "bun:test";
import {
  analyzeBranchSummaryNavigation,
  appendSessionEntry,
  createBranchSummaryTransferMetadata,
  createSessionTree,
  jumpToSessionEntry,
  resolveBranchSummaryTokenBudget,
} from "../src";

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

function deterministicOptions() {
  let id = 0;
  return {
    createId: () => `id-${++id}`,
    now: () => id,
  };
}

function appendMessage(
  state: ReturnType<typeof createSessionTree<TestMessage>>,
  options: ReturnType<typeof deterministicOptions>,
  id: string,
  role: TestMessage["role"] = "user",
) {
  return appendSessionEntry(state, {
    type: role === "user" ? "user_message" : "assistant_message",
    messageId: id,
    message: { id, role, text: id },
  }, options);
}

describe("Branch Summary navigation analysis", () => {
  test("treats descendant navigation as lossless", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    const root = state.activeEntryId;
    state = appendMessage(state, options, "u1");
    const ancestor = state.activeEntryId;
    state = appendMessage(state, options, "a1", "assistant");
    const descendant = state.activeEntryId;

    state = jumpToSessionEntry(state, ancestor);
    const analysis = analyzeBranchSummaryNavigation(state, descendant);

    expect(analysis.commonAncestorEntryId).toBe(ancestor);
    expect(analysis.targetContainsSourcePath).toBe(true);
    expect(analysis.sourceOnlyEntries).toEqual([]);
    expect(analysis.requiresKnowledgeTransfer).toBe(false);
    expect(root).not.toBe(ancestor);
  });

  test("returns only source-only semantic entries after the LCA", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    state = appendMessage(state, options, "u0");
    const lca = state.activeEntryId;

    state = appendMessage(state, options, "u-left");
    const leftUser = state.activeEntryId;
    state = appendSessionEntry(state, { type: "model_change", model: "left-model" }, options);
    state = appendSessionEntry(state, {
      type: "tool_result",
      toolCallId: "call-left",
      toolName: "bash",
      output: "left-result",
    }, options);
    const leftTip = state.activeEntryId;

    state = jumpToSessionEntry(state, lca);
    state = appendMessage(state, options, "u-right");
    const rightTip = state.activeEntryId;

    state = jumpToSessionEntry(state, leftTip);
    const analysis = analyzeBranchSummaryNavigation(state, rightTip);

    expect(analysis.commonAncestorEntryId).toBe(lca);
    expect(analysis.sourceOnlyEntries.map((entry) => entry.id)).toEqual([
      leftUser,
      state.entries.find((entry) => entry.type === "model_change" && entry.model === "left-model")!.id,
      leftTip,
    ]);
    expect(analysis.semanticEntries.map((entry) => entry.id)).toEqual([leftUser, leftTip]);
    expect(analysis.coveredEntryIds).toEqual([leftUser, leftTip]);
    expect(analysis.requiresKnowledgeTransfer).toBe(true);
  });

  test("state-only ancestor navigation does not request transfer", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    const root = state.activeEntryId;
    state = appendSessionEntry(state, { type: "model_change", model: "model-a" }, options);
    state = appendSessionEntry(state, { type: "mode_change", mode: "PLAN" }, options);

    const analysis = analyzeBranchSummaryNavigation(state, root);
    expect(analysis.sourceOnlyEntries).toHaveLength(2);
    expect(analysis.semanticEntries).toHaveLength(0);
    expect(analysis.requiresKnowledgeTransfer).toBe(false);
  });

  test("deduplicates entry coverage from a prior relevant transfer", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    const root = state.activeEntryId;
    state = appendMessage(state, options, "u-left-1");
    const firstKnowledge = state.activeEntryId;
    const firstSourceTip = state.activeEntryId;

    state = jumpToSessionEntry(state, root);
    state = appendSessionEntry(state, {
      type: "branch_summary",
      summary: "carried first knowledge",
      transfer: {
        sourceTipEntryId: firstSourceTip,
        targetEntryId: root,
        commonAncestorEntryId: root,
        coveredEntryIds: [firstKnowledge],
      },
    }, options);
    const priorTransfer = state.activeEntryId;

    state = jumpToSessionEntry(state, firstSourceTip);
    state = appendMessage(state, options, "u-left-2");
    const secondKnowledge = state.activeEntryId;

    const analysis = analyzeBranchSummaryNavigation(state, priorTransfer);
    expect(analysis.previouslyCoveredEntryIds).toContain(firstKnowledge);
    expect(analysis.semanticEntries.map((entry) => entry.id)).toEqual([secondKnowledge]);
    expect(analysis.previousTransferEntryIds).toHaveLength(1);
  });

  test("does not deduplicate coverage from a transfer that is not on the requested target path", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    const root = state.activeEntryId;
    state = appendMessage(state, options, "u-left");
    const sourceTip = state.activeEntryId;

    state = jumpToSessionEntry(state, root);
    state = appendSessionEntry(state, {
      type: "branch_summary",
      summary: "carried knowledge",
      transfer: {
        sourceTipEntryId: sourceTip,
        targetEntryId: root,
        commonAncestorEntryId: root,
        coveredEntryIds: [sourceTip],
      },
    }, options);

    state = jumpToSessionEntry(state, sourceTip);
    const analysis = analyzeBranchSummaryNavigation(state, root);
    expect(analysis.previouslyCoveredEntryIds).toEqual([]);
    expect(analysis.semanticEntries.map((entry) => entry.id)).toEqual([sourceTip]);
    expect(analysis.requiresKnowledgeTransfer).toBe(true);
  });

  test("keeps prior branch summaries transferable on unrelated hops", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    const root = state.activeEntryId;
    state = appendMessage(state, options, "u-left");
    const leftTip = state.activeEntryId;

    state = jumpToSessionEntry(state, root);
    state = appendSessionEntry(state, {
      type: "branch_summary",
      summary: "knowledge from elsewhere",
      transfer: {
        sourceTipEntryId: leftTip,
        targetEntryId: root,
        commonAncestorEntryId: root,
        coveredEntryIds: [leftTip],
      },
    }, options);
    const summaryTip = state.activeEntryId;

    state = jumpToSessionEntry(state, root);
    state = appendMessage(state, options, "u-right");
    const rightTip = state.activeEntryId;

    state = jumpToSessionEntry(state, summaryTip);
    const analysis = analyzeBranchSummaryNavigation(state, rightTip);
    expect(analysis.semanticEntries.map((entry) => entry.id)).toContain(summaryTip);
  });

  test("creates exact structured transfer metadata and bounded token budget", () => {
    const options = deterministicOptions();
    let state = createSessionTree<TestMessage>([], options);
    const root = state.activeEntryId;
    state = appendMessage(state, options, "u1");
    const tip = state.activeEntryId;
    const analysis = analyzeBranchSummaryNavigation(state, root);
    const metadata = createBranchSummaryTransferMetadata(analysis);

    expect(metadata).toEqual({
      sourceTipEntryId: tip,
      targetEntryId: root,
      commonAncestorEntryId: root,
      coveredEntryIds: [tip],
    });
    expect(resolveBranchSummaryTokenBudget(100_000)).toBe(4_000);
    expect(resolveBranchSummaryTokenBudget(500_000)).toBe(4_096);
  });
});
