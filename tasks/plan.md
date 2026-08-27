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

**Status:** Delivered — 2026-08-23. Provider-independent approval contracts, redacted schema-v3 lifecycle events, same-Tool-Step interactive approval, CLI `Allow once | Deny` UX, approval-aware audit replay, and full delivery verification are complete.

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


# Stage 6.3 — Sandbox Execution Foundation & Process Hardening

**Status:** Delivered — 2026-08-23.

## Overview

Introduce a real execution seam between native Tools and host subprocess creation so MORE-MORE-CODE can enforce process-isolation policy without pushing OS-specific behavior into `ToolRuntime` or individual Tools. This Stage centralizes every native subprocess launch (`bash` and `grep`), adds explicit `off | auto | required` sandbox configuration, removes ambient secret exposure from child-process environments by default, and provides a Linux Bubblewrap adapter for OS-enforced workspace-write/process/network isolation when available.

The current Windows development host does not provide a native Bubblewrap/nsjail-style primitive. Stage 6.3 therefore does **not** claim full Windows filesystem/network sandboxing. `auto` may fall back to a direct process adapter only when no hard restriction such as `network=deny` was requested; `required` always fails closed when no supported isolation provider is available. This keeps capability claims truthful while creating the seam needed for a future Windows AppContainer/Job-object or container adapter.

## Architecture Decisions

- `ToolRuntime` remains source-agnostic and owns permission/approval/timeout orchestration only. Sandbox/process launch belongs below the native Tool executor in the CLI.
- Native subprocesses must cross one deep `ProcessSandbox` interface. `local-tools.ts` may consume stdout/stderr/exit/kill from that interface but must not call `Bun.spawn` directly.
- Sandbox configuration is layered global -> project like the rest of Agent Config and is independent from Permission Policy. Permission answers **whether** an operation may run; Sandbox constrains **how** an allowed operation runs.
- `mode=off` preserves direct execution. `mode=auto` uses a supported OS adapter when available and may use the direct adapter only when doing so does not violate an explicitly requested hard restriction. `mode=required` is fail-closed.
- Child processes default to a bounded safe environment allowlist rather than inheriting every CLI/provider credential. Users may explicitly opt into `environment=inherit` or add named environment variables through `envAllow`.
- Linux Bubblewrap uses a read-only host root, a read-write workspace bind, private `/tmp`, isolated PID/IPC/UTS namespaces, a private home view, and optional network namespace isolation. This is an OS-enforced process/filesystem-write boundary, not a claim that arbitrary host reads outside all system paths are impossible.
- Windows/macOS unsupported-provider fallback is explicit and observable through sandbox status; no environment-only hardening is described as OS sandboxing.

## Dependency Graph

```text
Agent Config sandbox contract
    -> ProcessSandbox interface + provider selection
        -> safe child-process environment
        -> Bubblewrap launch-plan adapter
            -> bash/grep unified subprocess seam
                -> cancellation/regression verification
                    -> ADR/current-state delivery
```

## Phase 1: Configuration & Deep Process Seam

### Task 1: Add layered Sandbox configuration

**Description:** Extend Agent Config with a small process-sandbox contract: `mode`, `network`, `environment`, and exact-name `envAllow`. Merge global then project settings deterministically and ship secure-but-compatible defaults.

**Acceptance criteria:**
- Invalid sandbox values are rejected by config parsing.
- Global values are overridden only by explicitly supplied project values.
- Defaults are deterministic and documented; `envAllow` is copied rather than shared/mutated.

**Verification:** CLI agent-bootstrap/config tests and TypeScript typecheck.

**Dependencies:** None.

**Files likely touched:**
- `packages/cli/src/lib/agent-config.ts`
- `packages/cli/tests/agent-bootstrap.test.ts`
- `.more-more-code/config.json`

**Estimated scope:** Small.

### Task 2: Add the ProcessSandbox module

**Description:** Add one CLI module that owns provider discovery, effective sandbox status, child-process environment projection, provider selection, and subprocess creation behind a minimal interface used by native Tools.

**Acceptance criteria:**
- Callers do not need OS/provider branching.
- `required` fails before child-process creation when no provider exists.
- `auto` never silently drops an explicitly requested hard network restriction.

**Verification:** Focused process-sandbox tests using injected provider discovery/spawn seams.

**Dependencies:** Task 1.

