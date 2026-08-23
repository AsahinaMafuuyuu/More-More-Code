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
- Exact tokenizer support for every provider/model family.

---

# Next Plan: Stage 5.4 — Branch Knowledge Transfer & Lazy Branch Summary

**Status:** Delivered — 2026-08-14.

## Overview

Implement Branch Summary as a branch-to-branch knowledge-transfer mechanism on top of the append-only Session Entry Tree. Navigation itself remains non-destructive and does not automatically create a branch. The runtime asks about knowledge transfer only when moving to a target path would discard meaningful source-only semantic information. If the user chooses to carry that information, a `branch_summary` Entry is appended under the target and immediately forms the new branch. If the user declines, navigation remains a pure view-state change and a new branch forms only when the user later performs a real Session mutation such as submitting a new message.

Branch Summary is intentionally distinct from Compaction. Compaction produces a bounded replacement snapshot for one active branch; Branch Summary transfers useful discoveries from a departed branch into another branch. The summary itself is plain text, while Session metadata records provenance and coverage for incremental transfer and deduplication.

## Architecture Decisions

- **Navigation loss is determined by tree paths, not UI direction labels.** If the target path already contains the current source path, navigation loses no source knowledge and does not ask. If source-only meaningful entries would disappear from the target Context, the configured Branch Summary policy applies.
- **Browsing is not branching.** `jumpToEntry()` may change `activeEntryId` and projected messages/runtime state without appending any Session Entry. Merely inspecting older or sibling history must not create durable branch artifacts.
- **Lazy transfer.** With policy `ask`, the user is prompted only when source-only meaningful semantic delta exists. Choosing Carry immediately appends a `branch_summary` Entry under the target and therefore creates a new branch. Choosing No Carry leaves the target unchanged; the first later real Session mutation creates the branch naturally.
- **Summary content is plain text; provenance is structured metadata.** The model-facing knowledge remains a bounded text summary. Harness metadata records source tip, target, common ancestor, and exact covered Entry IDs.
- **Incremental transfer is coverage-based.** Previous transfers are not rewritten. Already-covered source Entry IDs are excluded from later transfer candidates so repeated navigation summarizes only newly discovered source knowledge.
- **A prior `branch_summary` may itself be summarized/transferred.** This allows knowledge to survive multiple branch hops. Provenance still claims only the Entries consumed by the current transfer.
- **Branch Summary is historical semantic Context, not a checkpoint and not a fake chat Message.** It participates in canonical Context Projection at its Session-path position and can later be absorbed by normal historical Compaction.
- **Runtime/config state is not transferred as branch knowledge.** Target branch model/mode/config state is restored from its own path. Branch Summary does not overwrite target runtime state.
- **Branch Summary has a bounded independent output budget.** V1 uses `min(4096 tokens, 4% of effective input budget)` as the maximum generated summary size. There is no Compaction-style gain-ratio gate because transfer exists to preserve knowledge, not primarily to reclaim tokens.
- **Reducer failure is isolated.** Semantic transfer falls back to a bounded deterministic summary. If neither semantic nor deterministic reduction can produce valid non-empty content, no `branch_summary` Entry is appended and the target remains the active navigation point.

## Proposed Session Entry Shape

The existing `branch_summary` Session Entry is extended conceptually to:

```ts
type SessionBranchSummaryEntry = {
  id: string;
  parentId: string | null;
  createdAt: number;
  type: "branch_summary";

  summary: string;

  transfer: {
    sourceTipEntryId: string;
    targetEntryId: string;
    commonAncestorEntryId: string;
    coveredEntryIds: string[];
    previousTransferEntryIds?: string[];
  };
};
```

`coveredEntryIds` is preferred over a simple `fromEntryId -> throughEntryId` range because transfer candidates may intentionally exclude state-only Entries such as `model_change`, `mode_change`, or `config_change`.

## Meaningful Transfer Candidates

V1 treats the following source-only Entry types as branch-summary semantic candidates:

- `user_message`
- `assistant_message`
- `custom_message`
- `message_update` when it materially changes a candidate message
- `tool_call`
- `tool_result`
- `error`
- `compaction`
- `branch_summary`
- relevant `custom` semantic entries when explicitly supported by the projector

The following are not transferred as branch knowledge by default:

- `session_start`
- `model_change`
- `mode_change`
- `config_change`

Tool Results remain subject to the existing Tool Result Working Set/pruning rules before they are given to a Branch Summary reducer, so one large log cannot dominate transfer input.

## Phase 1: Navigation Delta & Transfer Provenance

### Task 1: Add path/LCA and source-only delta analysis

Introduce provider-independent Session Tree helpers that compare the current source path and requested target path, compute their lowest common ancestor, and return source-only Entries in stable tree order.

**Acceptance criteria:**
- Descendant navigation where the target path contains the source path reports no lost source delta.
- Ancestor and cross-branch navigation reports only the source-only path segment after the LCA.
- Analysis is pure/read-only and never changes `activeEntryId` or appends Entries.

