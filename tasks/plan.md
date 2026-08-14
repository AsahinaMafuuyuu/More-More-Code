# Implementation Plan: Stage 5.1 + Stage 6 — Session Semantics & Tool Runtime

**Status:** Delivered — 2026-08-13. Stage 5.1, Stage 6, and the Stage 6.1 native-shell cancellation follow-up are implemented and verified.

## Overview

This delivery first locks the Session/Context invariants agreed after Stage 5, then introduces a first-class local Tool Runtime between AgentLoop and native tool implementations. The Server remains persistence-only. MCP transport, OS-level sandboxing, WAL, cloud conflict resolution, and Subagent Runtime remain out of scope.

## Architecture Decisions

- Session history is an append-only semantic tree. New entries are appended as children of the current `activeEntry`; existing entries are never rewritten in place.
- A newer compaction checkpoint supersedes older checkpoints for model context projection while every historical compaction entry remains in the Session Tree.
- Session restore restores durable `Tree + activeEntry`; messages, runtime state, and latest compaction checkpoint are projections of that branch.
- Session-tree event colors and timestamp colors are semantic theme tokens, not hard-coded UI colors.
- AgentLoop decides when a tool step runs; Tool Runtime decides whether and how the tool executes, how cancellation/timeout is propagated, and how execution status is normalized.
- Native tools are the first Tool Runtime executor. MCP remains a future executor/source adapter.
- Permission policy is introduced as an interface with `allow | deny | ask`; this stage ships deterministic local policy enforcement but not an interactive approval UI or OS sandbox.

## Phase 1: Stage 5.1 Semantic Lock

### Task 1: Lock compaction supersession semantics

**Acceptance criteria:**
- `compact2` compacts the previous checkpoint plus newly compacted history.
- Context projection contains only the latest effective checkpoint plus post-checkpoint history.
- Old compaction entries remain in Session Tree history.

**Verification:** focused Context and Session Tree tests.

### Task 2: Lock append-only Session Tree / restore semantics

**Acceptance criteria:**
- Appending after a historical jump creates a child branch without modifying prior entries.
- Restore preserves `activeEntryId` and derives branch messages/runtime/latest checkpoint from projections.

**Verification:** Session Tree tests.

### Task 3: Add semantic Session UI theme tokens

**Acceptance criteria:**
- Session message/tool/compaction/state/branch/error/custom and timestamp colors live in `ThemeColors`.
- Session Tree UI maps entry semantics to theme tokens and contains no hard-coded event colors.

**Verification:** CLI typecheck/build.

## Checkpoint: Session Semantics

- Context + Session Tree tests pass.
- Theme typecheck passes.

## Phase 2: Stage 6 Tool Runtime Foundation

### Task 4: Introduce Tool Runtime contracts

Define provider-independent execution types for:
- Tool capability metadata;
- execution context (`sessionId/runId/turnId/stepId/workspaceRoot/mode/signal`);
- permission decisions;
- normalized execution results and telemetry;
- executor/source boundary.

### Task 5: Adapt native tools to the Runtime

**Acceptance criteria:**
- Native implementations no longer own mode policy.
- Tool Runtime validates visibility through Tool Registry.
- Native filesystem/shell tools receive the runtime AbortSignal.
- Native `bash` execution uses the runtime workspace root and aborts its active shell process/output readers when the Run is interrupted.
- Bash-specific timeout input is resolved by Tool Runtime rather than a second native timer.
- Tool-level timeout and cancellation produce normalized statuses.

### Task 6: Wire AgentLoop tool steps through Tool Runtime

**Acceptance criteria:**
- `use-chat` no longer calls `executeLocalTool` directly.
- AgentLoop `context.signal` reaches the Tool Runtime.
- Session `tool_result` captures normalized status/duration while preserving output/error compatibility.

## Checkpoint: Tool Runtime

- Runtime unit tests cover allow/deny/ask, completion, failure, cancellation, and timeout.
- AgentLoop interruption can cancel an active native shell tool.
- Existing AgentLoop behavior remains unchanged.

## Phase 3: Documentation & Delivery

### Task 7: Record architecture decision and current state