**Files likely touched:**
- `packages/cli/src/lib/process-sandbox.ts`
- `packages/cli/tests/process-sandbox.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Configuration & Process Seam

- Agent Config resolves sandbox policy correctly.
- No subprocess is required to know platform-specific isolation details.
- Fail-open/fail-closed behavior is covered by tests.

## Phase 2: OS Adapter & Native Tool Integration

### Task 3: Implement safe child-process environment projection

**Description:** Prevent ambient provider/API credentials from being inherited by native child processes in `environment=safe` mode while preserving platform variables required to find and start ordinary development tools. Allow exact explicitly configured variable names to cross the seam.

**Acceptance criteria:**
- Common path/temp/locale/shell variables survive safe projection.
- Representative secret/token variables do not survive unless explicitly allowlisted.
- Environment-name matching follows Windows case-insensitive semantics where relevant.

**Verification:** Focused environment projection tests.

**Dependencies:** Task 2.

**Files likely touched:**
- `packages/cli/src/lib/process-sandbox.ts`
- `packages/cli/tests/process-sandbox.test.ts`

**Estimated scope:** Small.

### Task 4: Add Linux Bubblewrap workspace isolation adapter

**Description:** When running on Linux with `bwrap` available, build an OS-enforced launch plan with read-only host root, read-write canonical workspace, private temp/home views, process namespace isolation, and optional network denial. Provider availability is discovered without making Bubblewrap a package dependency.

**Acceptance criteria:**
- Workspace is the only normal host write bind in the launch plan.
- `network=deny` adds network namespace isolation.
- Missing Bubblewrap is represented as unavailable rather than silently reported as isolated.

**Verification:** Pure launch-plan tests plus optional local provider probe when available.

**Dependencies:** Tasks 2 and 3.

**Files likely touched:**
- `packages/cli/src/lib/process-sandbox.ts`
- `packages/cli/tests/process-sandbox.test.ts`

**Estimated scope:** Medium.

### Task 5: Route bash and grep through ProcessSandbox

**Description:** Replace direct `Bun.spawn` calls in native `bash` and `grep` with the shared process seam while preserving existing process-group cancellation, timeout propagation, bounded output, canonical workspace cwd, and grep exit-code semantics.

**Acceptance criteria:**
- `local-tools.ts` contains no direct child-process creation.
- Bash cancellation still terminates its descendant process group and cleans temporary cancellation state.
- Grep and Bash both receive the same sandbox/environment policy.

**Verification:** Existing cancellation tests plus new native-tool sandbox integration tests.

**Dependencies:** Tasks 2-4.

**Files likely touched:**
- `packages/cli/src/lib/local-tools.ts`
- `packages/cli/src/hooks/use-chat.ts`
- `packages/cli/tests/local-tools-cancellation.test.ts`
- `packages/cli/tests/process-sandbox.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Native Process Enforcement

- Every native subprocess crosses ProcessSandbox.
- Linux isolation launch plans are deterministic and test-covered.
- Windows remains explicitly unsupported for full OS isolation rather than receiving a false security label.
- Cancellation and timeout behavior remain unchanged at the ToolRuntime interface.

## Phase 3: Documentation, Security Review & Delivery

### Task 6: Record sandbox semantics and remaining platform boundary

**Description:** Add an ADR and update current-state documentation to separate Permission/Approval from Sandbox, document mode/fallback semantics, safe environment behavior, the Bubblewrap profile, and the unresolved Windows native isolation adapter.

**Acceptance criteria:**
- Documentation never calls direct fallback a sandbox.
- Windows limitation and `required` fail-closed behavior are explicit.
- The next-stage recommendation distinguishes Windows native isolation, MCP trust, and persistent approvals.

**Verification:** Documentation review and `git diff --check`.

**Dependencies:** Task 5.

**Files likely touched:**
- `docs/decisions/0022-sandbox-execution-seam-and-linux-bubblewrap.md`
- `.docs/2026-08-12-current-implementation-and-decisions.md`
- `README.md`
- `CONTEXT.md`
- `PROJECT_ANALYSIS.md`
- `CHANGELOG.md`

**Estimated scope:** Medium.

### Task 7: Complete Stage 6.3 delivery

**Description:** Run focused and full regressions, review the integrated diff for fail-open paths or cancellation regressions, close the checklist, and commit Stage 6.3 on `stage/6.3-sandbox-execution-foundation` only when no residual P0/P1 issue remains.

**Acceptance criteria:**
- CLI tests/typecheck/build and dependent Harness tests pass.
- Full repository package typechecks/builds used by the prior security stages still pass.
- `git diff --check` passes and the Stage is committed with a clean working tree.

**Verification:** Stage 6.3 Final Verification commands.

