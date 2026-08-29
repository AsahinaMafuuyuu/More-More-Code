import { describe, expect, test } from "bun:test";
import {
    createHeuristicTokenCounter,
    type CompactionPlan,
    type ContextRecord,
    type ModelContextProfile,
    type RequiredContextAnchor,
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
    return { id, role, parts: [{ type: "text", text }] };
}

function contextRecord(
    id: string,
    kind: "history" | "summary",
    payload: Message,
    requiredAnchors?: RequiredContextAnchor[],
): ContextRecord<Message> {
    return {
        id,
        kind,
        payload,
        estimatedTokens: profile.tokenCounter.countPayload(payload),
        groupId: kind === "summary" ? "compacted-prefix" : `cycle:${id}`,
        ...(requiredAnchors ? { requiredAnchors } : {}),
    };
}

function plan(input: {
    records: readonly ContextRecord<Message>[];
    trigger: CompactionPlan["trigger"];
    targetTokens: number;
    anchors?: RequiredContextAnchor[];
}): CompactionPlan {
    const ids = input.records.map((record) => record.id);
    return {
        version: 1,
        planId: `plan:${ids.join(":")}:${input.trigger}`,
        policyVersion: "test-v2",
        trigger: input.trigger,
        baseCheckpointId: null,
        sourceRecordIds: ids,
        sourceDigest: `digest:${ids.join(":")}`,
        provenanceRecordIds: ids,
        retainedRecordIds: [],
        compactedThroughRecordId: ids.at(-1)!,
        retainedFromRecordId: null,
        splitGroup: false,
        inputTokensBefore: input.records.reduce((sum, record) => sum + record.estimatedTokens, 0),
        targetInputTokens: 256,
        maxCheckpointTokens: input.targetTokens,
        requiredAnchors: input.anchors ?? [],
    };
}

function reducerJson(input: {
    currentGoal?: unknown[];
    currentState?: unknown[];
    decisions?: unknown[];
    constraints?: unknown[];
    artifacts?: unknown[];
    failuresAndLessons?: unknown[];
    pendingWork?: unknown[];
    coveredAnchorIds?: string[];
}) {
    return JSON.stringify({
        currentGoal: input.currentGoal ?? [],
        currentState: input.currentState ?? [],
        decisions: input.decisions ?? [],
        constraints: input.constraints ?? [],
        artifacts: input.artifacts ?? [],
        failuresAndLessons: input.failuresAndLessons ?? [],
        pendingWork: input.pendingWork ?? [],
        coveredAnchorIds: input.coveredAnchorIds ?? [],
    });
}

