import { describe, expect, test } from "bun:test";
import type { LanguageModel } from "ai";
import type { PromptPrefixIdentity } from "../src/lib/cache-identity";
import type { ResolvedModel } from "../src/lib/models";
import {
    compileProviderRequest,
    createProviderCacheTelemetry,
} from "../src/lib/provider-runtime";

const prefixIdentity: PromptPrefixIdentity = {
    fingerprint: "prefix-fingerprint",
    toolSetFingerprint: "tool-fingerprint",
    systemPromptVersion: "2",
    globalInstructionsHash: "global",
    projectInstructionsHash: "project",
    skillCatalogHash: "skills",
};

describe("provider runtime", () => {
    test("compiles OpenAI through Responses options without provider-owned session state", () => {
        const resolvedModel: ResolvedModel = {
            model: {} as LanguageModel,
            provider: "openai",
            providerId: "openai",
            modelId: "gpt-5.5",
            providerOptions: {
                openai: { store: false },
            },
        };

        const compiled = compileProviderRequest({
            resolvedModel,
            mode: "BUILD",
            prefixIdentity,
        });
        const openai = compiled.providerOptions?.openai as Record<string, unknown>;

        expect(compiled.protocol).toBe("openai-responses");
        expect(openai.promptCacheKey).toBe("more-more-code:prefix-fingerprint");
        expect(openai.store).toBe(false);
        expect(openai.previousResponseId).toBeUndefined();
    });

    test("normalizes cache usage into provider diagnostics", () => {
        const resolvedModel: ResolvedModel = {
            model: {} as LanguageModel,
            provider: "openai",
            providerId: "openai",
            modelId: "gpt-5.5",
        };
        const telemetry = createProviderCacheTelemetry({
            resolvedModel,
            prefixIdentity,
            usage: {
                inputTokens: 120,
                inputTokenDetails: {
                    noCacheTokens: 40,
                    cacheReadTokens: 80,
                    cacheWriteTokens: 24,
                },
                outputTokens: 30,
                outputTokenDetails: {
                    textTokens: 20,
                    reasoningTokens: 10,
                },
                totalTokens: 150,
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

    test("leaves non-OpenAI providers on their native provider options", () => {
        const resolvedModel: ResolvedModel = {
            model: {} as LanguageModel,
            provider: "deepseek",
            providerId: "deepseek",
            modelId: "deepseek-v4-flash",
            providerOptions: {
                deepseek: { reasoningEffort: "medium" },
            },
        };

        const compiled = compileProviderRequest({
            resolvedModel,
            mode: "PLAN",
            prefixIdentity,
        });

        expect(compiled.protocol).toBe("provider-default");
        expect(compiled.providerOptions).toEqual(resolvedModel.providerOptions);
    });
});