**Dependencies:** Task 6.

**Estimated scope:** Small.

## Stage 6.3 Final Verification

- `bun test packages/cli/tests`
- `bun run --filter @more-more-code/harness test`
- Shared/Harness/CLI/Server/Database/Runtime Store TypeScript checks.
- CLI and Server builds.
- Both Prisma schemas validate/generate independently.
- `git diff --check`.
- Security review confirms `required` and hard restrictions fail closed before spawn; direct fallback is never labeled isolated.

### Delivery Evidence — 2026-08-23

- CLI regression: **89 passed / 0 failed** across 21 files.
- Harness regression: **99 passed / 0 failed** across 14 files.
- Runtime Store integration: **8 passed / 0 failed** across 2 files.
- Shared, Harness, CLI, Server, Database, and Runtime Store TypeScript checks all passed.
- CLI and Server production builds passed.
- PostgreSQL Cloud Session Store and SQLite Runtime Store Prisma schemas both validated and generated independently.
- `git diff --check` passed; only repository line-ending conversion warnings were emitted on Windows.
- Integrated review found no residual P0/P1 issue. During review, a pre-existing Windows native `grep` ENOENT path was exposed by the new integration test and fixed by resolving Git-for-Windows `usr/bin/grep.exe` when it is not on the host PATH.
- The current Windows host has no Bubblewrap provider, so Linux Bubblewrap behavior is verified through deterministic launch-plan/provider tests rather than a local live Bubblewrap execution. Windows direct fallback is explicitly reported as unisolated, while `required` and unenforceable `network=deny` remain fail-closed before spawn.

## Explicitly Deferred

- Windows AppContainer/restricted-token/Job-object sandbox adapter and equivalent macOS provider.
- Full host-read confidentiality isolation for arbitrary subprocesses on every OS.
- Persistent `Allow for session/project` approval rules.
- Shell-AST-aware authorization.
- MCP transport/auth/remote Tool sandboxing.
- Cloud synchronization of Runtime Events.

---

# Stage 6.4 — Provider Runtime & Local Model Configuration

**Status:** Completed — delivered 2026-08-23. ADR-0023 remains broader than this Stage because cloud synchronization and commercial-account work are deferred to the paused Stage 6.6.

## Overview

Replace the current hard-coded provider/model assumptions with a local Provider Registry, dynamic `ModelRef`, explicit authentication strategies, and a local Credential Store seam. The initial built-in provider set is exactly OpenAI, Anthropic, Google, and DeepSeek. Custom Provider V1 is OpenAI-compatible only. OpenAI supports API Key plus an initially experimental Codex OAuth seam; Anthropic/Google/DeepSeek start with API Key only.

This Stage does **not** make the Server responsible for model traffic or provider secrets. Provider configuration is user-global local state and model execution remains owned by the CLI/Harness.

**Delivered:** strict user-global Provider Registry; four built-in providers plus multiple Custom OpenAI-compatible provider IDs; encrypted local CredentialStore seam with environment compatibility; dynamic `ModelRef`; legacy model migration; provider-level Context fallback; `/providers`; dynamic `/models`; explicit experimental/unavailable Codex OAuth broker; full CLI/Harness regression and build verification.

## Architecture Decisions

- Separate `ProviderId` from `ProviderKind`; multiple user-defined custom providers can coexist.
- Replace closed `SupportedChatModelId` authority with `{ providerId, modelId }` `ModelRef` semantics.
- Built-in/recommended model catalogs are defaults/UX hints, not the only permitted models.
- Provider configuration and authentication are separate seams.
- User-global provider configuration is stored locally; project config may select a provider/model but must not contain credentials.
- Raw provider secrets remain outside JSON config behind `CredentialStore`.
- Custom Provider V1 is OpenAI-compatible and may use API Key/Bearer/None auth.
- Codex OAuth is a distinct experimental OpenAI auth strategy; it must not scrape private token files or assume undocumented token semantics.
- Anthropic OAuth is intentionally not designed. Google OAuth/Vertex/ADC are later research items.

## Dependency Graph

```text
Provider domain model
  -> Provider Registry + config persistence
      -> Credential Store + auth strategies
          -> Built-in provider adapters
          -> Custom OpenAI-compatible adapter
              -> dynamic ModelRef / Context profile integration
                  -> /providers + /models UX
                      -> migration + full regression
```

## Phase 1: Provider Domain & Registry

### Task 1: Replace closed provider identity with ProviderId / ProviderKind

