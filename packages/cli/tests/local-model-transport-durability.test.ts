import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import {
    appendSessionEntry,
    createSessionTree,
    createHeuristicTokenCounter,
    type ModelContextProfile,
} from "@more-more-code/harness";
import { bootstrapAgentEnvironment } from "../src/lib/agent-environment";
import type { Message } from "../src/lib/chat-types";
import {
    LocalModelTransport,
    type ContextCompactionEvent,
} from "../src/lib/local-model-transport";
import {
    appendFinalizedDurableAssistantStep,
    projectDurableSessionMessages,
} from "../src/lib/durable-session-message";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function transportProfile(): ModelContextProfile {
    return {
        contextWindowTokens: 2_000,
        reservedOutputTokens: 0,
        safetyMarginTokens: 0,
        retainedTailTurns: 1,
        maxSummaryTokens: 160,
        compactionSoftLimitRatio: 0.8,
        compactionHardLimitRatio: 0.92,
        postCompactionTargetRatio: 0.7,
        toolResultWorkingSetRatio: 0.25,
        toolResultFullThresholdRatio: 0.06,
        toolResultReferenceRatio: 0.006,
        tokenCounter: createHeuristicTokenCounter({
            id: "local-model-transport-durability-test",
            latinCharsPerToken: 4,
            cjkCharsPerToken: 1.5,
            structuralOverheadTokens: 1,
        }),
    };
}

function usage() {
    return {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
}

function finishReason() {
    return { unified: "stop" as const, raw: undefined };
}

function createFakeProvider() {
    return new MockLanguageModelV4({
        provider: "fake-provider",
        modelId: "fake-model",
        doGenerate: {
            content: [{
                type: "text",
                text: [
                    "## Current Goal",
                    "Keep the checkpoint durable before continuing.",
                    "## Current State",
                    "Compaction is active.",
                    "## Decisions",
                    "Commit before the next model request.",
                    "## Constraints",
                    "Do not lose context or cache identity.",
                    "## Artifacts",
                    "Local Session Tree.",
                    "## Failures and Lessons",
                    "None.",
                    "## Pending Work",
                    "Continue only after commit.",
                ].join("\n"),
            }],
            finishReason: finishReason(),
            usage: usage(),
            warnings: [],
        },
        doStream: {
            stream: simulateReadableStream({
                chunks: [
                    { type: "stream-start", warnings: [] },
                    { type: "text-start", id: "response" },
                    { type: "text-delta", id: "response", delta: "done" },
                    { type: "text-end", id: "response" },
                    { type: "finish", finishReason: finishReason(), usage: usage() },
                ],
                initialDelayInMs: null,
                chunkDelayInMs: null,
            }),
        },
    });
}

async function bootstrapTestEnvironment() {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-local-model-durable-"));
    temporaryDirectories.push(root);
    await bootstrapAgentEnvironment({
        globalHome: path.join(root, "home"),
        workspaceRoot: path.join(root, "workspace"),
    });
}

function messages(): Message[] {
    const model = { providerId: "openai", modelId: "gpt-5.5" } as const;
    return [
        {
            id: "old-user",
            role: "user",
            parts: [{ type: "text", text: "durable history ".repeat(1_400) }],
            metadata: { mode: "PLAN", model },
        },
        {
            id: "old-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "historical answer ".repeat(1_400) }],
        },
        {
            id: "current-user",
            role: "user",
            parts: [{ type: "text", text: "Continue from the current state." }],
            metadata: { mode: "PLAN", model },
        },
    ];
}

function sendInput(messages: Message[]): Parameters<LocalModelTransport["sendMessages"]>[0] {
    return {
        trigger: "submit-message",
        chatId: "durability-test",
        messageId: messages.at(-1)?.id,
        messages,
        abortSignal: new AbortController().signal,
    };
}

async function waitFor<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
    const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for test transition")), timeoutMs);
    });
    return Promise.race([promise, timeout]);
}