describe("semantic context compactor", () => {
    test("builds an incremental replacement-state prompt from prior checkpoint and new events", () => {
        const previous = contextRecord(
            "checkpoint-1",
            "summary",
            message("checkpoint-1", "assistant", "Old structured checkpoint"),
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
        expect(prompt).toContain("Old structured checkpoint");
        expect(prompt).toContain("<new_events>");
        expect(prompt).toContain("Use only GET and POST for the API.");
        expect(SEMANTIC_COMPACTION_INSTRUCTIONS).toContain("complete replacement state snapshot");
        expect(SEMANTIC_COMPACTION_INSTRUCTIONS).toContain("remove superseded facts");
        expect(SEMANTIC_COMPACTION_INSTRUCTIONS).toContain("pendingWork");
    });

    test("uses the semantic reducer and returns a validated structured checkpoint", async () => {
        const previous = contextRecord("checkpoint-1", "summary", message("checkpoint-1", "assistant", "Old goal"));
        const next = contextRecord("u2", "history", message("u2", "user", "The new goal is semantic compaction."));
        const records = [previous, next];
        const compactionPlan = plan({ records, trigger: "soft-limit", targetTokens: 160 });
        let observedMaxOutputTokens = 0;
        const compactor = createSemanticContextCompactor({
            profile,
            async reduce({ instructions, prompt, maxOutputTokens }) {
                expect(instructions).toContain("sourceRecordIds");
                expect(prompt).toContain("Old goal");
                expect(prompt).toContain("semantic compaction");
                observedMaxOutputTokens = maxOutputTokens;
                return reducerJson({
                    currentGoal: [{ id: "goal", text: "Implement semantic compaction.", sourceRecordIds: ["u2"] }],
                    currentState: [{ id: "state", text: "Reducer wired.", sourceRecordIds: ["u2"] }],
                    decisions: [{ id: "decision", text: "Use replacement snapshots.", sourceRecordIds: ["u2"] }],
                });
            },
        });

        const result = await compactor.compact({
            plan: compactionPlan,
            records,
            previousCheckpointRecords: [previous],
            newlyCompactedRecords: [next],
            retainedRecords: [],
            targetTokens: 160,
            trigger: "soft-limit",
        });

        expect(observedMaxOutputTokens).toBe(160);
        expect(result?.kind).toBe("summary");
        expect(result?.estimatedTokens).toBeLessThanOrEqual(160);
        expect(result?.checkpointV2?.validation.quality).toBe("verified");
        expect(result?.checkpointV2?.source.recordIds).toEqual(["checkpoint-1", "u2"]);
        const textPart = (result?.payload as Message).parts.find((part) => part.type === "text");
        expect(textPart?.text).toContain("Implement semantic compaction.");
    });

    test("falls back deterministically and preserves P0 anchors when reducer fails", async () => {
        const anchor: RequiredContextAnchor = {
            id: "requirement",
            priority: "P0",
            kind: "constraint",
            text: "Keep this durable requirement.",
            sourceRecordIds: ["u2"],
        };
        const next = contextRecord("u2", "history", message("u2", "user", anchor.text), [anchor]);
        const records = [next];
        const compactionPlan = plan({ records, trigger: "overflow", targetTokens: 100, anchors: [anchor] });
        const compactor = createSemanticContextCompactor({
            profile,
            async reduce() { throw new Error("provider unavailable"); },
        });

        const result = await compactor.compact({
            plan: compactionPlan,
            records,
            previousCheckpointRecords: [],
            newlyCompactedRecords: [next],
            retainedRecords: [],
            targetTokens: 100,
            trigger: "overflow",
        });

        expect(result?.kind).toBe("summary");
        expect(result?.checkpointV2?.validation.quality).toBe("deterministic-degraded");
        expect(result?.checkpointV2?.validation.coveredAnchorIds).toContain("requirement");
        const textPart = (result?.payload as Message).parts.find((part) => part.type === "text");
        expect(textPart?.text).toContain("Keep this durable requirement.");
        expect(textPart?.text).not.toContain("[summary truncated]");
    });

    test("rejects hallucinated reducer provenance and uses deterministic fallback", async () => {
        const next = contextRecord("u2", "history", message("u2", "user", "Known source."));
        const records = [next];
        let fallbackReason = "";
        const compactor = createSemanticContextCompactor({
            profile,
            async reduce() {
                return reducerJson({
                    currentState: [{ id: "bad", text: "Invented", sourceRecordIds: ["unknown"] }],
                });
            },
            onFallback(reason) { fallbackReason = reason; },
        });
        const result = await compactor.compact({
            plan: plan({ records, trigger: "hard-limit", targetTokens: 100 }),
            records,
            previousCheckpointRecords: [],
            newlyCompactedRecords: [next],
            retainedRecords: [],
            targetTokens: 100,
            trigger: "hard-limit",
        });
        expect(fallbackReason).toBe("invalid-output");
        expect(result?.checkpointV2?.validation.quality).toBe("deterministic-degraded");
    });

    test("never tail-truncates an oversized semantic checkpoint", async () => {
        const next = contextRecord("u2", "history", message("u2", "user", "Short canonical source."));
        const records = [next];
        let fallbackReason = "";
        const compactor = createSemanticContextCompactor({
            profile,
            async reduce() {
                return reducerJson({
                    currentState: [{ id: "huge", text: "x".repeat(4_000), sourceRecordIds: ["u2"] }],
                });
            },
            onFallback(reason) { fallbackReason = reason; },
        });
        const result = await compactor.compact({
            plan: plan({ records, trigger: "hard-limit", targetTokens: 120 }),
            records,
            previousCheckpointRecords: [],
            newlyCompactedRecords: [next],
            retainedRecords: [],
            targetTokens: 120,
            trigger: "hard-limit",
        });
        expect(fallbackReason).toBe("oversized-output");
        const textPart = (result?.payload as Message).parts.find((part) => part.type === "text");
        expect(textPart?.text).not.toContain("[summary truncated]");
        expect(result?.estimatedTokens).toBeLessThanOrEqual(120);
    });
});