**Description:** Introduce the provider domain model required by ADR-0023 and remove Mistral from the accepted built-in provider surface. Keep current Session/Context compatibility while creating an explicit migration path away from the closed `SupportedProvider` and `SupportedChatModelId` assumptions.

**Acceptance criteria:**
- Built-in provider kinds are exactly `openai | anthropic | google | deepseek`.
- `custom` is a provider kind, not a singleton provider identity; arbitrary stable `ProviderId` values can coexist.
- Mistral is removed from the built-in catalog/types/UI and no stale resolver/config path exposes it as supported.

**Verification:** shared + CLI focused type/tests for provider identity and catalog compatibility.

**Dependencies:** None.

**Files likely touched:**
- `packages/shared/src/models.ts`
- `packages/cli/src/lib/models.ts`
- `packages/cli/src/lib/provider-runtime.ts`
- model-related tests/UI.

**Estimated scope:** Medium.

### Task 2: Add user-global Provider Registry and strict persisted config

**Description:** Add a deep Provider Registry module backed by user-global local configuration, planned as `~/.more-more-code/providers.json`. Registry persistence owns non-secret provider configuration only and uses strict versioned validation/migration.

**Acceptance criteria:**
- Provider config is user-global and independent from project `.more-more-code/config.json`.
- Multiple custom providers can be added/edited/removed by stable ID.
- Unknown/invalid fields, duplicate IDs, invalid base URLs, and unsupported protocol/auth combinations fail deterministically rather than being silently ignored.

**Verification:** disposable-home tests for first-run creation, load/save/reload, invalid config, duplicate IDs, and migration/version rejection.

**Dependencies:** Task 1.

**Files likely touched:**
- new CLI provider registry/config module(s)
- CLI bootstrap/environment integration
- focused provider config tests.

**Estimated scope:** Medium.

## Checkpoint: Provider Registry

- Four built-in provider kinds plus multiple custom provider IDs are represented without model execution changes leaking into Harness.
- `providers.json` stores no raw secret values.
- Existing project Agent Config remains valid and cannot become a credential store.

## Phase 2: Credential & Authentication Seams

### Task 3: Add CredentialStore and API-key authentication

**Description:** Introduce the local secret-storage interface used by provider auth resolution. Prefer an OS-native adapter where practical; if a production-quality OS adapter cannot be delivered in one slice, add an explicitly scoped encrypted/local adapter behind the same interface without weakening the JSON-config rule.

**Acceptance criteria:**
- Provider config stores only credential references, never plaintext API keys.
- OpenAI, Anthropic, Google, DeepSeek, and custom providers can resolve API-key/Bearer credentials through one auth seam.
- Credential values are never included in Provider Registry diagnostics, Runtime Events, Session Entries, logs, or ProcessSandbox safe child environments.

**Verification:** credential round-trip/redaction tests plus negative checks for config/event/log serialization.

**Dependencies:** Task 2.

**Files likely touched:**
- new CredentialStore module/adapters
- provider auth resolver
- provider/config tests.

**Estimated scope:** Medium.

### Task 4: Add OpenAI Codex OAuth strategy behind an experimental broker seam

**Description:** Model `codex-oauth` as a distinct OpenAI authentication strategy. Integrate only through a supported Codex account/login surface that can be wrapped without making Codex the AgentLoop. If the current official integration contract is insufficient for native ModelProvider execution, ship the seam/status UX without an unsafe token-copy fallback and keep the strategy explicitly unavailable/experimental until the contract can be satisfied.

**Acceptance criteria:**
- `codex-oauth` is not represented as an ordinary API-key string.
- No implementation reads/copies private `~/.codex` token files or persists Codex access/refresh tokens into MORE-MORE-CODE provider config.
- Unsupported/unavailable OAuth execution fails explicitly and suggests API-key auth rather than silently switching credentials.

**Verification:** auth-state tests with mocked broker/account responses; source review for direct token-file access; no network-dependent test required for deterministic suite.

**Dependencies:** Task 3.

**Files likely touched:**
- OpenAI auth adapter/broker
- Provider Registry auth state
- provider settings UX/tests.

**Estimated scope:** Medium.

## Phase 3: Provider Adapters & Dynamic Models

### Task 5: Implement the four built-in adapters and Custom OpenAI-compatible adapter

**Description:** Make Provider Registry resolve provider configuration/auth into Vercel AI SDK models while preserving the existing provider-independent Context and provider-specific request compiler seam.

