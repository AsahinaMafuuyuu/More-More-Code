import {
    analyzeBranchSummaryNavigation,
    appendSessionEntry,
    createBranchSummaryTransferMetadata,
    jumpToSessionEntry,
    type BranchSummaryNavigationAnalysis,
    type SessionTreeOptions,
    type SessionTreeState,
} from "@more-more-code/harness";

export type BranchSummaryOnJumpPolicy = "ask" | "always" | "never";
export type BranchNavigationDecision = "carry" | "no-carry" | "cancel";
export type BranchNavigationAction = "jump" | "ask" | "carry";

export type BranchNavigationIntent<TMessage = unknown> = {
    policy: BranchSummaryOnJumpPolicy;
    action: BranchNavigationAction;
    analysis: BranchSummaryNavigationAnalysis<TMessage>;
};

export type BranchSummaryReduction = {
    summary: string | null;
};

export type BranchNavigationExecutionResult<
    TMessage = unknown,
    TReduction extends BranchSummaryReduction = BranchSummaryReduction,
> =
    | {
        status: "decision-required" | "cancelled";
        intent: BranchNavigationIntent<TMessage>;
        state: SessionTreeState<TMessage>;
    }
    | {
        status: "jumped";
        intent: BranchNavigationIntent<TMessage>;
        state: SessionTreeState<TMessage>;
    }
    | {
        status: "carried" | "carry-failed";
        intent: BranchNavigationIntent<TMessage>;
        state: SessionTreeState<TMessage>;
        reduction: TReduction;
    };

export function resolveBranchNavigationIntent<TMessage>(input: {
    state: SessionTreeState<TMessage>;
    targetEntryId: string;
    policy: BranchSummaryOnJumpPolicy;
}): BranchNavigationIntent<TMessage> {
    const analysis = analyzeBranchSummaryNavigation(input.state, input.targetEntryId);
    const action: BranchNavigationAction = !analysis.requiresKnowledgeTransfer
        ? "jump"
        : input.policy === "always"
            ? "carry"
            : input.policy === "never"
                ? "jump"
                : "ask";
    return {
        policy: input.policy,
        action,
        analysis,
    };
}

/**
 * Unified lazy navigation/transfer controller. It is intentionally UI-free so
 * `/tree`, `/jump`, `/parent`, and `/root` can share identical semantics.
 */
export async function executeBranchNavigation<
    TMessage,
    TReduction extends BranchSummaryReduction,
>(input: {
    state: SessionTreeState<TMessage>;
    targetEntryId: string;
    policy: BranchSummaryOnJumpPolicy;
    decision?: BranchNavigationDecision;
    summarize: (analysis: BranchSummaryNavigationAnalysis<TMessage>) => Promise<TReduction>;
    onTargetState?: (state: SessionTreeState<TMessage>) => void | Promise<void>;
    treeOptions?: SessionTreeOptions<TMessage>;
}): Promise<BranchNavigationExecutionResult<TMessage, TReduction>> {
    const intent = resolveBranchNavigationIntent({
        state: input.state,
        targetEntryId: input.targetEntryId,
        policy: input.policy,
    });

    if (input.decision === "cancel") {
        return { status: "cancelled", intent, state: input.state };
    }

    const canCarry = intent.analysis.requiresKnowledgeTransfer;
    const shouldCarry = canCarry && (
        input.decision === "carry"
        || (input.decision === undefined && intent.action === "carry")
    );
    const shouldJump = !canCarry
        || input.decision === "no-carry"
        || intent.action === "jump";

    if (!shouldCarry && !shouldJump) {
        return { status: "decision-required", intent, state: input.state };
    }

    const targetState = jumpToSessionEntry(input.state, input.targetEntryId);
    await input.onTargetState?.(targetState);
    if (!shouldCarry) {
        return { status: "jumped", intent, state: targetState };
    }

    const reduction = await input.summarize(intent.analysis);
    if (!reduction.summary?.trim()) {
        return {
            status: "carry-failed",
            intent,
            state: targetState,
            reduction,
        };
    }

    const carriedState = appendSessionEntry(targetState, {
        type: "branch_summary",
        summary: reduction.summary,
        transfer: createBranchSummaryTransferMetadata(intent.analysis),
    }, input.treeOptions);
    return {
        status: "carried",
        intent,
        state: carriedState,
        reduction,
    };
}
