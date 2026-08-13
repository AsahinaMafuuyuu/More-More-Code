# Implementation Plan: Stage 5 — Context & Provider Runtime

**Status:** Completed on 2026-08-13. All implementation, focused tests, typechecks, and CLI/Server builds pass.

## Overview

Stage 5 focuses on cache-aware context construction and provider-specific model execution.

The goal is to evolve the existing Context Manager from a token-budget projection layer into a deterministic Context Runtime that controls context ordering, prefix-cache stability, compaction checkpoint reuse, provider request compilation, and cache telemetry.

MCP Runtime, Permission Engine, Sandbox, WAL, and Subagent Runtime are explicitly out of scope for this stage.

## Architecture Decisions

- Context is ordered from most stable to most dynamic to maximize prefix-cache reuse.
- Canonical Context remains provider-independent.
- Provider-specific behavior is implemented behind Provider Adapters / Compilers.
- OpenAI uses `OpenAIResponsesAdapter` while retaining Vercel AI SDK for streaming, tool-call integration, and UI message normalization.
- OpenAI Responses API is the execution protocol, but OpenAI server-side conversation state is not the canonical MORE-MORE-CODE Session state.
- Compaction checkpoints are reused instead of regenerating summaries every Model Step.
- Tool definitions are deterministic and contribute to the prompt-prefix fingerprint.
- PLAN and BUILD have independent cache families because their exposed Tool Sets differ.
- MCP, Permission, Sandbox, tool cancellation, and WAL remain deferred.

## Canonical Context Order

Every Model Step should compile context in this order:

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

General rule:

```text
most stable
    ↓
semi-stable
    ↓
append-only history
    ↓
most dynamic
```

Stable sections must use deterministic ordering and serialization.

## Phase 1: Canonical Context Model

### Task 1: Define Context Record categories and stability classes

**Description:** Extend the current Context model so records explicitly describe semantic role and cache stability.

**Acceptance criteria:**

- Stable, historical, retained-tail, and dynamic records are distinguishable.
- Ordering rules are deterministic.
- Provider-specific fields do not enter canonical Context records.

**Verification:**

- Unit tests verify deterministic ordering.
- Existing Context tests continue to pass.

### Task 2: Implement deterministic Context Compiler ordering

**Description:** Compile canonical Context records according to the fixed stable-to-dynamic ordering.

**Acceptance criteria:**

- Stable prefix always precedes historical and dynamic content.
- Skill metadata and tools use deterministic sorting.
- Equivalent Agent Environments produce byte-stable prefix input.

**Dependencies:** Task 1

## Checkpoint: Canonical Context

- Context ordering tests pass.
- Existing compaction behavior remains non-destructive.
- No provider-specific logic exists inside ContextManager.

## Phase 2: Prefix Cache Identity

### Task 3: Add ToolSetSnapshot and ToolSetFingerprint

**Description:** Produce a deterministic snapshot of model-visible tools for each Model Step.

Fingerprint inputs should include:

```text
tool name
source
description
input schema
mode availability
```

PLAN and BUILD must naturally produce different fingerprints.

### Task 4: Add PromptPrefixFingerprint

**Description:** Create a deterministic identity for the stable prompt prefix.

Initial fingerprint inputs:

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

The fingerprint should be suitable for deriving provider cache keys.

**Dependencies:** Tasks 2, 3

## Phase 3: Compaction Checkpoint Reuse

### Task 5: Reuse persisted compaction checkpoints

**Description:** Stop regenerating an equivalent summary on every projection after compaction.

Expected behavior:

```text
Stable Prefix
+
Existing Compaction Checkpoint
+
Newer Turns
```

until another compaction threshold is actually reached.

**Acceptance criteria:**

- A persisted checkpoint remains stable across subsequent Model Steps.
- New turns append after the checkpoint.
- A new checkpoint is produced only when another real compaction occurs.
- Original Session Entries remain unchanged.

## Checkpoint: Cache-Stable Context

- Repeated Model Steps preserve the longest possible stable prefix.
- Compaction checkpoint tests cover append-after-compaction behavior.
- Token-budget constraints remain valid.

## Phase 4: Provider Runtime

### Task 6: Introduce Provider Adapter boundary

Target structure:

```text
Canonical Context Projection
        ↓
Provider Runtime
        ├── OpenAIResponsesAdapter
        ├── AnthropicAdapter
        └── DeepSeekAdapter
```

Provider adapters translate canonical model input into provider-specific execution configuration without modifying Session or Context semantics.

### Task 7: Implement OpenAIResponsesAdapter

Use:

```text
Vercel AI SDK
+
@ai-sdk/openai
+
openai.responses(...)
```

Responsibilities:

- select OpenAI Responses model;
- configure provider-specific Responses options;
- derive/use prompt cache key;
- expose reasoning configuration;
- collect Responses/cache metadata;
- keep streaming through Vercel AI SDK.

Do not make `previous_response_id` the canonical session mechanism in this stage.

**Dependencies:** Tasks 4, 6

## Phase 5: Cache Telemetry

### Task 8: Record provider cache metrics

Expose at minimum when available:

```text
input tokens
output tokens
cached prompt tokens
cache write tokens
prompt prefix fingerprint
tool set fingerprint
provider/model
```

Telemetry should be observable without becoming canonical Session semantic history unless explicitly projected into a future diagnostics layer.

## Final Verification

- Harness tests pass.
- CLI tests pass.
- CLI / Harness / Server typecheck passes.
- CLI / Server build passes.
- Context ordering is deterministic.
- Prefix fingerprints are deterministic.
- OpenAI uses explicit Responses API adapter semantics.
- Existing Session Tree and AgentLoop behavior remains unchanged.

## Deferred

```text
MCP Runtime
Permission Engine
Sandbox
Tool cancellation
Local WAL / Crash Recovery
Cloud revision/conflict sync
Subagent Runtime
OpenAI server-side conversation as Session authority
```