**Acceptance criteria:**
- OpenAI, Anthropic, Google, and DeepSeek resolve through configured provider accounts instead of ambient-only globals.
- Custom OpenAI-compatible providers support configurable `baseURL`, auth strategy, and configured model IDs without adding branches to AgentLoop/ContextManager.
- Invalid/missing credentials and unsupported provider protocol combinations fail before Model Step network side effects.

**Verification:** provider adapter contract tests with mocked/fake endpoints/configuration plus existing provider-runtime/cache tests.

**Dependencies:** Tasks 2-4.

**Files likely touched:**
- provider adapters/registry
- `packages/cli/src/lib/models.ts`
- `packages/cli/src/lib/provider-runtime.ts`
- `packages/cli/src/lib/local-model-transport.ts`
- provider tests.

**Estimated scope:** Medium.

### Task 6: Migrate model selection to dynamic ModelRef

**Description:** Replace canonical runtime reliance on compile-time `SupportedChatModelId` with `{ providerId, modelId }`. Keep recommended model metadata/pricing/context defaults available without turning that catalog back into an allowlist.

**Acceptance criteria:**
- Session runtime/config/model-change semantics can represent arbitrary configured custom-provider model IDs.
- Context profile resolution has deterministic fallback/default behavior for unknown-but-configured models.
- Existing stored Sessions that contain only legacy model IDs restore through a deterministic migration/lookup path.

**Verification:** Session restore/model-change migration tests, Context profile tests, custom-provider model selection tests.

**Dependencies:** Task 5.

**Files likely touched:**
- shared model/session types
- Harness Session runtime projection types where required
- CLI prompt config/model dialogs
- Context profile/model resolution tests.

**Estimated scope:** Medium.

## Checkpoint: Provider Runtime

- Harness remains provider-independent.
- Four built-in providers and at least two simultaneous custom Provider IDs can resolve model references through the same runtime seam.
- Legacy Session model metadata restores without destructive rewrite.

## Phase 4: UX, Documentation & Delivery

### Task 7: Add Provider management UX and complete Stage 6.4 delivery

**Description:** Add `/providers` management/status UX and refactor `/models` to list models by configured provider account. Document local provider config, auth strategies, secret handling, Custom Provider V1, Codex OAuth experimental semantics, and migration behavior.

**Acceptance criteria:**
- User can inspect built-in/custom provider status and add/edit/remove custom provider definitions without manually editing JSON.
- `/models` is driven by configured Provider Registry/model references rather than the old fixed catalog alone.
- Documentation and `/settings`/help clearly distinguish provider configuration, credential storage, project model selection, and OAuth experimental state.

**Verification:** CLI interaction/unit tests where feasible; full CLI/Harness/shared suites, typechecks/build, `git diff --check`, security review for secret leakage.

**Dependencies:** Tasks 1-6.

**Files likely touched:**
- command menu/dialog/provider/model UI
- README / CONTEXT / PROJECT_ANALYSIS / current-state docs / CHANGELOG
- ADR-0023 implementation-status update.

**Estimated scope:** Medium.

## Stage 6.4 Final Verification

- Shared/Harness/CLI tests and typechecks pass.
- CLI build succeeds.
- Provider configuration tests use disposable homes and leave no real credentials behind.
- No plaintext provider credential appears in `providers.json`, project config, Session state, Runtime Events, logs, or child-process safe environment.
- Custom-provider and legacy Session migration tests pass.
- `git diff --check` passes.

## Explicitly Deferred from Stage 6.4

- Anthropic OAuth.
- Google OAuth / Gemini Code Assist login / Vertex ADC.
- Arbitrary custom provider protocols beyond OpenAI-compatible.
- External-Agent backend mode for Codex/Claude Code/Gemini CLI.
- Server-side model proxy or centralized provider credentials.

---

# Stage 6.5 — Local Session Authority & Railway Retirement

**Status:** Delivered — 2026-08-26. Final integrated review and full repository verification completed at delivery time. A subsequently discovered AI SDK runtime-message JSON compatibility defect is now tracked as the documented Stage 6.5 Durable Message Normalization follow-up below; explicit legacy import remains a separate non-blocking follow-up. Depends on completed Stage 6.4.

## Overview

Make the local CLI authoritative for semantic Session lifecycle so MORE-MORE-CODE can create/list/open/continue Sessions with no Server, account, `API_URL`, Cloudflare Worker, or Railway application. The existing cloud `POST /sessions`, `GET /sessions/:id`, and whole-state persistence calls are removed from the CLI path rather than retained as a fallback.