**Verification:** Harness Session Tree tests for descendant, ancestor, sibling, deep cross-branch, and root navigation.

### Task 2: Filter meaningful transfer candidates and track coverage

Filter source-only Entries through the Branch Summary semantic eligibility rules and subtract Entries already covered by prior relevant transfer metadata.

**Acceptance criteria:**
- State-only source delta does not trigger Branch Summary Ask.
- Repeated transfer from the same evolved source branch excludes previously covered Entry IDs.
- Existing Branch Summary Entries may participate as semantic input without corrupting coverage provenance.

**Verification:** Harness tests for state-only delta, repeated transfer, prior summary propagation, and non-contiguous covered Entry IDs.

## Checkpoint: Navigation Analysis

- Path comparison distinguishes browsing from knowledge-loss navigation.
- LCA/source-only delta is deterministic.
- Meaningful transfer filtering and coverage deduplication are test-covered.
- No Session mutations occur during analysis.

## Phase 2: Branch Summary Reduction

### Task 3: Define Branch Summary reducer contract and text format

Add a provider-independent Branch Summary reducer contract in Harness and a CLI semantic reducer implementation. The result is plain text, preferably using stable Markdown sections such as Key Findings, Decisions, Artifacts, Failures/Lessons, and Pending Work.

**Acceptance criteria:**
- Reducer receives only meaningful uncovered source Entries plus relevant prior transferred summaries.
- Output is a non-empty string bounded by `min(4096 tokens, 4% effective input budget)`.
- State-only runtime/config changes are not represented as target-state overrides.

**Verification:** reducer prompt/contract tests and bounded-output tests.

### Task 4: Add deterministic fallback and Tool Result input pruning

Reuse existing bounded Tool Result projection before semantic branch reduction and provide a deterministic Branch Summary fallback when the model reducer fails.

**Acceptance criteria:**
- Large Tool Results are bounded before branch-summary generation without mutating canonical Session Entries.
- Semantic reducer failure does not fail navigation or corrupt the Session Tree.
- If both semantic and deterministic reduction produce no valid text, transfer returns a typed failure/no-op and appends nothing.

**Verification:** oversized Tool Result, reducer-error, empty-output, and deterministic-fallback tests.

## Phase 3: Lazy Navigation Transfer

### Task 5: Introduce a unified navigation/transfer controller

Route `/tree`, `/jump`, parent/root navigation, and future navigation surfaces through one controller that can inspect the source/target paths before applying navigation.

Branch Summary policy:

```text
branchSummaryOnJump = "ask" | "always" | "never"
default = "ask"
```

Expected decision flow:

```text
request target
  -> analyze source/target paths
  -> no meaningful source-only delta: jump directly
  -> meaningful delta + never: jump directly
  -> meaningful delta + ask: prompt Carry / No Carry / Cancel
  -> meaningful delta + always: carry automatically
```

**Acceptance criteria:**
- No prompt is shown when target Context already contains the source path or source-only delta is semantically empty.
- Cancel leaves the source active and makes no Session mutation.
- No Carry changes only navigation state; it does not append a branch Entry.

**Verification:** controller tests for each policy and navigation topology.

### Task 6: Append Branch Summary lazily when Carry is selected

After Carry is selected, navigate to the target, generate the transfer summary, then append exactly one `branch_summary` child under that target. The new Branch Summary becomes active and therefore immediately establishes the new branch.

**Acceptance criteria:**
- Successful Carry creates exactly one branch-summary child under the target.
- Summary metadata records source tip, target, LCA, and exact covered Entry IDs.
- No Carry leaves the target as the active Entry and waits for a later real Session mutation to create a branch.
- Failed transfer leaves the target active but appends no empty/invalid branch-summary Entry.

**Verification:** Session Tree branch-local tests and CLI navigation integration tests.

## Checkpoint: Lazy Transfer Semantics

- Browsing alone creates no durable branch.
- Carry immediately creates a branch via one `branch_summary` Entry.
- No Carry creates no branch until a later real mutation.
- Repeated transfer is incremental and coverage-aware.

## Phase 4: Context Projection & Compaction Interop

### Task 7: Project Branch Summary into canonical model Context

Add Branch Summary as a semantic historical Context record at its Session-path position rather than converting it into a fake user/assistant message or a second checkpoint.

**Acceptance criteria:**
- Branch Summary text reaches model Context when it lies on the active Session path.
- UI Message Projection remains unchanged; Branch Summary is not rendered as normal chat content.
- Context ordering remains stable and provider-independent.

**Verification:** Context projection tests with messages, checkpoint, branch summary, retained tail, and current input.

### Task 8: Allow normal Compaction to absorb old Branch Summaries

Extend historical Compaction source selection so sufficiently old Branch Summary semantic records can be folded into the next replacement checkpoint while their Session Entries remain append-only history.