- Add ADR for Session semantic invariants + Tool Runtime boundary.
- Update README, CONTEXT, CHANGELOG, current-state notes, and project Agent rules where relevant.

### Task 8: Final verification

- Harness tests pass.
- CLI tests pass.
- Shared/Harness/CLI/Server typechecks pass.
- CLI/Server builds pass.
- `git diff --check` has no whitespace errors.

## Deferred

```text
MCP transport / remote tool execution
Interactive permission approval UI
OS-level Sandbox enforcement
Local WAL / crash recovery
Cloud revision/conflict sync
Subagent Runtime
OpenAI server-side conversation as Session authority
```

---

# Follow-up Plan: Stage 5.2 — Semantic Context Compaction

**Status:** Delivered — 2026-08-14. Policy, semantic reducer, persistence metadata, fallback, tests, and documentation are implemented and verified.

## Overview

Upgrade the existing overflow-only deterministic chronology compaction into a budget-aware, safe-boundary, persisted semantic-state compaction pipeline. Session history remains append-only and provider-independent; only the active Context Projection is replaced by the latest checkpoint plus raw retained history.

## Architecture Decisions

- Compaction is an incremental state reduction: `snapshot(N+1) = reduce(snapshot(N) + newly compacted history)`.
- The reducer produces a complete replacement snapshot, not an appended delta or a summary-of-summary chronology.
- Compaction may trigger before hard overflow using soft/hard utilization thresholds; after compaction the retained working set targets a lower utilization band to avoid thrashing.
- Cut points operate on atomic Context groups/turns. Tool/message groups are never split to satisfy a token boundary.
- The Harness owns generic budgeting, trigger policy, source selection, and compaction metadata; the CLI/provider boundary owns LLM semantic reduction.
- If semantic reduction fails, the request falls back to the bounded deterministic compactor rather than losing the current model step.
- Branch Summary remains a separate knowledge-transfer mechanism and is not implemented as Compaction.

## Phase 1: Generic Compaction Policy

### Task 1: Add soft/hard budget policy and safe source selection

**Acceptance criteria:**
- A projection below the soft threshold reuses its current checkpoint and performs no compaction.
- A projection above the soft threshold can compact older optional complete groups before hard overflow.
- Required/retained groups remain atomic and survive the cut; the target utilization leaves post-compaction headroom.

**Verification:** focused Harness ContextManager tests.

### Task 2: Enrich compaction results/checkpoint metadata

**Acceptance criteria:**
- Compaction reports trigger reason, token counts, compacted-through identity, and retained identities without mutating source history.
- Existing checkpoint replacement semantics remain backward compatible.

**Verification:** Harness + Session Tree tests.

## Phase 2: Semantic State Reducer

### Task 3: Add CLI semantic compactor

**Acceptance criteria:**
- The compactor receives the previous checkpoint plus newly compacted records.
- It requests a fixed structured Markdown state snapshot containing current goal/state, decisions, constraints, artifacts, failures, and pending work.
- The prompt explicitly removes superseded facts and produces a complete replacement snapshot.
- Output is bounded by the summary token budget.

**Verification:** focused unit tests for serialization/prompt/fallback plus CLI build.

### Task 4: Preserve deterministic fallback

**Acceptance criteria:**
- Provider/reducer failure does not fail the primary model request when deterministic fallback can produce a valid bounded checkpoint.
- Existing deterministic compaction remains available as a fallback implementation.

## Phase 3: Persistence, Docs, Verification

### Task 5: Persist richer checkpoint metadata

Propagate compaction metadata through CLI Session Entry persistence and Server validation while retaining compatibility with older stored sessions.

### Task 6: Document the algorithm and verify

- Record an ADR for semantic compaction policy/reducer boundaries.
- Update Context/current-state/CHANGELOG documentation.
- Run Harness tests, focused CLI tests, CLI build/typecheck-equivalent checks, Server validation tests/typecheck where available, and `git diff --check`.

## Deferred

- Working-set relevance scoring beyond recent complete turns.
- Tool-result pruning/reference storage.
- Exact tokenizer packages for every provider/model family.
- Branch-summary semantic transfer algorithm.
- Provider-specific compaction model selection or dedicated low-cost summarizer configuration.