The Local Session Store is separate from the Local Runtime Store even when both use SQLite: Session Entries are durable conversation semantics/branch topology; Runtime Events are execution/security/recovery facts.

## Phase 1: Local Session Store Foundation

### Task 1: Define the LocalSessionStore interface and persistence schema

**Acceptance criteria:**
- [x] Deep interface supports local create/load/list/atomic commit/archive using validated Harness Session Tree semantics.
- [x] Schema preserves root/active Entry identity, parent topology, stable sequence, metadata, idempotency, and versioned migrations.
- [x] Runtime Event/Snapshot schema is not merged into the Session Store.
- [x] The package typechecks and has a focused test script.

**Verification:** `bun run --cwd packages/session-store test` (11 pass) and `bunx tsc --noEmit -p packages/session-store/tsconfig.json` (pass).

**Dependencies:** Stage 6.4 complete.

### Task 2: Make local Session creation/list/open independent of apiClient

**Acceptance criteria:**
- [x] `NewSession`, Session list, and Session open work with no Server/API URL available.
- [x] Local Session IDs/titles/timestamps and Session Tree restore are authoritative.
- [x] Cloud/account login is not required to use the coding agent.
- [x] A Session is locally committed before the CLI navigates to it.

**Verification:** focused CLI local-session tests pass, including create/list/open/restart/continue with a fetch guard that rejects Server access.

**Dependencies:** Task 1.

## Phase 2: Append Persistence & Migration

### Task 3: Replace whole-tree best-effort persistence with local append/update transactions

**Acceptance criteria:**
- [x] New semantic Entries are durably local before they are considered available for later local restore.
- [x] Append-after-history preserves branch topology without rewriting sibling history.
- [x] Device UI/navigation state such as `activeEntryId` has an explicitly local persistence policy rather than being conflated with cloud semantic state.
- [x] Local commit failure prevents the corresponding Provider/Tool side effect and does not expose an uncommitted tree.

**Verification:** Session Store transaction/topology/idempotency tests and focused CLI durable-first/compaction tests pass.

**Dependencies:** Task 2.

### Task 4: Retire Railway and disable cloud account/Session surfaces

**Acceptance criteria:**
- [x] The Cloudflare Railway proxy, root Wrangler scripts/dependency, and Railway instructions are removed.
- [x] CLI startup, Session lifecycle, Provider execution, and local builds do not import the Server or read `API_URL`.
- [x] `/login` and `/logout` are absent while cloud accounts are disabled; Server/database packages may remain dormant.

**Verification:** removed-file/reference review plus `bunx tsc --noEmit -p packages/cli/tsconfig.json` and `bun run build:cli` (both pass). Historical ADR references are retained intentionally.

**Dependencies:** None; may run in parallel with Tasks 1-3 after file ownership is separated.

### Task 5: Make Provider selection verifiable and capability-gate OAuth

**Acceptance criteria:**
- [x] `/providers` reports configured credential state and can test the resolved Provider endpoint without revealing a secret.
- [x] `/models` selection persists as the local default and is restored after restart.
- [x] Unsupported OAuth choices are hidden; Codex OAuth is exposed only if a supported broker provides a documented model-execution contract.

**Verification:** provider connection/default persistence tests pass with injected/fake transports; no real credential or external-provider E2E is claimed.

**Dependencies:** Stage 6.4 complete; may run in parallel after the Session/Provider persistence contract is fixed.

## Phase 3: Local-only Delivery & Follow-up

### Task 6: Add explicit idempotent legacy import

**Acceptance criteria:**
- [ ] Linear/v1/v2/v3 fixtures import transactionally with deterministic identity where source IDs are absent.
- [ ] Repeating the same import does not duplicate Entries; content conflicts are explicit.
- [ ] Import never fetches remote state during startup/open and never destroys its source.

**Verification:** fixture-based import, rollback, and idempotency tests.

**Dependencies:** Tasks 1 and 3.

**Current status:** [ ] Not implemented. This is an explicit, non-blocking follow-up for importing legacy linear/v1/v2/v3 snapshots; it must remain transactional and idempotent without adding a startup cloud fetch.

### Task 7: Verify and document the local-only guarantee

**Acceptance criteria:**
- [x] Core CLI startup/session/model/tool workflow has no mandatory Server call.
- [x] With global `fetch` rejecting cloud/API URL access, create -> list -> open -> submit fake Provider -> checkpoint/cache -> restart -> continue succeeds.
- [x] Session Store and Runtime Store remain separate and both recover after restart.
- [x] README/current-state/ADR-0023/ADR-0024 accurately state that Local Session Store is semantic authority and Railway is retired.