**Acceptance criteria:**
- A newer checkpoint may represent prior Branch Summary knowledge together with older conversation history.
- Compaction never deletes or rewrites the source `branch_summary` Entry.
- Latest checkpoint reuse does not duplicate absorbed branch knowledge in model Context.

**Verification:** chained Branch Summary -> Compaction -> restored Session tests.

## Phase 5: UI, Documentation & Delivery

### Task 9: Add Branch Summary navigation UX and policy setting

Expose Carry / No Carry / Cancel when `ask` applies and add the `ask | always | never` policy to the relevant settings surface. Preserve existing semantic theme tokens for Branch Summary presentation in the Session Tree.

**Acceptance criteria:**
- Prompt appears only for meaningful knowledge-loss navigation.
- User choice is clear and does not manufacture a chat Turn.
- Policy is deterministic across `/tree`, `/jump`, parent/root, and equivalent navigation surfaces.

**Verification:** command/dialog tests plus manual CLI check.

### Task 10: Document and verify Stage 5.4

- Add/update ADR for Branch Knowledge Transfer and lazy navigation semantics.
- Update README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, AGENTS rules where necessary.
- Run focused and full Harness/CLI tests.
- Run Shared/Harness/CLI/Server typechecks.
- Run CLI/Server builds and `git diff --check`.
- Verify Session Tree persistence remains backward compatible when older `branch_summary` Entries contain only `summary`.

## Explicitly Deferred

- Automatic semantic branch merging or conflict resolution.
- Branch ranking/relevance search across unrelated branches.
- LLM-based relevance scoring over arbitrary branch history.
- Editing or rewriting existing Branch Summary Entries in place; transfers remain append-only.
- Dedicated branch IDs; V1 continues to derive branches from Session Entry paths.
- Remote/cloud collaborative branch merge semantics.


# Stage 6.0 — Recoverable Runtime & Security Foundation

**Status:** Delivered — 2026-08-23. Persistence/recovery, production runtime wiring, permission enforcement, and security audit/validation are complete.

## Overview

Upgrade the local Agent Runtime into a recoverable and auditable runtime without breaking the existing cloud Session Store. The first delivery slice restores the PostgreSQL Session boundary, moves local Runtime Events into an independent SQLite adapter, and proves snapshot-plus-replay recovery. Permission policy and audit work build on that durable event boundary instead of introducing a second incompatible authority.

## Architecture Decisions

- `packages/database` remains the PostgreSQL-backed cloud Session Store used by `packages/server`.
- Local Runtime Events and Runtime Snapshots use a separate SQLite Prisma schema/client so changing the local store cannot remove or migrate cloud Session tables.
- Harness owns provider-independent Runtime Event, snapshot, recovery, and permission contracts; persistence adapters depend on those contracts, never the reverse.
- Session Tree remains the semantic conversation authority. Runtime Events persist execution, tool, context, security, and system facts; they do not replace Session Entries.
- Runtime Event offsets are database-assigned and append-only. Reads and snapshots are explicitly scoped by `sessionId`.
- Recovery means: load the latest valid session snapshot, replay later events through a supplied projection reducer, and expose the resulting state plus replay diagnostics. It does not silently restart an incomplete tool or model request.
- Memory Projection Cache is disposable hot state. SQLite is the durable local runtime source of truth.
- CLI startup owns one per-user Runtime Store at `~/.more-more-code/runtime/runtime.db` and applies embedded versioned migrations without invoking Prisma CLI.
- Runtime Event payloads are strict versioned allowlists; critical execution/Tool/Context start facts are durably appended before the corresponding external side effect, with no in-memory fallback.
- Existing CLI Tool Runtime remains the final permission-enforcement boundary and consumes the unified Harness permission policy contract. Every `ToolRuntime` instance must receive an explicit policy; omission must not silently become allow-all.

## Dependency Graph

```text
Cloud Session schema restoration
    -> Server type safety and cloud Session compatibility

Harness Runtime Event contract
    -> SQLite Runtime Store adapter + migrations
        -> Snapshot policy + projection cache
            -> Snapshot/replay recovery
                -> Permission decision persistence
                    -> Audit timeline and replay verification
```

## Phase 1: Repair Persistence Boundaries

### Task 1: Restore the cloud PostgreSQL Session Store

**Description:** Restore the Prisma PostgreSQL schema/client used by Server session routes and remove local Runtime Event concerns from that package.

**Acceptance criteria:**
- Server session routes typecheck against a generated `Session` model.
- `packages/database` uses the PostgreSQL adapter and `DATABASE_URL` again.
- RuntimeEvent/RuntimeSnapshot models are absent from the cloud schema.

**Verification:** Server typecheck and build; Prisma schema validation.

**Dependencies:** None.

**Estimated scope:** Small.

### Task 2: Create an isolated SQLite Runtime Store

**Description:** Add a dedicated workspace package with its own Prisma schema, generated client, explicit SQLite dependencies, configurable database URL, and initial migration.

