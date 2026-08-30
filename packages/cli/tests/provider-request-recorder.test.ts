import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedModel } from "../src/lib/models";
import type { NativeModelRequest } from "../src/lib/provider-native-protocol";
import {
    recordProviderRequestContext,
    resetProviderRequestRecorderForTests,
} from "../src/lib/provider-request-recorder";

const originalEnabled = process.env.MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT;
const originalDirectory = process.env.MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await resetProviderRequestRecorderForTests();
    if (originalEnabled === undefined) delete process.env.MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT;
    else process.env.MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT = originalEnabled;
    if (originalDirectory === undefined) delete process.env.MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR;
    else process.env.MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR = originalDirectory;
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function model(): ResolvedModel {
    return {
        provider: "deepseek",
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        protocol: "openai-chat-completions",
        endpoint: "https://provider.invalid/chat/completions",
        auth: { type: "api-key", value: "must-not-be-recorded" },
    };
}

function request(): NativeModelRequest {
    return {
        system: "system-secret-context",
        messages: [{ role: "user", content: [{ type: "text", text: "complete user context" }] }],
        tools: [{
            name: "readFile",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
        }],
        prefixIdentity: {
            fingerprint: "prefix-fingerprint",
            toolSetFingerprint: "tool-fingerprint",
            systemPromptVersion: "2",
            globalInstructionsHash: "global",
            projectInstructionsHash: "project",
            skillCatalogHash: "skills",
        },
        cacheRetention: "short",
    };
}

describe("temporary Provider request recorder", () => {
    test("does nothing while disabled", async () => {
        delete process.env.MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT;
        const result = await recordProviderRequestContext({
            model: model(),
            request: request(),
            wireBodyText: "{\"messages\":[]}",
        });
        expect(result).toBeNull();
    });

    test("writes exact wire bytes and metadata without credentials when enabled", async () => {
        const directory = await mkdtemp(join(tmpdir(), "more-more-code-provider-context-"));
        temporaryDirectories.push(directory);
        process.env.MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT = "1";
        process.env.MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR = directory;
        const wireBodyText = JSON.stringify({
            model: "deepseek-v4-flash",
            messages: [
                { role: "system", content: "system-secret-context" },
                { role: "user", content: "complete user context" },
            ],
            tools: [{ type: "function", function: { name: "readFile" } }],
        });

        const result = await recordProviderRequestContext({
            model: model(),
            request: request(),
            wireBodyText,
        });
        expect(result).not.toBeNull();
        const sessionDirectories = await readdir(directory);
        expect(sessionDirectories).toHaveLength(1);
        const sessionDirectory = join(directory, sessionDirectories[0]!);
        const files = await readdir(sessionDirectory);
        const requestFile = files.find((file) => file.endsWith(".request.json"));
        const metadataFile = files.find((file) => file.endsWith(".meta.json"));
        expect(requestFile).toBeTruthy();
        expect(metadataFile).toBeTruthy();
        expect(files).toContain("manifest.jsonl");

        const recordedWire = await readFile(join(sessionDirectory, requestFile!), "utf8");
        expect(recordedWire).toBe(wireBodyText);

        const metadataText = await readFile(join(sessionDirectory, metadataFile!), "utf8");
        expect(metadataText).toContain("prefix-fingerprint");
        expect(metadataText).not.toContain("must-not-be-recorded");
        const manifest = await readFile(join(sessionDirectory, "manifest.jsonl"), "utf8");
        expect(manifest.trim().split("\n")).toHaveLength(1);
    });
});