**Verification:** final integrated review completed after fixing the production default Session UUID path and stabilizing the Provider-dialog interaction test. Local Session Store tests pass (11), Runtime Store tests pass (8), Harness tests pass (99), CLI tests pass (143), Shared/Harness/CLI/Runtime Store/Session Store/Server/Database TypeScript checks pass, CLI and Server builds pass, both Prisma schemas validate, CLI source has no mandatory `API_URL`/Server/login Session dependency, and `git diff --check` passes. No real external-Provider E2E is claimed.

**Dependencies:** Tasks 1-5; legacy import is a non-blocking follow-up.

## Explicitly Deferred from Stage 6.5

- Explicit transactional/idempotent import of legacy linear/v1/v2/v3 Session state (non-blocking follow-up).
- All cloud sync and commercial-account integration, including Stage 6.6, until explicitly re-approved.
- Cloud Runtime Event synchronization.
- Team/collaborative live editing.
- Codex/ChatGPT OAuth through undocumented cached-token reuse or an external-Agent substitution.

---

# Stage 6.5 Follow-up — Durable Message Normalization Boundary

**Status:** Delivered — 2026-08-26. Real Red reproduction, single CLI normalization seam, integration regressions, restart/idempotency coverage, full verification, and delivery documentation are complete.

## Overview

Add one CLI-owned semantic adapter that converts Vercel AI SDK runtime `Message` values into canonical JSON-safe durable Session messages before Harness constructs Session Entries. This addresses the production failure `Session Tree state.entries[...].message.parts[...].providerMetadata must be JSON-safe` without weakening `LocalSessionStore` validation or deleting valid Provider metadata.

The accepted design is defined by ADR-0025 and `docs/DURABLE-MESSAGE-NORMALIZATION-DESIGN.md`. Verification is defined by `docs/DURABLE-MESSAGE-NORMALIZATION-TEST.md`, and delivery boundaries are defined by `docs/DURABLE-MESSAGE-NORMALIZATION-DELIVERY.md`.

## Phase 1: Contract and Red Reproduction

### Task 1: Add durable-message normalization contract tests

**Acceptance criteria:**
- [x] A focused adapter seam specifies object `undefined` omission and array/sparse `undefined` -> `null` semantics.
- [x] Valid JSON-safe Provider metadata and `__proto__` data are preserved without input mutation.
- [x] Non-finite numbers, bigint, function, symbol, cycles, symbol properties, and non-plain objects are not silently coerced.

**Verification:** focused `durable-session-message` tests.

**Dependencies:** ADR-0025/design approval complete.

### Task 2: Reproduce the real persistence failure before implementation

**Acceptance criteria:**
- [x] A real local semantic commit containing an assistant part with `providerMetadata: undefined` fails red on the pre-fix implementation.
- [x] The failure reaches the strict Session persistence boundary rather than a synthetic private helper.
- [x] The fixture models the AI SDK runtime shape without requiring a real external Provider credential.

**Verification:** focused CLI local-session integration test demonstrates the pre-fix failure.

**Dependencies:** Task 1 seam definition; test may be authored as the first vertical TDD slice.

## Phase 2: Single Normalization Seam

### Task 3: Implement the CLI durable-message adapter and normal sync integration

**Acceptance criteria:**
- [x] One Session-specific adapter owns normalization semantics; no generic stringify/parse sanitizer is introduced.
- [x] Normal `syncMessagesToTree` paths normalize before Harness Session Tree construction.
- [x] Runtime/UI messages are not mutated.

**Verification:** Tasks 1-2 turn green through the public persistence seam.

**Dependencies:** Tasks 1-2.

### Task 4: Route compaction and Tool-terminal message persistence through the same policy

**Acceptance criteria:**
- [x] Compaction history pre-sync uses the same durable-message adapter.
- [x] Existing Tool-terminal private `undefined` policy is consolidated rather than duplicated.
- [x] Tool terminal remains commit-before-expose and compaction remains one semantic authority transition.

**Verification:** focused Tool durability and compaction regression tests.

**Dependencies:** Task 3.

## Phase 3: Idempotency, Restart, and Delivery

### Task 5: Verify semantic idempotency and restart round-trip

**Acceptance criteria:**
- [x] Re-syncing a runtime message that differs only by explicit optional `undefined` does not append redundant `message_update` Entries.
- [x] Valid Provider metadata survives commit/restart; omitted optional fields remain absent.
- [x] Restart/continue remains local-only with no Server/API_URL dependency.