**Acceptance criteria:**
- A clean install can resolve the SQLite adapter and driver from declared dependencies.
- Runtime Event and Snapshot tables can be created from committed migrations.
- Database location is supplied explicitly rather than derived from an arbitrary process working directory.

**Verification:** Prisma validate/generate plus a temporary-database integration test.

**Dependencies:** Task 1.

**Estimated scope:** Medium.

## Checkpoint: Persistence Boundary

- Cloud Server Session typecheck/build passes.
- Local Runtime Store validates independently.
- No Prisma client or datasource is shared between PostgreSQL and SQLite.

## Phase 2: Durable Runtime Event and Recovery Slice

### Task 3: Finalize provider-independent EventStore contracts

**Description:** Replace the current loosely aligned interfaces with one typed, session-scoped contract for append, ordered reads, snapshots, and offsets.

**Acceptance criteria:**
- Event categories are a discriminated union or validated typed envelope rather than unconstrained database strings.
- Event timestamps and database mappings have one documented representation.
- `listAfter`, `latestSnapshot`, and snapshot writes require a `sessionId`.

**Verification:** Harness typecheck and contract tests.

**Dependencies:** Task 2.

**Estimated scope:** Small.

### Task 4: Implement atomic SQLite append and snapshot storage

**Description:** Implement the Harness contract using database-assigned monotonic offsets and session-filtered reads, avoiding query-max-then-insert races.

**Acceptance criteria:**
- Concurrent appends cannot allocate the same event offset.
- Recovery for one session never reads another session's events or snapshot.
- Stored rows are mapped back to Harness Runtime Event/Snapshot types without `any` escaping the adapter boundary.

**Verification:** SQLite integration tests for ordering, concurrency, and cross-session isolation.

**Dependencies:** Task 3.

**Estimated scope:** Medium.

## Phase 3: Snapshot and Recovery

### Task 5: Complete projection cache, snapshot policy, and replay recovery

**Description:** Integrate the in-progress cache and hybrid snapshot policy with a generic recovery reducer that rebuilds runtime state from the latest snapshot plus later events.

**Acceptance criteria:**
- Recovery works both with and without an existing snapshot.
- Replay produces the same projection as replaying the complete event stream.
- Incomplete runs are surfaced as recovery state and are not automatically re-executed.

**Verification:** Harness unit tests plus SQLite restart/recovery integration tests.

**Dependencies:** Task 4.

**Estimated scope:** Medium.

## Checkpoint: Recovery Foundation

- Harness and Runtime Store tests pass.
- Snapshot-plus-replay parity is verified.
- Server session behavior remains unchanged.

## Phase 4: Production Runtime Wiring

**Status:** Delivered — 2026-08-23.

### Task 6: Bootstrap the per-user Runtime Store

**Description:** Add one CLI bootstrap module that owns the stable local database location, embedded migration lifecycle, shared SQLite adapter, and shutdown cleanup. The default database is `~/.more-more-code/runtime/runtime.db`; `RUNTIME_STORE_DATABASE_URL` remains an explicit override for tests and advanced users.

**Acceptance criteria:**
- First launch creates the per-user directory and database without invoking Prisma CLI at runtime.
- Repeated startup applies the embedded, versioned migrations idempotently and never derives the database path from `process.cwd()`.
- Bootstrap failures stop startup with a clear error, the shared store is closed on normal shutdown, and the real CLI launcher contains no trailing executable garbage.

**Verification:** Runtime Store bootstrap/migration integration tests; CLI typecheck/build; launcher regression check.

**Dependencies:** Task 5.

**Files likely touched:**
- `packages/runtime-store/src/bootstrap.ts`
- `packages/runtime-store/src/migrations.ts`
- `packages/runtime-store/tests/bootstrap.test.ts`
- `packages/cli/src/lib/runtime-environment.ts`
- `packages/cli/src/index.tsx`

**Estimated scope:** Medium.

### Task 7: Persist AgentLoop execution facts before side effects

**Description:** Introduce versioned, typed Runtime Event envelopes and a durable execution adapter that satisfies the existing `ExecutionEventStore` interface while hiding SQLite, replay, projection-cache, and snapshot-policy details behind one deep Runtime Session module.

**Acceptance criteria:**
- Execution events are validated and durably appended before AgentLoop advances to the corresponding model/tool side effect.
- Store append failure is fail-closed and never silently falls back to in-memory execution.
- Session startup restores snapshot-plus-replay state, warms Projection Cache, and reports incomplete runs without re-executing them.

**Verification:** Harness adapter tests for write ordering/failure/recovery plus SQLite restart coverage.

**Dependencies:** Task 6.

**Files likely touched:**
- `packages/harness/src/event-store.ts`
- `packages/harness/src/runtime-session.ts`
- `packages/harness/tests/runtime-session.test.ts`
- `packages/cli/src/hooks/use-chat.ts`

**Estimated scope:** Medium.

## Checkpoint: Durable Execution

- CLI first-run and repeated-start migration tests pass.
- AgentLoop cannot begin an external step until its execution fact is durable.
- Recovery reports but does not resume incomplete work.

