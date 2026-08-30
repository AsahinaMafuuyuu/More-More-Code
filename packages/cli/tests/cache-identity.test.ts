import { describe, expect, test } from "bun:test";
import {
  classifyCacheMiss,
  createContextEpochId,
  createPromptPrefixIdentity,
  createRenderedPrefixDigest,
} from "../src/lib/cache-identity";

const toolSetSnapshot = [{
  name: "readFile",
  source: "native" as const,
  description: "Read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  capabilities: ["filesystem.read" as const],
  executionSafety: { parallelSafe: true, effect: "read" as const },
  availableModes: ["PLAN" as const, "BUILD" as const],
}];

function family() {
  return createPromptPrefixIdentity({
    provider: "openai",
    model: "gpt-5.6-sol",
    mode: "BUILD",
    systemPromptVersion: "v1",
    globalInstructions: "global",
    projectInstructions: "project",
    skillCatalog: "skills",
    toolSetSnapshot,
  });
}

describe("cache identities", () => {
  test("keeps one cache family id for semantically identical stable inputs", () => {
    const first = family();
    const second = family();
    expect(first.cacheFamilyId).toBe(second.cacheFamilyId);
    expect(first.fingerprint).toBe(first.cacheFamilyId);
  });

  test("changes family when the tool schema changes", () => {
    const first = family();
    const second = createPromptPrefixIdentity({
      provider: "openai",
      model: "gpt-5.6-sol",
      mode: "BUILD",
      systemPromptVersion: "v1",
      globalInstructions: "global",
      projectInstructions: "project",
      skillCatalog: "skills",
      toolSetSnapshot: [{
        ...toolSetSnapshot[0]!,
        inputSchema: { type: "object", properties: { path: { type: "number" } } },
      }],
    });
    expect(second.cacheFamilyId).not.toBe(first.cacheFamilyId);
  });

  test("creates branch-local genesis epochs and durable checkpoint epochs", () => {
    expect(createContextEpochId({ branchIdentity: "session:a/path:root" }))
      .toMatch(/^genesis:/);
    expect(createContextEpochId({ branchIdentity: "ignored", checkpointEntryId: "entry-42" }))
      .toBe("checkpoint:entry-42");
  });

  test("digests rendered prefix bytes deterministically", () => {
    const first = createRenderedPrefixDigest({
      renderedPrefix: { system: "s", messages: [{ role: "user", content: "x" }] },
      breakpointKind: "conversation",
    });
    const second = createRenderedPrefixDigest({
      renderedPrefix: { messages: [{ content: "x", role: "user" }], system: "s" },
      breakpointKind: "conversation",
    });
    expect(second.digest).toBe(first.digest);
    expect(first.bytes).toBeGreaterThan(0);
  });

  test("distinguishes epoch rebase from same-epoch mutation and provider miss", () => {
    const cacheFamilyId = family().cacheFamilyId;
    const previous = {
      cacheFamilyId,
      contextEpochId: "checkpoint:one" as const,
      renderedPrefixDigest: "aaa",
    };
    expect(classifyCacheMiss({
      previous,
      current: {
        cacheFamilyId,
        contextEpochId: "checkpoint:two",
        renderedPrefixDigest: "bbb",
        cacheReadTokens: 0,
      },
    })).toBe("epoch-rebase");
    expect(classifyCacheMiss({
      previous,
      current: {
        cacheFamilyId,
        contextEpochId: "checkpoint:one",
        renderedPrefixDigest: "bbb",
        cacheReadTokens: 0,
      },
    })).toBe("same-epoch-prefix-mutation");
    expect(classifyCacheMiss({
      previous,
      current: {
        cacheFamilyId,
        contextEpochId: "checkpoint:one",
        renderedPrefixDigest: "aaa",
        cacheReadTokens: 0,
      },
    })).toBe("provider-cache-miss");
    expect(classifyCacheMiss({
      previous,
      current: {
        cacheFamilyId,
        contextEpochId: "checkpoint:one",
        renderedPrefixDigest: "aaa",
        cacheReadTokens: 10,
      },
    })).toBe("cache-hit");
  });
});
