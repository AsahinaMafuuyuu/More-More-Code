import { describe, expect, test } from "bun:test";
import type { PromptPrefixIdentity } from "../src/lib/cache-identity";
import type { ResolvedModel } from "../src/lib/models";
import {
    getProviderPrefixCacheStats,
    resetProviderPrefixCache,
    streamProvider,
} from "../src/lib/native-provider-executor";
import type { NativeModelRequest, ProviderStreamEvent } from "../src/lib/provider-native-protocol";

const prefixIdentity: PromptPrefixIdentity = {
    fingerprint: "prefix-123",
    toolSetFingerprint: "tools-123",
    systemPromptVersion: "2",
    globalInstructionsHash: "global",
    projectInstructionsHash: "project",
    skillCatalogHash: "skills",
};

function request(): NativeModelRequest {
    return {
        system: "stable system",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        tools: [{
            name: "readFile",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        }],
        prefixIdentity,
        cacheRetention: "short",
    };
}

function model(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
    return {
        provider: "openai",
        providerId: "openai",
        modelId: "gpt-test",
        protocol: "openai-responses",
        endpoint: "https://provider.invalid/v1/responses",
        auth: { type: "api-key", value: "secret-key" },
        ...overrides,
    };
}

function sse(lines: unknown[]) {
    return new Response(lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

async function collect(
    resolvedModel: ResolvedModel,
    nativeRequest: NativeModelRequest,
    response: Response,
) {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
        captured = { url: String(url), init };
        return response.clone();
    };
    const events: ProviderStreamEvent[] = [];
    for await (const event of streamProvider(resolvedModel, nativeRequest, {
        fetch: fetch as typeof globalThis.fetch,
    })) events.push(event);
    return { events, captured: captured! };
}

describe("native provider adapters", () => {
    test("OpenAI Responses emits cache key directly and normalizes cached tokens", async () => {
        resetProviderPrefixCache();
        const response = sse([
            { type: "response.output_text.delta", delta: "hello" },
            {
                type: "response.completed",
                response: {
                    status: "completed",
                    usage: {
                        input_tokens: 100,
                        input_tokens_details: { cached_tokens: 80 },
                        output_tokens: 10,
                        output_tokens_details: { reasoning_tokens: 4 },
                    },
                },
            },
        ]);
        const first = await collect(model(), request(), response);
        const body = JSON.parse(String(first.captured.init?.body));
        const headers = new Headers(first.captured.init?.headers);

        expect(first.captured.url).toBe("https://provider.invalid/v1/responses");
        expect(headers.get("authorization")).toBe("Bearer secret-key");
        expect(body.prompt_cache_key).toBe("more-more-code:prefix-123");
        expect(body.store).toBe(false);
        expect(body.previous_response_id).toBeUndefined();
        expect(first.events).toContainEqual({ type: "text-delta", text: "hello" });
        expect(first.events).toContainEqual({
            type: "usage",
            usage: {
                inputTokens: 100,
                inputNoCacheTokens: 20,
                cacheReadTokens: 80,
                outputTokens: 10,
                outputTextTokens: 6,
                outputReasoningTokens: 4,
            },
        });

        await collect(model(), request(), response);
        expect(getProviderPrefixCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 });
    });

    test("Anthropic emits stable cache_control and preserves cache creation/read buckets", async () => {
        const anthropic = model({
            provider: "anthropic",
            providerId: "anthropic",
            protocol: "anthropic-messages",
            endpoint: "https://provider.invalid/v1/messages",
        });
        const nativeRequest = request();
        nativeRequest.messages = [
            {
                role: "assistant",
                content: [
                    {
                        type: "reasoning",
                        text: "prior thought",
                        providerMetadata: { anthropic: { thinkingSignature: "prior-signature" } },
                    },
                    { type: "text", text: "prior answer" },
                ],
            },
            { role: "user", content: [{ type: "text", text: "continue" }] },
        ];
        const response = sse([
            {
                type: "message_start",
                message: { usage: { input_tokens: 20, cache_read_input_tokens: 70, cache_creation_input_tokens: 10 } },
            },
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "new thought" } },
            { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "new-signature" } },
            { type: "content_block_stop", index: 0 },
            { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
            {
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                usage: { output_tokens: 9, output_tokens_details: { thinking_tokens: 3 } },
            },
            { type: "message_stop" },
        ]);
        const result = await collect(anthropic, nativeRequest, response);
        const body = JSON.parse(String(result.captured.init?.body));
        const headers = new Headers(result.captured.init?.headers);

        expect(headers.get("x-api-key")).toBe("secret-key");
        expect(headers.get("anthropic-version")).toBe("2023-06-01");
        expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
        expect(body.messages[0].content[0]).toEqual({
            type: "thinking",
            thinking: "prior thought",
            signature: "prior-signature",
        });
        expect(result.events).toContainEqual({ type: "reasoning-delta", text: "new thought" });
        expect(result.events).toContainEqual({
            type: "part-metadata",
            target: "reasoning",
            providerMetadata: { anthropic: { thinkingSignature: "new-signature" } },
        });
        expect(result.events).toContainEqual({
            type: "usage",
            usage: {
                inputTokens: 100,
                inputNoCacheTokens: 20,
                cacheReadTokens: 70,
                cacheWriteTokens: 10,
                outputTokens: 9,
                outputTextTokens: 6,
                outputReasoningTokens: 3,
            },
        });
    });

    test("DeepSeek parses reasoning and prompt cache hit/miss usage", async () => {
        const deepseek = model({
            provider: "deepseek",
            providerId: "deepseek",
            protocol: "openai-chat-completions",
            endpoint: "https://provider.invalid/chat/completions",
            modelOptions: { reasoningEffort: "medium" },
        });
        const response = new Response([
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "think", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 10, completion_tokens: 5 } })}\n\n`,
            "data: [DONE]\n\n",
        ].join(""));
        const nativeRequest = request();
        nativeRequest.messages = [
            { role: "user", content: [{ type: "text", text: "inspect the repository" }] },
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "I should inspect the repository first." },
                    {
                        type: "tool-call",
                        toolCallId: "call-1",
                        toolName: "readFile",
                        input: { path: "README.md" },
                    },
                ],
            },
            {
                role: "tool",
                content: [{
                    type: "tool-result",
                    toolCallId: "call-1",
                    toolName: "readFile",
                    output: "README contents",
                }],
            },
        ];
        const result = await collect(deepseek, nativeRequest, response);
        const body = JSON.parse(String(result.captured.init?.body));

        expect(body.reasoning_effort).toBe("medium");
        expect(body.messages).toContainEqual({
            role: "assistant",
            content: null,
            reasoning_content: "I should inspect the repository first.",
            tool_calls: [{
                id: "call-1",
                type: "function",
                function: {
                    name: "readFile",
                    arguments: JSON.stringify({ path: "README.md" }),
                },
            }],
        });
        expect(result.events).toContainEqual({ type: "reasoning-delta", text: "think" });
        expect(result.events).toContainEqual({
            type: "usage",
            usage: {
                inputTokens: 50,
                inputNoCacheTokens: 10,
                cacheReadTokens: 40,
                outputTokens: 5,
            },
        });
    });

    test("DeepSeek Tool continuation is append-only at the wire-message boundary", async () => {
        const deepseek = model({
            provider: "deepseek",
            providerId: "deepseek",
            protocol: "openai-chat-completions",
            endpoint: "https://provider.invalid/chat/completions",
            modelOptions: { reasoningEffort: "medium" },
        });
        const response = new Response([
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
            "data: [DONE]\n\n",
        ].join(""));
        const first = request();
        first.messages = [
            { role: "user", content: [{ type: "text", text: "inspect" }] },
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "read package metadata first" },
                    {
                        type: "tool-call",
                        toolCallId: "call-1",
                        toolName: "readFile",
                        input: { path: "package.json" },
                    },
                ],
            },
            {
                role: "tool",
                content: [{
                    type: "tool-result",
                    toolCallId: "call-1",
                    toolName: "readFile",
                    output: { content: "package-one" },
                }],
            },
        ];
        const second = structuredClone(first);
        second.messages.push(
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "now inspect the harness" },
                    {
                        type: "tool-call",
                        toolCallId: "call-2",
                        toolName: "readFile",
                        input: { path: "packages/harness/src/agent-loop.ts" },
                    },
                ],
            },
            {
                role: "tool",
                content: [{
                    type: "tool-result",
                    toolCallId: "call-2",
                    toolName: "readFile",
                    output: { content: "package-two" },
                }],
            },
        );

        const firstBody = JSON.parse(String((await collect(deepseek, first, response)).captured.init?.body));
        const secondBody = JSON.parse(String((await collect(deepseek, second, response)).captured.init?.body));

        expect(secondBody.tools).toEqual(firstBody.tools);
        expect(secondBody.reasoning_effort).toBe(firstBody.reasoning_effort);
        expect(secondBody.messages.slice(0, firstBody.messages.length)).toEqual(firstBody.messages);
        expect(secondBody.messages.at(-2)).toMatchObject({
            role: "assistant",
            reasoning_content: "now inspect the harness",
        });
        expect(secondBody.messages.at(-1)).toEqual({
            role: "tool",
            tool_call_id: "call-2",
            content: JSON.stringify({ content: "package-two" }),
        });
    });

    test("DeepSeek fails closed on internally inconsistent cache usage", async () => {
        const deepseek = model({
            provider: "deepseek",
            providerId: "deepseek",
            protocol: "openai-chat-completions",
            endpoint: "https://provider.invalid/chat/completions",
        });
        const response = new Response([
            `data: ${JSON.stringify({
                choices: [],
                usage: {
                    prompt_tokens: 100,
                    prompt_cache_hit_tokens: 80,
                    prompt_cache_miss_tokens: 30,
                    completion_tokens: 1,
                },
            })}\n\n`,
            "data: [DONE]\n\n",
        ].join(""));

        await expect(collect(deepseek, request(), response)).rejects.toThrow(
            "inconsistent prompt token/cache-hit/cache-miss usage",
        );
    });

    test("Google uses native Gemini endpoint authentication without putting key in URL", async () => {
        const google = model({
            provider: "google",
            providerId: "google",
            modelId: "gemini-3-test",
            protocol: "google-generative-ai",
            endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-test:streamGenerateContent?alt=sse",
        });
        const nativeRequest = request();
        nativeRequest.messages = [
            {
                role: "assistant",
                content: [
                    {
                        type: "reasoning",
                        text: "prior google thought",
                        providerMetadata: { google: { thoughtSignature: "google-reasoning-signature" } },
                    },
                    {
                        type: "tool-call",
                        toolCallId: "google-call-1",
                        toolName: "readFile",
                        input: { path: "README.md" },
                        providerMetadata: { google: { thoughtSignature: "google-tool-signature" } },
                    },
                ],
            },
            {
                role: "tool",
                content: [{
                    type: "tool-result",
                    toolCallId: "google-call-1",
                    toolName: "readFile",
                    output: { content: "hello" },
                }],
            },
        ];
        const response = sse([{
            candidates: [{
                content: {
                    parts: [
                        { thought: true, text: "gemini thought", thoughtSignature: "google-output-reasoning-signature" },
                        { text: "gemini" },
                        {
                            functionCall: { id: "google-call-2", name: "readFile", args: { path: "src" } },
                            thoughtSignature: "google-output-tool-signature",
                        },
                    ],
                },
                finishReason: "STOP",
            }],
            usageMetadata: {
                promptTokenCount: 90,
                cachedContentTokenCount: 60,
                candidatesTokenCount: 8,
                thoughtsTokenCount: 2,
            },
        }]);
        const result = await collect(google, nativeRequest, response);
        const headers = new Headers(result.captured.init?.headers);
        const body = JSON.parse(String(result.captured.init?.body));

        expect(result.captured.url).not.toContain("secret-key");
        expect(headers.get("x-goog-api-key")).toBe("secret-key");
        expect(body.tools[0].functionDeclarations[0].parametersJsonSchema).toMatchObject({
            type: "object",
        });
        expect(body.tools[0].functionDeclarations[0].parameters).toBeUndefined();
        expect(body.contents[0].parts[0]).toEqual({
            thought: true,
            text: "prior google thought",
            thoughtSignature: "google-reasoning-signature",
        });
        expect(body.contents[0].parts[1]).toEqual({
            functionCall: {
                name: "readFile",
                args: { path: "README.md" },
                id: "google-call-1",
            },
            thoughtSignature: "google-tool-signature",
        });
        expect(body.contents[1].parts[0].functionResponse.id).toBe("google-call-1");
        expect(result.events).toContainEqual({ type: "reasoning-delta", text: "gemini thought" });
        expect(result.events).toContainEqual({
            type: "part-metadata",
            target: "reasoning",
            providerMetadata: { google: { thoughtSignature: "google-output-reasoning-signature" } },
        });
        expect(result.events).toContainEqual({
            type: "tool-call",
            toolCallId: "google-call-2",
            toolName: "readFile",
            input: { path: "src" },
            providerMetadata: { google: { thoughtSignature: "google-output-tool-signature" } },
        });
        expect(result.events).toContainEqual({ type: "text-delta", text: "gemini" });
        expect(result.events).toContainEqual({
            type: "usage",
            usage: {
                inputTokens: 90,
                inputNoCacheTokens: 30,
                cacheReadTokens: 60,
                outputTokens: 10,
                outputTextTokens: 8,
                outputReasoningTokens: 2,
            },
        });
    });

    test("stable prefix cache remains bounded across identities", async () => {
        resetProviderPrefixCache();
        const response = sse([{ type: "response.completed", response: { status: "completed" } }]);
        for (let index = 0; index < 40; index += 1) {
            const nativeRequest = request();
            nativeRequest.prefixIdentity = { ...prefixIdentity, fingerprint: `prefix-${index}` };
            await collect(model(), nativeRequest, response);
        }
        expect(getProviderPrefixCacheStats().size).toBe(32);
    });

    test("reuses one stable prefix identity across 1,000 repeated turns", async () => {
        resetProviderPrefixCache();
        const response = sse([{ type: "response.completed", response: { status: "completed" } }]);
        for (let index = 0; index < 1_000; index += 1) {
            const nativeRequest = request();
            nativeRequest.messages = [{
                role: "user",
                content: [{ type: "text", text: `dynamic turn ${index}` }],
            }];
            await collect(model(), nativeRequest, response);
        }
        expect(getProviderPrefixCacheStats()).toMatchObject({
            size: 1,
            misses: 1,
            hits: 999,
            capacity: 32,
        });
    });
});