### Task 8: Emit redacted Tool and permission facts

**Description:** Add an awaited Tool Runtime observer that records request, permission decision, and terminal status using allowlisted metadata only. Raw tool input, output, command text, file contents, prompts, and arbitrary error text are excluded from Runtime Events.

**Acceptance criteria:**
- Tool request and effective permission decision are durable before executor invocation.
- Terminal status, source, timing, and correlation IDs are persisted without raw input/output.
- Runtime Store failure prevents the next tool side effect and is surfaced as an execution failure.

**Verification:** Tool Runtime ordering/redaction/failure tests and CLI integration tests.

**Dependencies:** Task 7.

**Files likely touched:**
- `packages/cli/src/lib/tool-runtime.ts`
- `packages/cli/src/hooks/use-chat.ts`
- `packages/cli/tests/agent-bootstrap.test.ts`
- `packages/harness/src/event-store.ts`

**Estimated scope:** Medium.

### Task 9: Emit Context and recovery-system facts

**Description:** Record Context projection lifecycle and session recovery diagnostics as safe metrics and identifiers. These events make recovery observable without duplicating model-visible content or Session Tree payloads.

**Acceptance criteria:**
- Context projection start is durable before semantic-compaction/primary-model work; completion records only token/budget/pruning metrics.
- Session-open and recovery-report system events include pending-operation counts but no conversation content.
- The CLI exposes recovered incomplete work to the user and permits a new Run without automatic replay.

**Verification:** LocalModelTransport callback tests, Runtime Session projection tests, and a CLI recovery-notification test.

**Dependencies:** Tasks 7 and 8.

