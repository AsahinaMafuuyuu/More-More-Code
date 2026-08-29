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

export const CACHE_FAMILY_SCHEMA_VERSION = 2;

export type CacheFamilyIdentity = {
    /** Stable routing/diagnostic identity for one immutable agent prompt family. */
    cacheFamilyId: string;
    /** @deprecated Compatibility alias. Use cacheFamilyId for new diagnostics. */
    fingerprint: string;
    toolSetFingerprint: string;
    systemPromptVersion: string;
    globalInstructionsHash: string;
    projectInstructionsHash: string;
    skillCatalogHash: string;
};

/**
 * Compatibility shape accepted from pre-C1 callers/tests. New identities
 * created by createPromptPrefixIdentity always include cacheFamilyId.
 */
export type PromptPrefixIdentity = Omit<CacheFamilyIdentity, "cacheFamilyId"> & {
    cacheFamilyId?: string;
};

export type ContextEpochId = `genesis:${string}` | `checkpoint:${string}`;

export type RenderedPrefixDigest = {
    digest: string;
    bytes: number;
    breakpointKind: "stable-prefix" | "tool-batch" | "conversation";
    breakpointId?: string;
};

export type CacheMissClassification =
    | "cache-hit"
    | "cache-family-change"
    | "epoch-rebase"
    | "same-epoch-prefix-mutation"
    | "provider-cache-miss"
    | "insufficient-telemetry";

export function createPromptPrefixIdentity(input: {
    provider: ProviderId;
    model: string;
    mode: ModeType;
    systemPromptVersion: string;
    globalInstructions: string;
    projectInstructions: string;
    skillCatalog: string;
    toolSetSnapshot: ToolSetSnapshot;
}): CacheFamilyIdentity {
    const toolSetFingerprint = createToolSetFingerprint(input.toolSetSnapshot);
    const identity = {
        schemaVersion: CACHE_FAMILY_SCHEMA_VERSION,
        provider: input.provider,
        model: input.model,
        mode: input.mode,
        systemPromptVersion: input.systemPromptVersion,
        globalInstructionsHash: sha256(input.globalInstructions),
        projectInstructionsHash: sha256(input.projectInstructions),
        skillCatalogHash: sha256(input.skillCatalog),
        toolSetFingerprint,
    };

    const cacheFamilyId = sha256(stableSerialize(identity));
    return {
        ...identity,
        cacheFamilyId,
        fingerprint: cacheFamilyId,
    };
}

export function createContextEpochId(input: {
    branchIdentity: string;
    checkpointEntryId?: string | null;
}): ContextEpochId {
    return input.checkpointEntryId
        ? `checkpoint:${input.checkpointEntryId}`
        : `genesis:${sha256(input.branchIdentity).slice(0, 24)}`;
}

export function createRenderedPrefixDigest(input: {
    renderedPrefix: unknown;
    breakpointKind: RenderedPrefixDigest["breakpointKind"];
    breakpointId?: string;
}): RenderedPrefixDigest {
    const serialized = typeof input.renderedPrefix === "string"
        ? input.renderedPrefix
        : stableSerialize(input.renderedPrefix);
    return {
        digest: sha256(serialized),
        bytes: Buffer.byteLength(serialized, "utf8"),
        breakpointKind: input.breakpointKind,
        ...(input.breakpointId ? { breakpointId: input.breakpointId } : {}),
    };
}

export function classifyCacheMiss(input: {
    previous?: {
        cacheFamilyId: string;
        contextEpochId: ContextEpochId;
        renderedPrefixDigest?: string;
    } | null;
    current: {
        cacheFamilyId: string;
        contextEpochId: ContextEpochId;
        renderedPrefixDigest?: string;
        cacheReadTokens?: number;
    };
}): CacheMissClassification {
    if ((input.current.cacheReadTokens ?? 0) > 0) return "cache-hit";
    if (!input.previous) return "insufficient-telemetry";
    if (input.previous.cacheFamilyId !== input.current.cacheFamilyId) return "cache-family-change";
    if (input.previous.contextEpochId !== input.current.contextEpochId) return "epoch-rebase";
    if (
        input.previous.renderedPrefixDigest
        && input.current.renderedPrefixDigest
        && input.previous.renderedPrefixDigest !== input.current.renderedPrefixDigest
    ) {
        return "same-epoch-prefix-mutation";
    }
    return input.current.renderedPrefixDigest ? "provider-cache-miss" : "insufficient-telemetry";
}
