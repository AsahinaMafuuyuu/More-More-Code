import { describe, expect, test } from "bun:test";
import {
    createHeuristicTokenCounter,
    type ContextRecord,
    type ModelContextProfile,
} from "@more-more-code/harness";
import type { Message } from "../src/lib/chat-types";
import {
    buildSemanticCompactionPrompt,
    createSemanticContextCompactor,
    SEMANTIC_COMPACTION_INSTRUCTIONS,
} from "../src/lib/context-compactor";

const profile: ModelContextProfile = {
    contextWindowTokens: 4_096,
    reservedOutputTokens: 512,
    safetyMarginTokens: 128,
    retainedTailTurns: 2,
    maxSummaryTokens: 256,
    tokenCounter: createHeuristicTokenCounter({
        id: "context-compactor-test",
        latinCharsPerToken: 4,
        cjkCharsPerToken: 1.5,
        structuralOverheadTokens: 2,
    }),
};

function message(id: string, role: "user" | "assistant", text: string): Message {
    return {
        id,
        role,
        parts: [{ type: "text", text }],
    };
}

function contextRecord(
    id: string,
    kind: "history" | "summary",
    payload: Message,
): ContextRecord<Message> {
    return {
        id,
        kind,
        payload,
        estimatedTokens: profile.tokenCounter.countPayload(payload),
        groupId: kind === "summary" ? "compacted-prefix" : `turn:${id}`,
    };
}

describe("semantic context compactor", () => {
    test("builds an incremental replacement-state prompt from the prior checkpoint and new events", () => {
        const previous = contextRecord(
            "checkpoint-1",
            "summary",
            message("checkpoint-1", "assistant", "## Current Goal\nImplement the harness."),
        );
        const next = contextRecord(
            "u2",
            "history",
            message("u2", "user", "Use only GET and POST for the API."),
        );

        const prompt = buildSemanticCompactionPrompt({
            previousCheckpointRecords: [previous],
            newlyCompactedRecords: [next],
            trigger: "soft-limit",
        });

        expect(prompt).toContain("<previous_snapshot>");
        expect(prompt).toContain("Implement the harness.");
        expect(prompt).toContain("<new_events>");
        expect(prompt).toContain("Use only GET and POST for the API.");
        expect(SEMANTIC_COMPACTION_INSTRUCTIONS).toContain("complete replacement state snapshot");
        expect(SEMANTIC_COMPACTION_INSTRUCTIONS).toContain("remove superseded facts");
        expect(SEMANTIC_COMPACTION_INSTRUCTIONS).toContain("## Pending Work");
    });

    test("uses the semantic reducer and returns a bounded checkpoint", async () => {
        const previous = contextRecord(
            "checkpoint-1",
            "summary",
            message("checkpoint-1", "assistant", "## Current Goal\nOld goal"),
        );
        const next = contextRecord(
            "u2",
            "history",
            message("u2", "user", "The new goal is semantic compaction."),
        );
        let observedMaxOutputTokens = 0;
        const compactor = createSemanticContextCompactor({
            profile,
            async reduce({ instructions, prompt, maxOutputTokens }) {
                expect(instructions).toContain("## Decisions");
                expect(prompt).toContain("Old goal");
                expect(prompt).toContain("semantic compaction");
                observedMaxOutputTokens = maxOutputTokens;
                return [
                    "## Current Goal",
                    "Implement semantic compaction.",
                    "## Current State",
                    "Reducer wired.",
                    "## Decisions",
                    "Use replacement snapshots.",
                    "## Constraints",
                    "Preserve append-only history.",
                    "## Artifacts",
                    "Context manager.",
                    "## Failures and Lessons",
                    "None",
                    "## Pending Work",
                    "Verify.",
                ].join("\n");
            },
        });

        const result = await compactor.compact({
            records: [previous, next],
            previousCheckpointRecords: [previous],
            newlyCompactedRecords: [next],
            targetTokens: 160,
            trigger: "soft-limit",
        });

        expect(observedMaxOutputTokens).toBe(160);
        expect(result?.kind).toBe("summary");
        expect(result?.estimatedTokens).toBeLessThanOrEqual(160);
        expect((result?.payload as Message).parts[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining("Implement semantic compaction."),
        });
    });

    test("falls back deterministically when semantic reduction fails", async () => {
        const next = contextRecord(
            "u2",
            "history",
            message("u2", "user", "Keep this durable requirement."),
        );
        const compactor = createSemanticContextCompactor({
            profile,
            async reduce() {
                throw new Error("provider unavailable");
            },
        });

        const result = await compactor.compact({
            records: [next],
            previousCheckpointRecords: [],
            newlyCompactedRecords: [next],
            targetTokens: 80,
            trigger: "overflow",
        });

        expect(result?.kind).toBe("summary");
        expect(result?.estimatedTokens).toBeLessThanOrEqual(80);
        const textPart = (result?.payload as Message).parts.find((part) => part.type === "text");
        expect(textPart?.text).toContain("Deterministic fallback context snapshot");
        expect(textPart?.text).toContain("Keep this durable requirement.");
    });
});