**Files likely touched:**
- `packages/cli/src/lib/local-model-transport.ts`
- `packages/cli/src/hooks/use-chat.ts`
- `packages/cli/src/screens/session.tsx`
- `packages/cli/tests/local-model-context.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Production Runtime Wiring

- Typed Runtime Events contain no raw prompts, Tool input/output, file contents, command text, or arbitrary error text.
- Runtime Store append failures stop subsequent external side effects.
- Snapshot-plus-replay recovery warms Projection Cache and exposes incomplete work without replay.
- Harness, CLI, and Runtime Store tests/typechecks pass; CLI build and `git diff --check` pass.

## Phase 5: Permission Follow-up

**Status:** Delivered — 2026-08-23. Unified policy, persisted overrides, Tool Runtime enforcement, redacted permission lifecycle, and RuntimeSession fail-closed consistency fixes are implemented and verified.

### Task 10: Consolidate the permission contract and rule engine

**Description:** Replace the duplicate Harness `decide()` and CLI `evaluate()` shapes with one provider-independent permission interface. Keep capability/resource matching and precedence inside one deep Harness module so Tool Runtime only submits requests and enforces returned decisions.

**Acceptance criteria:**
- `allow | deny | ask`, request, decision, rule, resource-kind, and scope types have one Harness authority.
- Rules can match capabilities together with command, path, generic-resource, and scope constraints.
- Configured rules deterministically override code defaults, and `deny` / `ask` remain distinguishable outcomes.

**Verification:** Harness permission-policy tests and Harness typecheck.

**Dependencies:** Task 9.

**Files likely touched:**
- `packages/harness/src/permission.ts`
- `packages/harness/src/index.ts`
- `packages/harness/tests/permission.test.ts`

**Estimated scope:** Medium.

### Task 11: Resolve persisted overrides and Tool permission requests

**Description:** Extend global/project Agent config with permission defaults and rules, merge persisted overrides in stable global-to-project order, and translate registered Tool capabilities plus ephemeral input into typed path/command/resource requests without persisting raw values.

**Acceptance criteria:**
- Existing config files remain valid when `permissions` is absent.
- Global and project overrides produce one deterministic effective policy.
- Native Tools classify workspace/outside-workspace paths, shell commands, and Agent resources for policy evaluation.

**Verification:** Agent config merge/load tests and Tool Registry request-classification tests.

**Dependencies:** Task 10.

**Files likely touched:**
- `packages/cli/src/lib/agent-config.ts`
- `packages/cli/src/lib/permission-policy.ts`
- `packages/cli/src/lib/tool-registry.ts`
- `packages/cli/tests/agent-bootstrap.test.ts`

**Estimated scope:** Medium.

### Task 12: Enforce decisions and persist a redacted permission lifecycle

**Description:** Make Tool Runtime evaluate every registered capability before executor invocation and emit awaited permission-request and permission-decision observations. Version the security Runtime Event payload independently so existing version-1 events remain recoverable while new events record only safe capability/resource-kind/scope metadata.

**Acceptance criteria:**
- No Tool executor runs after an effective `deny` or `ask` decision.
- Permission request and decision facts are durably appended before executor invocation, and append failure remains fail-closed.
- Security events never contain raw commands, paths, Tool input/output, file contents, or arbitrary policy reasons.

**Verification:** Tool Runtime ordering/enforcement/redaction tests, Runtime Event validation tests, CLI and Harness typechecks.

**Dependencies:** Tasks 10 and 11.

**Files likely touched:**
- `packages/cli/src/lib/tool-runtime.ts`
- `packages/cli/src/hooks/use-chat.ts`
- `packages/harness/src/event-store.ts`
- `packages/harness/tests/runtime-session.test.ts`
- `packages/cli/tests/agent-bootstrap.test.ts`

**Estimated scope:** Medium.

### Task 13: Document and verify the permission phase

**Description:** Update the Stage 6.0 ADR/current-state documentation and task status, then run focused and integration verification without claiming the separate audit phase is complete.

**Acceptance criteria:**
- Documentation explains rule precedence, config shape, enforcement seam, redacted event versioning, and the deferred approval UI/sandbox boundary.
- Phase 5 checklist is complete while Phase 6 remains open.
- Focused tests, required typechecks/builds, both Prisma validations, and `git diff --check` pass.

**Verification:** Stage 6.0 Final Verification commands.

**Dependencies:** Task 12.

**Estimated scope:** Small.

## Phase 6: Audit Follow-up

**Status:** Delivered — 2026-08-23. Derived audit projection, lifecycle consistency replay, dangerous-operation validation, and final verification are complete.


### Task 14: Add a session-scoped security audit projection

Project persisted `security` Runtime Events into a derived Harness audit timeline rather than storing an ever-growing audit array in `RuntimeSessionProjection` snapshots. Pair v2 `requested -> decided` facts by session/correlation metadata, retain v1 decisions as explicit legacy decision-only entries, and surface incomplete/duplicate/mismatched lifecycles without reconstructing redacted resource values.

**Verification:** Harness tests for v1/v2 compatibility, session isolation, ordering, and malformed lifecycle sequences.

**Dependencies:** Task 13.

### Task 15: Verify permission lifecycle replay invariants

Define replay verification as **security lifecycle consistency replay**, not policy recomputation. Schema-v2 intentionally excludes raw command/path/resource values, so recovery must not claim it can rerun `matchesPermissionRule()` from durable facts. Verify request/decision metadata consistency, forbid orphan/duplicate decisions, and ensure `deny` cannot reach executor completion while `ask` terminates as `approval_required`; only `allow` may proceed.

**Verification:** replay tests for valid allow/deny/ask flows and each inconsistency class.

**Dependencies:** Task 14.

### Task 16: Add dangerous-operation validation

Stress the enforcement seam with command/path/symlink or junction/multi-capability/fail-closed cases. Cover representative shell-pattern bypass attempts, traversal/absolute/create-under-link cases, `editFile` and `grep` multi-capability blocking, plus policy throw/invalid return and permission-observer persistence failure with executor call count remaining zero. Document explicitly that command-pattern matching is policy enforcement, not an OS sandbox.

**Verification:** focused CLI/Harness dangerous-operation tests plus normal integration suites.

**Dependencies:** Task 15.

### Task 17: Complete Stage 6.0 audit and delivery

Reconcile ADR/current-state documentation with implemented audit semantics, run the complete Stage 6.0 verification matrix, and close the Stage only when no residual P0/P1 audit findings remain. Documentation must explicitly distinguish lifecycle consistency replay from impossible redacted policy recomputation.

**Dependencies:** Task 16.

## Final Verification

- Harness, CLI, and Runtime Store tests pass; Server currently has no test suite and must pass typecheck/build.
- Shared/Harness/CLI/Server/Database/Runtime Store typechecks pass.
- CLI and Server builds pass.
- Both Prisma schemas validate and generate independently.
- `git diff --check` passes.
- README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, and ADRs reflect the two-store boundary and actual completion state.

## Deferred

- PostgreSQL synchronization of local Runtime Events.
- Sandbox/container enforcement.
- Automatic restart of interrupted external processes.
- Multi-agent execution framework.
- Full OpenTelemetry integration.


# Stage 6.2 — Interactive Approval & Permission UX

**Status:** In progress — planned 2026-08-23.

## Overview

Turn the existing fail-closed `ask -> approval_required` policy outcome into a real human approval transaction without moving interactive state into `PermissionPolicy` or AgentLoop. The policy engine continues to answer whether a Tool capability is `allow | deny | ask`; a separate Approval Broker owns the ephemeral human decision. A Tool Step that reaches `ask` must remain the same Tool Step while it waits, then either continue to the original executor after an explicit one-time approval or terminate without execution after deny/cancel/timeout.

This Stage deliberately ships **Allow once** and **Deny** only. It does not persist permanent user overrides, does not introduce session/project auto-approval, and does not claim OS-level sandboxing.

## Architecture Decisions

- Harness owns provider-independent approval transaction contracts; CLI owns the interactive broker adapter and terminal UI.
- Approval is a **Tool-call-level transaction**. Tool Runtime first evaluates every registered capability. Any `deny` blocks immediately; only a Tool Call with no deny and at least one `ask` creates one approval transaction containing all ask requirements.
- Approval requests may carry raw command/path/resource values ephemerally so the human can make an informed decision. Durable Runtime Events retain only allowlisted capability/resource-kind/scope metadata and correlation IDs.
- Tool Runtime awaits the Approval Broker inside the original Tool Step. The model does not receive an `approval_required` result and does not need to issue a second Tool Call after approval.
- Approval waiting has independent cancellation/timeout semantics. User deny is a normal `denied` Tool outcome; Run interruption is `cancelled`; approval timeout is `timed_out`. Infrastructure failures in the broker or durable observer remain fail-closed exceptions.
- Security Runtime Events gain a separately versioned approval lifecycle rather than mutating permission schema v2. Existing v1/v2 events remain readable.
- The derived security audit projector must understand approval lifecycle events so `permission=ask` can be reconciled with `approval allow/deny/cancel/timeout` and the eventual Tool terminal.
- Closing or escaping the approval dialog cancels the pending approval; approval UI must never disappear while leaving the Tool Step waiting forever.

## Dependency Graph

```text
Harness approval contract
    -> CLI InteractiveApprovalBroker
        -> ToolRuntime ask sequencing
            -> approval Runtime Event lifecycle
                -> security audit replay compatibility
                    -> CLI approval dialog
                        -> Stage 6.2 integration verification
