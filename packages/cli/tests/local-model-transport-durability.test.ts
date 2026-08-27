import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import {
    createHeuristicTokenCounter,
    type ModelContextProfile,
} from "@more-more-code/harness";
import { bootstrapAgentEnvironment } from "../src/lib/agent-environment";
import type { Message } from "../src/lib/chat-types";
import {
    LocalModelTransport,
    type ContextCompactionEvent,
} from "../src/lib/local-model-transport";

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
