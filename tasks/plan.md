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

---

# Next Plan: Stage 5.3 — Context Working Set, Tool Result Pruning & Manual Compaction

**Status:** Delivered — 2026-08-14.

## Overview

Add a dedicated working-set reduction layer for large Tool Results and expose manual compaction through `/compact`. Tool Result Pruning and historical Compaction remain separate mechanisms: pruning controls oversized local observations inside recent working context, while compaction reduces older conversational history into the persisted semantic checkpoint. The canonical Session Tree remains append-only and retains the complete Tool Result; only the model-facing Context Projection may use a bounded/full/truncated/summary/reference representation.

## Architecture Decisions

- `Session != Context`: complete Tool Results remain durable Session facts; pruning only changes the model-facing Context Projection.
- Tool Result Pruning runs before historical Compaction so one oversized recent tool observation does not repeatedly force whole-history compaction.
- Tool Call + Tool Result remain one semantic interaction. Pruning may replace the result payload shown to the model, but it must preserve tool identity, status, important output/error information, and a reference to the durable source entry.
- Fresh Tool Results receive a grace period and are kept full for the immediate tool-continuation Model Step whenever budget permits. Older/warm Tool Results become eligible for pruning under budget pressure.
- Tool Results use strategy-aware projections rather than a universal character slice: small output stays full; shell/test/build/search/file/generic results may use different bounded projections.
- A dedicated Tool Working Set budget caps how much of the active input budget may be consumed by Tool Results without deleting their durable Session payloads.
- `/compact` is a manual trigger for the existing semantic Compaction pipeline. It bypasses automatic utilization thresholds but does not bypass safe cut points, required records, retained working-set invariants, checkpoint replacement semantics, or append-only Session persistence.
- Manual compaction uses `trigger = manual`; automatic compaction continues to use `soft-limit | hard-limit | overflow`.
- If `/compact` has no eligible historical groups to reduce, it is a deterministic no-op and reports that there is nothing safely compactable instead of forcing a split inside the active working set.
- Branch Summary remains independent from both Tool Result Pruning and Compaction.

## Phase 1: Tool Result Projection Model

### Task 1: Introduce Tool Result pruning contracts

Define provider-independent Context types for Tool Result projection, including at minimum:

- projection mode: `full | truncated | summary | reference`;
- durable source/session-entry identity;
- original and projected token counts;
- tool name/status and pruning reason;
- freshness/working-set classification where needed by policy.

**Acceptance criteria:**
- The pruning interface operates on Context/Tool Result projections without mutating Session Entries.
- A projected result always retains enough metadata to associate it with its original Tool Call/Result.
- Existing Context ordering and Session restore semantics remain unchanged.

**Verification:** focused Harness unit tests for full/reference/pruned projections and immutability.

### Task 2: Add Tool Result lifecycle and working-set budget

Introduce a small lifecycle for model-visible Tool Results:

```text
fresh -> warm -> cold/reference-eligible
```

The immediate tool-continuation result should remain full when feasible; warm/older results may be pruned when the aggregate Tool Working Set exceeds its configured budget.

**Acceptance criteria:**
- Tool Result budget is derived from the effective model input budget rather than a hard-coded absolute token count.
- The newest Tool Result is not eagerly discarded before the model has had a useful continuation step.
- Budget enforcement reduces eligible older results before requesting historical Compaction.
- Required/current tool continuation can still surface `overBudget` if the non-prunable working set alone exceeds the model budget; pruning must not silently delete required state.

**Verification:** tests covering fresh grace period, multiple Tool Results, budget pressure, and an oversized required result.

## Phase 2: Strategy-aware Tool Result Pruning

### Task 3: Implement deterministic pruning strategies

Implement bounded V1 strategies before introducing an LLM Tool Result summarizer:

- **small/generic:** keep full below threshold; otherwise bounded truncation + durable reference;
- **shell:** retain command/status, useful head, error-bearing lines, and tail;
- **test/build:** retain aggregate outcome plus failures/errors/warnings and relevant nearby lines;
- **search/grep:** retain bounded top/recent matches plus file/line locations;
- **file read:** retain requested/relevant range where available and source reference instead of duplicating huge file bodies indefinitely.

**Acceptance criteria:**
- Every pruned result remains bounded by its assigned result budget.
- Failure/error information is preferred over repetitive success/noise lines.
- Tool Call/Result semantic pairing remains intact in model context.
- No pruning strategy modifies the canonical Session `tool_result.output`.

**Verification:** deterministic fixture tests for shell, tests/build, search, file, and generic results.

