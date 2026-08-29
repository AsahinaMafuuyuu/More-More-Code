# ADR-0010: Cache-Aware Context Ordering and Provider Runtime Boundary

> **Execution-layer note (2026-08-28):** ADR-0031 supersedes the Vercel AI SDK execution/streaming portion of this ADR. The provider-independent Context ordering, prompt-prefix identity, cache-family separation, checkpoint reuse and Provider Runtime boundary defined here remain active.

## Status

Accepted

Provider request-compilation/cache boundaries remain valid. Provider identity/model catalog/authentication configuration is further refined by ADR-0023.

## Date

2026-08-13

## Context

MORE-MORE-CODE already separates Session Entries, Context Projection, Message/UI Projection, Runtime State Projection, and the local-first Agent Loop. Stage 4 also introduced deterministic agent bootstrap sources for system instructions, project instructions, skills, and native tool contracts.

The existing Context Manager is still primarily a token-budget projection layer. That is sufficient for selecting history, but it does not yet define a cache-stable ordering contract, deterministic prompt-prefix identity, persisted compaction-checkpoint reuse, or a provider-specific request compilation boundary.

This becomes important when using provider prompt caching. Stable instructions, skill metadata, and tool definitions should remain byte-stable and appear before dynamic conversation content so repeated Model Steps can reuse the longest possible prefix. At the same time, provider-specific fields such as OpenAI Responses options, cache keys, reasoning configuration, and provider telemetry must not leak into canonical Session or Context semantics.

## Decision

### Canonical Context is ordered from stable to dynamic

Every Model Step compiles canonical context in this order:

```text
1. Core Coding Agent System Prompt
2. Global AGENTS.md
3. Project AGENTS.md
4. Skill Catalog Metadata
5. Tool Definitions / Schemas
--------------------------------
   Stable Prefix Boundary
--------------------------------
6. Persisted Compaction Checkpoint
7. Historical Conversation
8. Retained Recent Complete Turns
9. Current Tool Results / Runtime Continuation
10. Current User / Steering / Follow-up Input
```

Stable collections such as skill descriptors and model-visible tool definitions use deterministic ordering and serialization. Equivalent Agent Environments should therefore produce equivalent stable prefix input.

### Prompt-prefix identity is explicit

The runtime will derive deterministic identities for both the exposed Tool Set and the stable prompt prefix.

`ToolSetFingerprint` includes the model-visible tool contract, including tool name, source, description, input schema, and mode availability. Because PLAN and BUILD expose different capabilities, they naturally form different cache families.

`PromptPrefixFingerprint` includes at least:

```text
provider
model
systemPromptVersion
globalInstructionsHash
projectInstructionsHash
skillCatalogHash
toolSetFingerprint
mode
```

Provider adapters may derive provider-specific cache keys from this canonical identity.

### Persisted compaction checkpoints are reused

A compaction checkpoint is part of the canonical projected history after it has been persisted. Subsequent Model Steps reuse the existing checkpoint and append newer complete turns after it.

The runtime does not regenerate an equivalent summary on every projection. A new checkpoint is produced only when another real compaction threshold is reached. Original Session Entries remain unchanged.

### Aggregate Tool pressure creates a checkpoint instead of rewriting cached history

Individual oversized Tool Results receive deterministic bounded model-facing projections. However, many individually reasonable Tool Results can still grow into a large aggregate working set. Retroactively truncating those already-sent results when later Tool Results arrive would change historical Provider message bytes and destroy an otherwise reusable prefix.

The runtime therefore treats aggregate Tool working-set pressure as an explicit `tool-pressure` compaction trigger. When the active Tool Result working set exceeds its configured share of the effective input budget:

1. already-persisted Session Entries remain untouched;
2. old model-facing Tool Results are not rewritten in place;
3. compactable historical Turns are absorbed into one persisted Context checkpoint;
4. the Provider prefix is intentionally rebased once at that checkpoint;
5. later Model Steps reuse that checkpoint and only account active post-checkpoint Tool Results toward Tool working-set pressure.

This chooses one explicit cache-boundary change over continuous historical prompt mutation.

When automatic semantic compaction performs an auxiliary Provider request before the primary Model request, its Provider-reported token usage is aggregated with the primary request into the Model Step's single durable Usage/Cost fact. Missing usage buckets remain missing rather than being inferred across requests. Provider cache telemetry shown for the latest request continues to describe the primary request rather than the auxiliary reducer request.

### Provider-specific execution is isolated behind adapters

Provider execution is compiled through a dedicated boundary:

