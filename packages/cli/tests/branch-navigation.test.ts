import { describe, expect, test } from "bun:test";
import {
    appendSessionEntry,
    createSessionTree,
    getActiveSessionEntry,
} from "@more-more-code/harness";
import {
    executeBranchNavigation,
    resolveBranchNavigationIntent,
} from "../src/lib/branch-navigation";

function options() {
    let id = 0;
    return { createId: () => `id-${++id}`, now: () => id };
}

describe("branch navigation policy", () => {
    test("asks only when semantic source knowledge would be lost", () => {
        const treeOptions = options();
        let state = createSessionTree<{
            id: string;
            role: "user";
            parts: Array<{ type: "text"; text: string }>;
        }>([], treeOptions);
        const root = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: { id: "u1", role: "user", parts: [{ type: "text", text: "keep this" }] },
        }, treeOptions);

        const ask = resolveBranchNavigationIntent({ state, targetEntryId: root, policy: "ask" });
        expect(ask.action).toBe("ask");

        const always = resolveBranchNavigationIntent({ state, targetEntryId: root, policy: "always" });
        expect(always.action).toBe("carry");

        const never = resolveBranchNavigationIntent({ state, targetEntryId: root, policy: "never" });
        expect(never.action).toBe("jump");
    });

    test("state-only navigation never asks", () => {
        const treeOptions = options();
        let state = createSessionTree([], treeOptions);
        const root = state.activeEntryId;
        state = appendSessionEntry(state, { type: "model_change", model: "m1" }, treeOptions);

        expect(resolveBranchNavigationIntent({
            state,
            targetEntryId: root,
            policy: "ask",
        }).action).toBe("jump");
    });

    test("Cancel keeps source active and creates no durable entry", async () => {
        const treeOptions = options();
        let state = createSessionTree<any>([], treeOptions);
        const root = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: { id: "u1", role: "user", parts: [{ type: "text", text: "source knowledge" }] },
        }, treeOptions);
        const sourceTip = state.activeEntryId;
        const beforeCount = state.entries.length;

        const result = await executeBranchNavigation({
            state,
            targetEntryId: root,
            policy: "ask",
            decision: "cancel",
            summarize: async () => ({ summary: "unused" }),
            treeOptions,
        });

        expect(result.status).toBe("cancelled");
        expect(result.state.activeEntryId).toBe(sourceTip);
        expect(result.state.entries).toHaveLength(beforeCount);
    });

    test("No Carry jumps without creating a branch entry", async () => {
        const treeOptions = options();
        let state = createSessionTree<any>([], treeOptions);
        const root = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: { id: "u1", role: "user", parts: [{ type: "text", text: "source knowledge" }] },
        }, treeOptions);
        const beforeCount = state.entries.length;

        const result = await executeBranchNavigation({
            state,
            targetEntryId: root,
            policy: "ask",
            decision: "no-carry",
            summarize: async () => ({ summary: "unused" }),
            treeOptions,
        });

        expect(result.status).toBe("jumped");
        expect(result.state.activeEntryId).toBe(root);
        expect(result.state.entries).toHaveLength(beforeCount);
    });

    test("Carry jumps first and appends exactly one provenance-bearing Branch Summary", async () => {
        const treeOptions = options();
        let state = createSessionTree<any>([], treeOptions);
        const root = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: { id: "u1", role: "user", parts: [{ type: "text", text: "source knowledge" }] },
        }, treeOptions);
        const sourceTip = state.activeEntryId;
        const beforeCount = state.entries.length;
        let observedTarget = "";

        const result = await executeBranchNavigation({
            state,
            targetEntryId: root,
            policy: "ask",
            decision: "carry",
            onTargetState(targetState) {
                observedTarget = targetState.activeEntryId;
            },
            summarize: async () => ({ summary: "Transferred knowledge" }),
            treeOptions,
        });

        expect(observedTarget).toBe(root);
        expect(result.status).toBe("carried");
        expect(result.state.entries).toHaveLength(beforeCount + 1);
        expect(getActiveSessionEntry(result.state)).toMatchObject({
            type: "branch_summary",
            summary: "Transferred knowledge",
            parentId: root,
            transfer: {
                sourceTipEntryId: sourceTip,
                targetEntryId: root,
                commonAncestorEntryId: root,
            },
        });
    });

    test("failed Carry leaves target active and appends nothing", async () => {
        const treeOptions = options();
        let state = createSessionTree<any>([], treeOptions);
        const root = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: { id: "u1", role: "user", parts: [{ type: "text", text: "source knowledge" }] },
        }, treeOptions);
        const beforeCount = state.entries.length;

        const result = await executeBranchNavigation({
            state,
            targetEntryId: root,
            policy: "always",
            summarize: async () => ({ summary: null }),
            treeOptions,
        });

        expect(result.status).toBe("carry-failed");
        expect(result.state.activeEntryId).toBe(root);
        expect(result.state.entries).toHaveLength(beforeCount);
    });
});