### Task 4: Integrate pruning before Context Compaction

Context construction order becomes conceptually:

```text
Session branch projection
  -> Tool Result working-set projection/pruning
  -> canonical Context compilation
  -> Context budget check
  -> automatic/manual historical Compaction when required
  -> provider request
```

**Acceptance criteria:**
- A large warm Tool Result can be reduced without creating a new Compaction checkpoint when pruning alone returns Context below the threshold.
- If pruning is insufficient, existing semantic Compaction runs afterward with unchanged checkpoint semantics.
- Existing stable-prefix/prompt-cache ordering remains deterministic.

**Verification:** integration tests covering prune-only, prune-then-compact, and no-prune/no-compact paths.

## Phase 3: Manual `/compact`

### Task 5: Add a manual compaction trigger to ContextManager

Extend the generic compaction trigger model with `manual` and expose an explicit request-compaction path that reuses the same safe source selection and reducer contract. Manual compaction is gated rather than unconditional: it checks meaningful compactable history, checkpoint-relative progress, and estimated savings before calling the reducer.

**Acceptance criteria:**
- Manual compaction can run below the soft utilization threshold.
- Manual compaction rejects history below `max(2048 tokens, 3% input budget)`.
- After an existing checkpoint, manual compaction requires at least 2 newly completed Turns; previously retained checkpoint-tail messages do not count as new Turns.
- Manual compaction rejects estimated savings below `max(1024 tokens, 2% input budget)` or below 30% of the replacement source.
- Repeat-compaction protection is checkpoint-progress based, not a wall-clock cooldown.
- It still preserves required records, recent retained working set, and atomic group/Turn boundaries.
- It produces the same replacement-checkpoint metadata/persistence shape as automatic compaction, with `trigger = manual`.
- Ineligible requests return typed `nothing-compactable`, `insufficient-history`, `recent-compaction`, or `insufficient-gain` no-ops before semantic reduction.

**Verification:** Harness tests for below-threshold manual compact, safe-boundary behavior, chained manual checkpoint, insufficient history, recent checkpoint progress, conservative gain, and typed no-op.

### Task 6: Add `/compact` CLI command and user feedback

Add `/compact` to the command surface and route it through the active Session/Context runtime rather than duplicating summary logic in the command handler.

Expected behavior:

```text
/compact
  -> project current active branch
  -> request manual compaction
  -> semantic reducer / deterministic fallback
  -> append compaction Session Entry when changed
  -> refresh projected context state
  -> report before/after token usage and result
```

**Acceptance criteria:**
- `/compact` works while idle and does not create a fake user message/Turn solely to invoke compaction.
- Successful manual compaction appends exactly one durable `compaction` Session Entry.
- The command reports trigger, approximate/exact token counts when available, and before/after usage.
- No-op and reducer-fallback outcomes are surfaced clearly.
- Manual compaction does not alter sibling branches or delete source Session Entries.

**Verification:** command-handler tests plus Session Tree persistence/projection tests.

## Checkpoint: Context Reduction Pipeline

- Tool Result pruning works independently from Compaction.
- Fresh Tool Result continuation remains useful under normal budget conditions.
- Prune-only and prune-then-compact paths are deterministic.
- `/compact` uses the same compactor/checkpoint path as automatic compaction.
- Session Tree remains complete, append-only, and branch-local.

## Phase 4: Documentation & Delivery

### Task 7: Record architecture and user-facing command semantics

- Add/update ADR describing the three distinct reduction mechanisms: Tool Result Pruning, historical Compaction, and Branch Summary.
- Document Tool Result lifecycle/budget/reference behavior.
- Document automatic vs manual compaction and `/compact` semantics.
- Update README, CONTEXT, CHANGELOG, current-state notes, and command help.

### Task 8: Final verification

- Harness and CLI focused/full tests pass.
- Shared/Harness/CLI/Server typechecks pass.
- CLI and Server builds pass.
- `git diff --check` passes.
- Verify persisted older Session payloads remain backward compatible.

## Explicitly Deferred

- LLM-generated semantic summarization for individual Tool Results; V1 pruning is deterministic and strategy-aware.
- External blob/object storage for Tool Result payloads. V1 durable source remains the Session Entry.
- Content/relevance scoring across arbitrary files beyond freshness and Tool Working Set policy.
- Aggressive/manual compaction flags such as `/compact --all`; V1 exposes one safe `/compact` behavior.
- Branch Summary semantic transfer implementation.
- Exact tokenizer support for every provider/model family.
