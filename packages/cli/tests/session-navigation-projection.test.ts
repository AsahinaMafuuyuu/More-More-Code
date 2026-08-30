import { describe, expect, test } from "bun:test";
import {
    appendSessionEntry,
    createSessionTree,
    jumpToSessionEntry,
} from "@more-more-code/harness";
import type { Message } from "../src/lib/chat-types";
import { projectSessionNavigationTree } from "../src/lib/session-navigation-projection";
import { projectDurableSessionMessages } from "../src/lib/durable-session-message";

function textMessage(
    id: string,
    role: "user" | "assistant",
    text: string,
): Message {
    return {
        id,
        role,
        parts: [{ type: "text", text }],
    };
}

function deterministicOptions() {
    let id = 0;
    let now = 100;
    return {
        createId: () => `entry-${++id}`,
        now: () => ++now,
    };
}

describe("Session Navigation Projection", () => {
    test("folds legacy message_update rows while using the effective assistant preview", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([], options);
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: textMessage("u1", "user", "question"),
        }, options);
        state = appendSessionEntry(state, {
            type: "assistant_message",
            messageId: "a1",
            message: textMessage("a1", "assistant", "draft"),
        }, options);
        state = appendSessionEntry(state, {
            type: "message_update",
            messageId: "a1",
            message: textMessage("a1", "assistant", "final"),
        }, options);
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u2",
            message: textMessage("u2", "user", "continue"),
        }, options);

        const projected = projectSessionNavigationTree(state);

        expect(projected.nodes.map((node) => node.type)).toEqual([
            "user_message",
            "assistant_message",
            "user_message",
        ]);
        expect(projected.nodes[1]?.preview).toBe("final");
        expect(projected.nodes.some((node) => node.navigationTargetEntryId === state.entries[3]?.id)).toBe(false);
        expect(state.entries.map((entry) => entry.type)).toEqual([
            "session_start",
            "user_message",
            "assistant_message",
            "message_update",
            "user_message",
        ]);
    });

    test("contracts hidden rows without turning a real branch into a chain", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([], options);
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u1",
            message: textMessage("u1", "user", "branch here"),
        }, options);
        const branchPoint = state.activeEntryId;

        state = appendSessionEntry(state, {
            type: "mode_change",
            mode: "BUILD",
        }, options);
        state = appendSessionEntry(state, {
            type: "assistant_message",
            messageId: "a-left",
            message: textMessage("a-left", "assistant", "left"),
        }, options);

        state = jumpToSessionEntry(state, branchPoint);
        state = appendSessionEntry(state, {
            type: "config_change",
            key: "example",
            value: true,
        }, options);
        state = appendSessionEntry(state, {
            type: "assistant_message",
            messageId: "a-right",
            message: textMessage("a-right", "assistant", "right"),
        }, options);

        const projected = projectSessionNavigationTree(state);
        const root = projected.nodes.find((node) => node.preview === "branch here")!;
        const children = projected.nodes.filter((node) => node.parentId === root.id);

        expect(children.map((node) => node.preview)).toEqual(["left", "right"]);
        expect(children.map((node) => node.depth)).toEqual([1, 1]);
        expect(projected.nodes.some((node) => node.type === "mode_change")).toBe(false);
        expect(projected.nodes.some((node) => node.type === "config_change")).toBe(false);
    });

    test("keeps a single-child semantic chain visually flat", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([], options);
        for (const message of [
            textMessage("u1", "user", "one"),
            textMessage("a1", "assistant", "two"),
            textMessage("u2", "user", "three"),
            textMessage("a2", "assistant", "four"),
        ]) {
            state = appendSessionEntry(state, {
                type: message.role === "user" ? "user_message" : "assistant_message",
                messageId: message.id,
                message,
            }, options);
        }

        expect(projectSessionNavigationTree(state).nodes.map((node) => node.depth)).toEqual([
            0, 0, 0, 0,
        ]);
    });

    test("projects one terminal ToolUse row from one exact call/result pair", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([], options);
        state = appendSessionEntry(state, {
            type: "assistant_message",
            messageId: "a1",
            message: {
                id: "a1",
                role: "assistant",
                parts: [{
                    type: "tool-bash",
                    toolCallId: "tc1",
                    state: "input-available",
                    input: { command: "type README.md" },
                } as never],
            },
        }, options);
        state = appendSessionEntry(state, {
            type: "tool_call",
            toolCallId: "tc1",
            toolName: "bash",
            input: { command: "type README.md" },
        }, options);
        const callEntryId = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "tool_result",
            toolCallId: "tc1",
            toolName: "bash",
            status: "completed",
            output: "contents",
        }, options);
        const resultEntryId = state.activeEntryId;

        const projected = projectSessionNavigationTree(state);
        const toolNodes = projected.nodes.filter((node) => node.type === "tool_use");

        expect(toolNodes).toHaveLength(1);
        expect(toolNodes[0]).toMatchObject({
            callEntryId,
            resultEntryId,
            navigationTargetEntryId: resultEntryId,
            status: "completed",
        });
        expect(projected.nodes.some((node) => node.type === "tool_call")).toBe(false);
        expect(projected.nodes.some((node) => node.type === "tool_result")).toBe(false);
    });

    test("keeps an incomplete ToolUse diagnostic non-selectable after restart", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([{
            id: "a-incomplete",
            role: "assistant",
            parts: [{
                type: "tool-bash",
                toolCallId: "tc-incomplete",
                state: "input-available",
                input: { command: "echo maybe-ran" },
            } as never],
        }], options);
        state = appendSessionEntry(state, {
            type: "tool_call",
            toolCallId: "tc-incomplete",
            toolName: "bash",
            input: { command: "echo maybe-ran" },
        }, options);
        const callEntryId = state.activeEntryId;

        const [toolUse] = projectSessionNavigationTree(state).nodes.filter(
            (node) => node.type === "tool_use",
        );

        expect(toolUse).toMatchObject({
            status: "pending",
            selectable: false,
            callEntryId,
            navigationTargetEntryId: callEntryId,
        });
    });

    test("fails closed for orphan or duplicate terminal Tool facts", () => {
        const options = deterministicOptions();
        let orphan = createSessionTree<Message>([], options);
        orphan = appendSessionEntry(orphan, {
            type: "tool_result",
            toolCallId: "orphan",
            toolName: "bash",
            status: "completed",
            output: "unexpected",
        }, options);
        expect(() => projectSessionNavigationTree(orphan)).toThrow("Orphan tool_result orphan");

        let duplicate = createSessionTree<Message>([{
            id: "a-duplicate",
            role: "assistant",
            parts: [{
                type: "tool-bash",
                toolCallId: "duplicate",
                state: "input-available",
                input: { command: "echo once" },
            } as never],
        }], options);
        duplicate = appendSessionEntry(duplicate, {
            type: "tool_call",
            toolCallId: "duplicate",
            toolName: "bash",
            input: { command: "echo once" },
        }, options);
        duplicate = appendSessionEntry(duplicate, {
            type: "tool_result",
            toolCallId: "duplicate",
            toolName: "bash",
            status: "completed",
            output: "first",
        }, options);
        duplicate = appendSessionEntry(duplicate, {
            type: "tool_result",
            toolCallId: "duplicate",
            toolName: "bash",
            status: "completed",
            output: "second",
        }, options);

        expect(() => projectSessionNavigationTree(duplicate)).toThrow(
            "Duplicate terminal tool_result duplicate",
        );
    });

    test("fails closed when assistant Tool part identity disagrees with canonical tool_call", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([{
            id: "a-mismatch",
            role: "assistant",
            parts: [{
                type: "tool-bash",
                toolCallId: "ui-tool-id",
                state: "input-available",
                input: { command: "echo mismatch" },
            } as never],
        }], options);
        state = appendSessionEntry(state, {
            type: "tool_call",
            toolCallId: "semantic-tool-id",
            toolName: "bash",
            input: { command: "echo mismatch" },
        }, options);

        expect(() => projectSessionNavigationTree(state)).toThrow(
            "tool_call semantic-tool-id expected exactly one matching assistant Tool part, found 0",
        );
        expect(() => projectDurableSessionMessages(state)).toThrow(
            "Tool call semantic-tool-id expected exactly one matching assistant Tool part, found 0",
        );
    });

    test("projects Tool terminal statuses from canonical tool_result", () => {
        for (const status of [
            "completed",
            "failed",
            "cancelled",
            "timed_out",
            "denied",
            "approval_required",
        ] as const) {
            const options = deterministicOptions();
            let state = createSessionTree<Message>([{
                id: `a-${status}`,
                role: "assistant",
                parts: [{
                    type: "tool-bash",
                    toolCallId: `tc-${status}`,
                    state: "input-available",
                    input: { command: "echo status" },
                } as never],
            }], options);
            state = appendSessionEntry(state, {
                type: "tool_call",
                toolCallId: `tc-${status}`,
                toolName: "bash",
                input: { command: "echo status" },
            }, options);
            state = appendSessionEntry(state, {
                type: "tool_result",
                toolCallId: `tc-${status}`,
                toolName: "bash",
                status,
                ...(status === "completed" ? { output: "ok" } : { error: status }),
            }, options);

            const toolUse = projectSessionNavigationTree(state).nodes.find(
                (node) => node.type === "tool_use",
            );
            expect(toolUse?.status).toBe(status);
            expect(toolUse?.navigationTargetEntryId).toBe(state.activeEntryId);
        }
    });

    test("branches from the terminal ToolUse target while preserving the original sibling continuation", () => {
        const options = deterministicOptions();
        let state = createSessionTree<Message>([{
            id: "u-before-tool",
            role: "user",
            parts: [{ type: "text", text: "run it" }],
        }, {
            id: "a-tool-branch",
            role: "assistant",
            parts: [{
                type: "tool-bash",
                toolCallId: "branch-tool",
                state: "input-available",
                input: { command: "echo branch" },
            } as never],
        }], options);
        state = appendSessionEntry(state, {
            type: "tool_call",
            toolCallId: "branch-tool",
            toolName: "bash",
            input: { command: "echo branch" },
        }, options);
        state = appendSessionEntry(state, {
            type: "tool_result",
            toolCallId: "branch-tool",
            toolName: "bash",
            status: "completed",
            output: { stdout: "branch\n" },
        }, options);
        const terminalEntryId = state.activeEntryId;
        state = appendSessionEntry(state, {
            type: "assistant_message",
            messageId: "a-original-later",
            message: textMessage("a-original-later", "assistant", "original continuation"),
        }, options);
        const originalLeafId = state.activeEntryId;

        const toolUse = projectSessionNavigationTree(state).nodes.find(
            (node) => node.type === "tool_use",
        )!;
        expect(toolUse.navigationTargetEntryId).toBe(terminalEntryId);

        state = jumpToSessionEntry(state, toolUse.navigationTargetEntryId);
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "u-new-branch",
            message: textMessage("u-new-branch", "user", "new branch"),
        }, options);
        const newLeafId = state.activeEntryId;

        expect(state.entries.find((entry) => entry.id === originalLeafId)).toBeDefined();
        expect(state.entries.find((entry) => entry.id === newLeafId)?.parentId).toBe(terminalEntryId);
        expect(projectDurableSessionMessages(state, newLeafId).map((message) => message.id)).toEqual([
            "u-before-tool",
            "a-tool-branch",
            "u-new-branch",
        ]);
        expect(projectDurableSessionMessages(state, originalLeafId).map((message) => message.id)).toEqual([
            "u-before-tool",
            "a-tool-branch",
            "a-original-later",
        ]);
    });
});