describe("LocalModelTransport compaction durability", () => {
    test("emits one normalized post-completion Usage fact without Provider payload leakage", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const usageEvents: unknown[] = [];
        const transport = new LocalModelTransport({
            onModelUsage(event) {
                usageEvents.push(event);
            },
            dependencies: {
                async resolveChatModel(model) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: model.providerId,
                        modelId: model.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });

        const stream = await transport.sendMessages(sendInput([messages().at(-1)!]));
        const reader = stream.getReader();
        while (!(await reader.read()).done) {}

        expect(provider.doStreamCalls).toHaveLength(1);
        expect(usageEvents).toHaveLength(1);
        expect(usageEvents[0]).toMatchObject({
            providerId: "openai",
            providerKind: "openai",
            modelId: "gpt-5.5",
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
        });
        expect(JSON.stringify(usageEvents[0])).not.toContain("prompt");
    });

    test("does not retry Provider when post-completion Usage persistence rejects", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const usageErrors: Error[] = [];
        const transport = new LocalModelTransport({
            async onModelUsage() {
                throw new Error("runtime usage append failed");
            },
            onModelUsageError(error) {
                usageErrors.push(error);
            },
            dependencies: {
                async resolveChatModel(model) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: model.providerId,
                        modelId: model.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });

        const stream = await transport.sendMessages(sendInput([messages().at(-1)!]));
        const reader = stream.getReader();
        let text = "";
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            text += JSON.stringify(next.value);
        }

        expect(provider.doStreamCalls).toHaveLength(1);
        expect(text).toContain("done");
        expect(usageErrors).toHaveLength(1);
        expect(usageErrors[0]?.message).toBe("runtime usage append failed");
    });

    test("sends exactly one matching Tool Call/Result pair after canonical Tool terminal projection", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const model = { providerId: "openai", modelId: "gpt-5.5" } as const;
        let state = createSessionTree<Message>([
            {
                id: "tool-user",
                role: "user",
                parts: [{ type: "text", text: "Read the file." }],
                metadata: { mode: "BUILD", model },
            },
            {
                id: "tool-assistant",
                role: "assistant",
                parts: [{
                    type: "tool-bash",
                    toolCallId: "provider-tool-1",
                    state: "input-available",
                    input: { command: "type README.md" },
                } as never],
                metadata: { mode: "BUILD", model },
            },
        ]);
        state = appendSessionEntry(state, {
            type: "tool_call",
            toolCallId: "provider-tool-1",
            toolName: "bash",
            input: { command: "type README.md" },
        });
        state = appendSessionEntry(state, {
            type: "tool_result",
            toolCallId: "provider-tool-1",
            toolName: "bash",
            status: "completed",
            output: { stdout: "project contents" },
        });

        expect(state.entries.some((entry) => entry.type === "message_update")).toBe(false);
        const projected = projectDurableSessionMessages(state);
        const transport = new LocalModelTransport({
            dependencies: {
                async resolveChatModel(selectedModel) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: selectedModel.providerId,
                        modelId: selectedModel.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });

        const stream = await transport.sendMessages(sendInput(projected));
        const reader = stream.getReader();
        while (!(await reader.read()).done) {
            // Drain the UI stream so the fake Provider receives the compiled prompt.
        }

        expect(provider.doStreamCalls).toHaveLength(1);
        const prompt = JSON.stringify(provider.doStreamCalls[0]?.prompt);
        expect(prompt.match(/"type":"tool-call"/g)).toHaveLength(1);
        expect(prompt.match(/"type":"tool-result"/g)).toHaveLength(1);
        expect(prompt.match(/"toolCallId":"provider-tool-1"/g)).toHaveLength(2);
        expect(prompt).toContain("project contents");
    });

    test("compiles a follow-up after two durable Model Steps from one reused AI SDK message id", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const model = { providerId: "openai", modelId: "gpt-5.5" } as const;
        let state = createSessionTree<Message>([
            {
                id: "reuse-user",
                role: "user",
                parts: [{ type: "text", text: "Inspect the project." }],
                metadata: { mode: "BUILD", model },
            },
        ]);
        state = appendFinalizedDurableAssistantStep(state, {
            id: "reused-ui-message",
            role: "assistant",
            parts: [
                { type: "step-start" },
                {
                    type: "tool-bash",
                    toolCallId: "reuse-tool",
                    state: "input-available",
                    input: { command: "type README.md" },
                } as never,
            ],
            metadata: { mode: "BUILD", model },
        }, { runId: "reuse-run", turnId: "reuse-turn-1", stepId: "reuse-step-1" });
        state = appendSessionEntry(state, {
            type: "tool_call",
            toolCallId: "reuse-tool",
            toolName: "bash",
            input: { command: "type README.md" },
        });
        state = appendSessionEntry(state, {
            type: "tool_result",
            toolCallId: "reuse-tool",
            toolName: "bash",
            status: "completed",
            output: { stdout: "README contents" },
        });
        state = appendFinalizedDurableAssistantStep(state, {
            id: "reused-ui-message",
            role: "assistant",
            parts: [
                { type: "step-start" },
                {
                    type: "tool-bash",
                    toolCallId: "reuse-tool",
                    state: "output-available",
                    input: { command: "type README.md" },
                    output: { stdout: "README contents" },
                } as never,
                { type: "step-start" },
                { type: "text", text: "The project inspection is complete.", state: "done" },
            ],
            metadata: { mode: "BUILD", model },
        }, { runId: "reuse-run", turnId: "reuse-turn-2", stepId: "reuse-step-2" });
        state = appendSessionEntry(state, {
            type: "user_message",
            messageId: "reuse-follow-up",
            message: {
                id: "reuse-follow-up",
                role: "user",
                parts: [{ type: "text", text: "What changed?" }],
                metadata: { mode: "BUILD", model },
            },
        });

        const projected = projectDurableSessionMessages(state);
        expect(projected.map((message) => message.id)).toEqual([
            "reuse-user",
            "assistant-step:reuse-step-1",
            "assistant-step:reuse-step-2",
            "reuse-follow-up",
        ]);

        const transport = new LocalModelTransport({
            dependencies: {
                async resolveChatModel(selectedModel) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: selectedModel.providerId,
                        modelId: selectedModel.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });
        const stream = await transport.sendMessages(sendInput(projected));
        const reader = stream.getReader();
        while (!(await reader.read()).done) {
            // Drain the stream so the fake Provider records the compiled prompt.
        }

        const prompt = JSON.stringify(provider.doStreamCalls[0]?.prompt);
        expect(prompt.match(/"type":"tool-call"/g)).toHaveLength(1);
        expect(prompt.match(/"type":"tool-result"/g)).toHaveLength(1);
        expect(prompt).toContain("README contents");
        expect(prompt).toContain("The project inspection is complete.");
        expect(prompt).toContain("What changed?");
    });

    test("does not expose the provider stream until the fake Session authority commits the automatic checkpoint", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const commitGate = deferred<void>();
        const commitStarted = deferred<ContextCompactionEvent>();
        const publishedCheckpoints: ContextCompactionEvent[] = [];
        const authority = {
            commits: 0,
            async commit(event: ContextCompactionEvent) {
                this.commits += 1;
                commitStarted.resolve(event);
                await commitGate.promise;
                publishedCheckpoints.push(event);
            },
        };
        const transport = new LocalModelTransport({
            async onContextCompaction(event) {
                await authority.commit(event);
            },
            dependencies: {
                async resolveChatModel(model) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: model.providerId,
                        modelId: model.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });

        const request = transport.sendMessages(sendInput(messages()));
        const checkpoint = await waitFor(commitStarted.promise);
        let streamExposed = false;
        void request.then(() => {
            streamExposed = true;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(checkpoint.trigger).toMatch(/soft-limit|hard-limit|overflow/);
        expect(streamExposed).toBe(false);
        expect(authority.commits).toBe(1);
        expect(publishedCheckpoints).toHaveLength(0);
        expect(provider.doStreamCalls).toHaveLength(0);

        commitGate.resolve();
        const stream = await request;
        const reader = stream.getReader();
        while (!(await reader.read()).done) {
            // Drain the returned UI stream so AI SDK invokes the fake provider.
        }

        expect(publishedCheckpoints).toHaveLength(1);
        expect(provider.doStreamCalls).toHaveLength(1);
        expect(provider.doStreamCalls[0]?.providerOptions).toMatchObject({
            openai: {
                promptCacheKey: expect.stringContaining("more-more-code:"),
            },
        });
        expect(JSON.stringify(provider.doStreamCalls[0]?.prompt))
            .toContain("Keep the checkpoint durable before continuing.");
    });

    test("fails closed when the fake Session authority rejects an automatic checkpoint commit", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const transport = new LocalModelTransport({
            async onContextCompaction() {
                throw new Error("local session commit failed");
            },
            dependencies: {
                async resolveChatModel(model) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: model.providerId,
                        modelId: model.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });

        await expect(transport.sendMessages(sendInput(messages())))
            .rejects.toThrow("local session commit failed");
        expect(provider.doStreamCalls).toHaveLength(0);
    });

    test("keeps manual /compact pending until its fake Session authority commit succeeds", async () => {
        await bootstrapTestEnvironment();
        const provider = createFakeProvider();
        const commitGate = deferred<void>();
        const commitStarted = deferred<ContextCompactionEvent>();
        const authority = {
            commits: 0,
            async commit(event: ContextCompactionEvent) {
                this.commits += 1;
                commitStarted.resolve(event);
                await commitGate.promise;
            },
        };
        const transport = new LocalModelTransport({
            async onContextCompaction(event) {
                await authority.commit(event);
            },
            dependencies: {
                async resolveChatModel(model) {
                    return {
                        model: provider,
                        provider: "openai",
                        providerId: model.providerId,
                        modelId: model.modelId,
                    };
                },
                resolveModelContextProfile: () => transportProfile(),
            },
        });
        const model = { providerId: "openai", modelId: "gpt-5.5" } as const;

        const compact = transport.compactContext({
            messages: messages(),
            mode: "PLAN",
            model,
        });
        const checkpoint = await waitFor(commitStarted.promise);
        let outcomeExposed = false;
        void compact.then(() => {
            outcomeExposed = true;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(checkpoint.trigger).toBe("manual");
        expect(outcomeExposed).toBe(false);
        expect(authority.commits).toBe(1);

        commitGate.resolve();
        await expect(compact).resolves.toMatchObject({ status: "compacted" });
        expect(provider.doGenerateCalls).toHaveLength(1);
        expect(provider.doStreamCalls).toHaveLength(0);
    });
});
