import { createHash } from "node:crypto";
import type { ModeType, ProviderId } from "@more-more-code/shared";
import type { ToolSetSnapshot } from "./tool-registry";

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, normalize(item)]),
        );
    }
    return value;
}

export function stableSerialize(value: unknown) {
    return JSON.stringify(normalize(value));
}

export function sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

export function createToolSetFingerprint(snapshot: ToolSetSnapshot) {
    return sha256(stableSerialize(snapshot));
}

export type PromptPrefixIdentity = {
    fingerprint: string;
    toolSetFingerprint: string;
    systemPromptVersion: string;
    globalInstructionsHash: string;
    projectInstructionsHash: string;
    skillCatalogHash: string;
};

export function createPromptPrefixIdentity(input: {
    provider: ProviderId;
    model: string;
    mode: ModeType;
    systemPromptVersion: string;
    globalInstructions: string;
    projectInstructions: string;
    skillCatalog: string;
    toolSetSnapshot: ToolSetSnapshot;
}): PromptPrefixIdentity {
    const toolSetFingerprint = createToolSetFingerprint(input.toolSetSnapshot);
    const identity = {
        provider: input.provider,
        model: input.model,
        mode: input.mode,
        systemPromptVersion: input.systemPromptVersion,
        globalInstructionsHash: sha256(input.globalInstructions),
        projectInstructionsHash: sha256(input.projectInstructions),
        skillCatalogHash: sha256(input.skillCatalog),
        toolSetFingerprint,
    };

    return {
        ...identity,
        fingerprint: sha256(stableSerialize(identity)),
    };
}
