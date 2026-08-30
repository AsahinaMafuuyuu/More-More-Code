import { describe, expect, test } from "bun:test";
import type { PromptPrefixIdentity } from "../src/lib/cache-identity";
import type { ResolvedModel } from "../src/lib/models";
import { compileProviderRequest, createProviderCacheTelemetry } from "../src/lib/provider-runtime";

const prefixIdentity: PromptPrefixIdentity = {
    fingerprint: "prefix-fingerprint",
    toolSetFingerprint: "tool-fingerprint",
    systemPromptVersion: "2",
    globalInstructionsHash: "global",
    projectInstructionsHash: "project",
    skillCatalogHash: "skills",
};

function resolved(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
    return {
        provider: "openai",
        providerId: "openai",
        modelId: "gpt-5.5",
        protocol: "openai-responses",
        endpoint: "https://api.openai.com/v1/responses",
        auth: { type: "api-key", value: "test" },
        ...overrides,
    };
}

describe("provider runtime", () => {
    test("compiles OpenAI cache identity without provider-owned session state", () => {
        const compiled = compileProviderRequest({ resolvedModel: resolved(), mode: "BUILD", prefixIdentity });
        expect(compiled).toEqual({
            protocol: "openai-responses",
            cacheKey: "more-more-code:prefix-fingerprint",
        });
        expect(JSON.stringify(compiled)).not.toContain("previous_response_id");
    });

    test("normalizes cache usage into provider diagnostics", () => {
        const telemetry = createProviderCacheTelemetry({
            resolvedModel: resolved(),
            prefixIdentity,
            usage: {
                inputTokens: 120,
                inputNoCacheTokens: 40,
                cacheReadTokens: 80,
                cacheWriteTokens: 24,
                outputTokens: 30,
                outputTextTokens: 20,
                outputReasoningTokens: 10,
            },
        });
        expect(telemetry).toMatchObject({
            provider: "openai",
            providerKind: "openai",
            inputTokens: 120,
            outputTokens: 30,
            cachedPromptTokens: 80,
            cacheWriteTokens: 24,
            promptPrefixFingerprint: "prefix-fingerprint",
            toolSetFingerprint: "tool-fingerprint",
        });
    });

    test("uses the resolved native protocol for non-OpenAI providers", () => {
        const model = resolved({
            provider: "deepseek",
            providerId: "deepseek",
            modelId: "deepseek-v4-flash",
            protocol: "openai-chat-completions",
            endpoint: "https://api.deepseek.com/chat/completions",
            modelOptions: { reasoningEffort: "medium" },
        });
        const compiled = compileProviderRequest({ resolvedModel: model, mode: "PLAN", prefixIdentity });
        expect(compiled).toEqual({ protocol: "openai-chat-completions" });
    });
});
