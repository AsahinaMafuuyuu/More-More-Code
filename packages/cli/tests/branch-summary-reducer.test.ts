import { describe, expect, test } from "bun:test";
import {
    createHeuristicTokenCounter,
    type BranchSummaryNavigationAnalysis,
    type ModelContextProfile,
    type SessionEntry,
} from "@more-more-code/harness";
import type { Message } from "../src/lib/chat-types";
import {
    BRANCH_SUMMARY_INSTRUCTIONS,
    reduceBranchSummary,
} from "../src/lib/branch-summary-reducer";

const tokenCounter = createHeuristicTokenCounter({
    id: "branch-summary-test",
    latinCharsPerToken: 4,
    cjkCharsPerToken: 1.5,
    structuralOverheadTokens: 1,
});

function profile(): ModelContextProfile {
    return {
        contextWindowTokens: 8_000,
        reservedOutputTokens: 1_000,
        safetyMarginTokens: 200,
        retainedTailTurns: 2,
        maxSummaryTokens: 300,
        toolResultWorkingSetRatio: 0.1,
        toolResultFullThresholdRatio: 0.04,
        toolResultReferenceRatio: 0.004,
        tokenCounter,
    };
}

function analysis(entries: SessionEntry<Message>[]): BranchSummaryNavigationAnalysis<Message> {
    return {
        sourceTipEntryId: entries.at(-1)?.id ?? "source",
        targetEntryId: "target",
        commonAncestorEntryId: "root",
        targetContainsSourcePath: false,
        sourceOnlyEntries: entries,
        semanticEntries: entries,
        coveredEntryIds: entries.map((entry) => entry.id),
        previouslyCoveredEntryIds: [],
        previousTransferEntryIds: [],
        requiresKnowledgeTransfer: entries.length > 0,
    };
}

function userEntry(id: string, text: string): SessionEntry<Message> {
    return {
        id,
        parentId: "root",
        createdAt: 1,
        type: "user_message",
        messageId: id,
        message: { id, role: "user", parts: [{ type: "text", text }] },
    };
}

describe("branch summary reducer", () => {
    test("uses a dedicated bounded semantic reduction format", async () => {
        let capturedInstructions = "";
        let capturedPrompt = "";
        const result = await reduceBranchSummary({
            analysis: analysis([userEntry("u1", "Keep the Session Tree append-only.")]),
            profile: profile(),
            effectiveInputBudgetTokens: 6_000,
            targetTokens: 240,
            reduce: async ({ instructions, prompt, maxOutputTokens }) => {
                capturedInstructions = instructions;
                capturedPrompt = prompt;
                expect(maxOutputTokens).toBe(240);
                return "## Key Findings\nAppend-only tree.\n\n## Decisions\nKeep it.\n\n## Artifacts\nNone\n\n## Failures and Lessons\nNone\n\n## Pending Work\nWire navigation.";
            },
        });

        expect(capturedInstructions).toBe(BRANCH_SUMMARY_INSTRUCTIONS);
        expect(capturedPrompt).toContain("Keep the Session Tree append-only.");
        expect(result.summary).toContain("## Pending Work");
        expect(result.fallbackUsed).toBe(false);
        expect(tokenCounter.countText(result.summary!)).toBeLessThanOrEqual(240);
    });

    test("falls back deterministically when the semantic reducer fails", async () => {
        const result = await reduceBranchSummary({
            analysis: analysis([userEntry("u1", "Preserve this requirement.")]),
            profile: profile(),
            effectiveInputBudgetTokens: 6_000,
            targetTokens: 200,
            reduce: async () => {
                throw new Error("provider unavailable");
            },
        });

        expect(result.fallbackUsed).toBe(true);
        expect(result.fallbackReason).toBe("reducer-error");
        expect(result.summary).toContain("Preserve this requirement.");
        expect(result.summary).toContain("## Key Findings");
    });

    test("prunes oversized Tool Results before semantic branch reduction", async () => {
        const toolCall: SessionEntry<Message> = {
            id: "call-entry",
            parentId: "root",
            createdAt: 1,
            type: "tool_call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { command: "bun test" },
        };
        const toolResult: SessionEntry<Message> = {
            id: "result-entry",
            parentId: "call-entry",
            createdAt: 2,
            type: "tool_result",
            toolCallId: "call-1",
            toolName: "bash",
            status: "failed",
            output: {
                stdout: "repetitive output\n".repeat(5_000),
                stderr: "ERROR important failure\n",
                exitCode: 1,
            },
        };
        let capturedPrompt = "";
        const result = await reduceBranchSummary({
            analysis: analysis([toolCall, toolResult]),
            profile: profile(),
            effectiveInputBudgetTokens: 2_000,
            targetTokens: 180,
            reduce: async ({ prompt }) => {
                capturedPrompt = prompt;
                return "## Key Findings\nTests failed.\n\n## Decisions\nNone\n\n## Artifacts\nNone\n\n## Failures and Lessons\nImportant failure retained.\n\n## Pending Work\nFix test.";
            },
        });

        expect(result.prunedToolResults).toBeGreaterThan(0);
        expect(result.projectedToolResultTokens).toBeLessThan(result.originalToolResultTokens);
        expect(capturedPrompt).toContain("ERROR important failure");
        expect(capturedPrompt.length).toBeLessThan(20_000);
    });
});