```text
Canonical Context Projection
        ↓
Provider Runtime
        ├── OpenAIResponsesAdapter
        ├── AnthropicAdapter
        └── DeepSeekAdapter
```

Canonical Context remains provider-independent. Provider adapters translate canonical model input into provider-specific request configuration and collect provider-specific response metadata without redefining Session semantics.

For historical Stage 5, OpenAI used an `OpenAIResponsesAdapter` while retaining Vercel AI SDK for streaming and unified message/tool integration. ADR-0031 later replaced that execution surface with native provider transports. OpenAI Responses API remains the provider execution protocol, and OpenAI server-side conversation state is not the canonical MORE-MORE-CODE Session authority.

`previous_response_id` may be considered later as an optimization or provider-local continuation mechanism, but it does not replace the Session Entry Tree in this stage.

### Cache telemetry is diagnostic data, not semantic history

When available, provider execution records diagnostics such as:

```text
input tokens
output tokens
cached prompt tokens
cache write tokens
prompt prefix fingerprint
tool set fingerprint
provider/model
```

These values remain runtime/diagnostic telemetry unless a future explicit projection layer promotes them into persistent observability data. They do not become semantic Session Entries by default.

## Alternatives Considered

### Let each provider build its own context directly from Session history

- Pros: minimal shared compiler work.
- Cons: ordering, compaction semantics, tool exposure, and cache behavior would diverge between providers.
- Rejected: canonical Context must remain the single provider-independent semantic projection.

### Put OpenAI cache and Responses fields directly into ContextManager

- Pros: fewer abstractions initially.
- Cons: couples canonical context semantics to one provider and makes Anthropic/DeepSeek behavior harder to reason about.
- Rejected: provider-specific request fields belong behind provider adapters.

### Use OpenAI `previous_response_id` as the primary Session mechanism

- Pros: less client-side history compilation for OpenAI-only execution.
- Cons: makes the provider conversation state authoritative, conflicts with the local-first Session Entry Tree, and complicates branching, replay, provider switching, and cloud persistence semantics.
- Rejected: MORE-MORE-CODE Session state remains provider-independent and locally controlled.

### Regenerate the compaction summary before every Model Step

- Pros: summary can incorporate the newest context every time.
- Cons: changes the prompt prefix unnecessarily, spends model work repeatedly, and reduces cache reuse even when the compacted history has not changed.
- Rejected: persisted checkpoints are reused until another real compaction event occurs.

## Implementation Status

Implemented on 2026-08-13.

- Harness Context Records now expose canonical category/stability semantics and deterministic stable-to-dynamic compilation.
- CLI Tool Registry produces deterministic mode-aware ToolSet snapshots; ToolSet and PromptPrefix fingerprints are SHA-256 identities over stable serialized inputs.
- Persisted `compaction` Session Entries are reused as Context checkpoints across later Model Steps and restored sessions; replacement occurs only after a new real compaction.
- OpenAI model resolution explicitly selects `openai.responses(...)`; `OpenAIResponsesAdapter` derives `promptCacheKey` from the prompt-prefix fingerprint and does not set `previousResponseId`.
- Provider cache usage is normalized into runtime telemetry (`cacheReadTokens` / `cacheWriteTokens`) without becoming Session semantic history.
- Aggregate Tool Result pressure can now create a durable `tool-pressure` checkpoint without retroactively changing old Tool Result bytes; already-compacted Tool Results are removed from the active working-set pressure calculation.
- Automatic semantic-compaction Provider usage is included in the owning Model Step Usage/Cost aggregation so Context maintenance cannot become hidden Provider spend.
- Harness + CLI tests, Harness/Shared/CLI/Server typechecks, and CLI/Server builds pass.

## Consequences

- Context compilation gains a deterministic stable-to-dynamic ordering contract.
- Stable skill/tool/instruction sections can maximize provider prefix-cache reuse.
- PLAN and BUILD use distinct cache identities when their exposed tools differ.
- Persisted compaction checkpoints remain stable across later Model Steps.
- Provider-specific Responses/cache/reasoning options do not contaminate canonical Context or Session records.
- Historical Stage 5 used Vercel AI SDK as the common streaming/tool integration surface; ADR-0031 supersedes this implementation choice.
- Cache usage can be diagnosed through explicit fingerprints and provider telemetry.
- MCP Runtime, Permission Engine, Sandbox, tool cancellation, WAL/crash recovery, cloud revision/conflict sync, Subagent Runtime, and provider-owned Session authority remain deferred.