```

## Phase 1: Approval Contract & Durable Protocol

### Task 1: Add provider-independent approval transaction contracts

**Description:** Add the Harness approval seam used by Tool Runtime and interactive adapters. A request identifies the Tool Call and includes the ask-only `PermissionRequest` set; a resolution is an explicit one-time `allow | deny`. The broker receives an AbortSignal so interruption and approval timeout do not require a second cancellation interface.

**Acceptance criteria:**
- One approval request can represent multiple ask capabilities for one Tool Call.
- Raw resource values remain ephemeral approval input and are not defined as durable event fields.
- Broker request cancellation is observable through the supplied AbortSignal and cannot leave an unresolved transaction contractually valid.

**Verification:** Harness typecheck plus focused contract/broker tests through the public interface.

**Dependencies:** None.

**Files likely touched:**
- `packages/harness/src/approval.ts`
- `packages/harness/src/index.ts`
- `packages/harness/tests/approval.test.ts`

**Estimated scope:** Small.

### Task 2: Add redacted approval Runtime Event lifecycle

**Description:** Introduce an independently versioned security payload for `approval.lifecycle` with requested and terminal phases. Persist approval ID, Tool correlation, and redacted ask requirements; terminal facts record `allow | deny | cancelled | timed_out` without command/path/resource values.

**Acceptance criteria:**
- Existing security schema v1 permission decisions and v2 permission lifecycle remain valid.
- Approval payload validation rejects raw resource values, arbitrary reasons, and unknown fields.
- Requested facts are durable before the interactive broker is awaited; terminal facts are durable before executor invocation or Tool completion proceeds.

**Verification:** Harness Runtime Event validation tests and RuntimeSession record tests.

**Dependencies:** Task 1.

**Files likely touched:**
- `packages/harness/src/event-store.ts`
- `packages/harness/tests/permission-runtime-events.test.ts`
- `packages/harness/src/runtime-session.ts`

**Estimated scope:** Medium.

## Checkpoint: Approval Protocol

- Approval contracts are provider-independent and UI-free.
- Durable approval events contain no raw command/path/resource values.
- Existing Runtime Event recovery remains backward compatible.

## Phase 2: Tool Runtime & Interactive Broker

### Task 3: Await one Tool-call approval inside Tool Runtime

**Description:** Refactor permission evaluation into two stages: evaluate and durably observe every capability first, then fail immediately on any deny or batch all ask decisions into one Approval Broker transaction. After explicit allow, continue the same Tool Step and executor invocation; after deny/cancel/timeout, do not execute.

**Acceptance criteria:**
- A later deny prevents an earlier ask from prompting the user.
- Multiple ask capabilities create exactly one approval transaction for the Tool Call.
- Allow resumes the same Tool Step; deny/cancel/timeout invoke the executor zero times.
- Approval wait time is independent from executor timeout and is interruptible by the Run signal.

**Verification:** Tool Runtime tests for allow, deny, mixed allow/ask, ask+deny, multiple ask, cancellation, timeout, and broker failure.

**Dependencies:** Tasks 1 and 2.

**Files likely touched:**
- `packages/cli/src/lib/tool-runtime.ts`
- `packages/cli/tests/agent-bootstrap.test.ts`
- `packages/cli/tests/permission-policy.test.ts`

**Estimated scope:** Medium.

### Task 4: Implement the process-local InteractiveApprovalBroker

**Description:** Add one CLI broker adapter that exposes pending approval snapshots to React, resolves `allow | deny` exactly once, and removes pending transactions when their signal aborts. The broker remains process-local; it does not edit config or Session history.

**Acceptance criteria:**
- Pending transactions are observable/subscribable without exposing mutable broker internals.
- Resolve is idempotent/fail-safe and cannot resolve the wrong approval ID.
- Abort/timeout removes the pending request and rejects the waiting Tool Runtime promise.

**Verification:** Dedicated CLI broker tests including subscriber ordering and abort cleanup.

**Dependencies:** Task 1.

**Files likely touched:**
- `packages/cli/src/lib/interactive-approval-broker.ts`
- `packages/cli/tests/interactive-approval-broker.test.ts`

**Estimated scope:** Small.

## Checkpoint: Runtime Approval Flow

- Policy evaluation remains separate from human approval.
- `ask` no longer returns a dead-end result to the model when interactive approval is available.
- A Tool executor cannot run before both the policy and approval lifecycle are durably recorded.

## Phase 3: Audit Compatibility & CLI UX

### Task 5: Extend security audit replay for approval lifecycle

**Description:** Extend the derived security audit projection with approval transactions and update ask invariants. An `ask` permission may proceed only when a matching approval resolves `allow`; deny/cancel/timeout must reconcile with the corresponding Tool terminal. Missing/duplicate/orphan approval events remain auditable inconsistencies or pending state.

**Acceptance criteria:**
- v1/v2 permission-only history remains replayable without approval facts.
- v3 approval history correlates by Session/Run/Turn/Step/Tool Call and approval ID.
- `ask + approval allow + completed` is valid; mismatched deny/cancel/timeout terminals are flagged.

**Verification:** Harness security-audit replay tests covering legacy and interactive approval histories.

**Dependencies:** Tasks 2 and 3.

**Files likely touched:**
- `packages/harness/src/security-audit.ts`
- `packages/harness/tests/security-audit.test.ts`

**Estimated scope:** Medium.

### Task 6: Add CLI approval dialog and Session integration

**Description:** Surface the broker's active request in the existing Dialog layer. Show Tool name plus ephemeral capability/resource details and offer only `Allow once` and `Deny`. Escape/dialog dismissal cancels the approval. Resolving the dialog must wake the same Tool Step without creating a new model Tool Call or mutating permanent permission config.

**Acceptance criteria:**
- An ask decision opens a modal with enough ephemeral information to identify the operation.
- `Allow once` continues the current Tool Step; `Deny` blocks it; Escape/dismiss cancels it.
- Closing/unmounting the Session cancels pending approvals and cannot strand the AgentLoop.
- No approval action writes global/project permission overrides.

**Verification:** UI state tests where practical plus integration tests at the broker/useChat seam; CLI build passes.

**Dependencies:** Tasks 3 and 4.

**Files likely touched:**
- `packages/cli/src/hooks/use-chat.ts`
- `packages/cli/src/screens/session.tsx`
- `packages/cli/src/components/dialogs/approval-dialog.tsx`
- `packages/cli/src/components/dialogs/index.tsx`

**Estimated scope:** Medium.

## Phase 4: Documentation & Delivery

### Task 7: Document Stage 6.2 approval semantics

**Description:** Record the policy/approval separation, one-time scope, lifecycle redaction, cancellation/timeout behavior, and explicit deferral of persistent approval rules and OS Sandbox.

**Acceptance criteria:**
- ADR/current-state docs explain `PermissionPolicy != ApprovalBroker`.
- Documentation states that approval is one-time and never silently edits config.
- Audit semantics and remaining Sandbox/MCP boundaries are current.

**Verification:** Documentation review and `git diff --check`.

**Dependencies:** Tasks 5 and 6.

**Estimated scope:** Small.

### Task 8: Complete Stage 6.2 delivery

**Description:** Run the complete regression matrix, review the integrated diff for security/order regressions, update task status, and commit the Stage on `stage/6.2-interactive-approval` with no residual P0/P1 findings.

**Acceptance criteria:**
- Harness, CLI, and Runtime Store tests pass.
- Six package typechecks, CLI/Server builds, both Prisma validate/generate paths, and `git diff --check` pass.
- No pending approval can survive cancellation/unmount and no executor can run before durable approval allow.

**Verification:** Stage 6.2 Final Verification commands.

**Dependencies:** Task 7.

**Estimated scope:** Small.

## Stage 6.2 Final Verification

- Harness, CLI, and Runtime Store test suites pass; Server currently has no test suite and must pass typecheck/build.
- Shared/Harness/CLI/Server/Database/Runtime Store typechecks pass.
- CLI and Server builds pass.
- Both Prisma schemas validate and generate independently.
- `git diff --check` passes.
- Approval-specific tests prove allow-once, deny, cancel, timeout, multi-capability batching, fail-closed observer/broker errors, and audit replay consistency.

## Explicitly Deferred

- `Allow for session`, `Allow for project`, or any automatic persistence of permission overrides.
- OS-level process/filesystem/network Sandbox enforcement.
- Shell-AST-aware command authorization.
- MCP transport/auth/remote Tool execution.
- Cloud synchronization of approval/runtime events.