**Verification:** focused local Session restart/continue integration tests.

**Dependencies:** Tasks 3-4.

### Task 6: Complete full verification and update delivered-state documentation

**Acceptance criteria:**
- [x] CLI, Session Store, and Harness suites pass.
- [x] CLI/Session Store TypeScript checks and CLI build pass.
- [x] `git diff --check` passes and unrelated worktree changes are not included.
- [x] ADR/design/test/delivery/current-state docs are changed from planned to delivered only after evidence exists.

**Verification:** full matrix in `docs/DURABLE-MESSAGE-NORMALIZATION-TEST.md`.

**Dependencies:** Tasks 1-5.

## Deferred / Out of Scope

- weakening Store JSON validation;
- dropping all Provider metadata;
- Provider endpoint/runtime behavior changes;
- Session/Runtime Store schema changes;
- Stage 6.6 cloud sync/account work;
- legacy Session import;
- Windows sandbox work.

---

# Stage 6.6 — Cloud Session Sync & Commercial Entitlements

**Status:** Paused — Stage 6.5 is delivered; requires explicit product re-approval before cloud sync or commercial-account work resumes.

## Overview

Refactor the Server into optional cloud-product infrastructure: account/subscription entitlements plus multi-device Session synchronization/backup. Replace current whole-state last-write-wins semantics with append-oriented, idempotent synchronization that preserves independent branches created on different devices.

## Phase 1: Sync Protocol

### Task 1: Define append-oriented Session sync contracts

**Acceptance criteria:**
- Protocol identifies Session/Entry IDs, parent topology, revision/cursor and idempotency semantics.
- Re-sending the same Entry is safe and does not duplicate history.
- Two devices appending different children from the same ancestor preserve both branches.

**Verification:** pure protocol/merge property tests.

**Dependencies:** Stage 6.5 complete.

### Task 2: Implement Server persistence for sync entries/cursors

**Acceptance criteria:**
- Server validates account ownership and append-only Entry shape.
- Sync storage cannot overwrite an unrelated branch through whole-state replacement.
- Schema/migration path is explicit and backward migration/import is documented.

**Verification:** database/server integration tests and Prisma validation/migration checks.

**Dependencies:** Task 1.

## Phase 2: Client Sync Engine

### Task 3: Add offline queue, push/pull cursors, and conflict-safe merge

**Acceptance criteria:**
- Local writes succeed while offline and queue for later sync.
- Retry is idempotent after network/process interruption.
- Pull merges unseen Entries without replacing local branches or local device UI state.

**Verification:** two-device simulation, offline/reconnect/retry tests, duplicate-delivery tests.

**Dependencies:** Task 2.

### Task 4: Define shareable vs device-local Session state

**Acceptance criteria:**
- Semantic Entries and approved shareable metadata sync.
- `activeEntryId`, expanded nodes, scroll position, transient runtime/approval state do not sync by default.
- Any cross-device "latest semantic position" is an explicit semantic field, not reuse of device navigation state.

**Verification:** serialization/merge tests and documentation review.

**Dependencies:** Task 3.

## Phase 3: Commercial Entitlements & Delivery

### Task 5: Keep subscription/entitlements outside Agent critical path

**Acceptance criteria:**
- Server account/billing maps to explicit cloud feature entitlements such as sync/backup.
- Entitlements can be cached with bounded validity; transient Server failure does not disable local model/tool execution.
- Provider credentials/model usage remain user-to-provider and are not proxied through MORE-MORE-CODE billing.

**Verification:** entitlement cache/offline tests, Server/CLI integration tests, security/privacy review.

**Dependencies:** Tasks 1-4.

## Explicitly Deferred from Stage 6.6

- Team collaborative editing and shared live presence.
- Server-owned provider billing/model proxy.
- Runtime Event/approval event cloud synchronization.

---

# Stage 6.7 — Windows Native Sandbox

**Status:** Planned — reordered from the former Stage 6.4 recommendation after ADR-0023.

## Overview

Resume the Stage 6.3 ProcessSandbox security roadmap after Provider Runtime, Local Session authority, and optional Cloud Sync are established. Design a Windows native isolation adapter using AppContainer/restricted-token/Job-object or an equivalently defensible mechanism, with explicit filesystem/network/process guarantees and cross-platform E2E verification.

The existing Stage 6.3 requirements remain unchanged: direct fallback is not OS isolation, hard restrictions fail closed, and Permission/Approval/ToolRuntime/ProcessSandbox remain separate seams.
