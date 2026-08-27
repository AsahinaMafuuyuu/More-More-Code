# Session Navigation Projection & Finalized Message Persistence Delivery Contract

**Delivery state:** Delivered and verified — 2026-08-27.

**Target:** Stage 6.5 local Session authority follow-up. This is not Stage 6.6 and does not include Usage/Context Window observability.

## 1. User Requirement

The Session Tree should remain a durable semantic authority, but `/tree` should behave like a human-readable navigation tree rather than expose persistence internals.

The accepted user-facing behavior is:

```text
user: ...
assistant: ...
[read: ...]
[bash: ...]
assistant: ...
```

Ordinary progression is visually flat. Nesting appears only when the Session truly branches.

`message_update` should no longer be created for normal new conversations. Tool execution should appear as one Tool Use in UI/navigation while retaining separate canonical request/result facts underneath.

## 2. Accepted Architecture

### Finalized message persistence

- streamed message deltas remain runtime/UI state;
- each completed AgentLoop Model Step is normalized and appended once as an immutable `assistant_message`;
- AI SDK aggregate `UIMessage.id` is runtime/UI identity only; durable assistant identity is derived from `stepId`, and only the current `step-start` segment is persisted;
- existing Entries are never mutated;
- historical `message_update` Entries remain readable but new normal flows stop producing them.

### Tool durability

- `tool_call` remains a separate durable request fact;
- external Tool execution starts only after that request commits;
- `tool_result` remains a separate durable terminal fact;
- Provider continuation starts only after the terminal result commits;
- terminal Tool state is derived in projection rather than persisted again through `message_update`.

### Navigation projection

- `/tree` consumes a Navigation Tree Projection, not raw Entries;
- legacy `message_update` is always folded;
- Tool Call + Tool Result are shown as one derived ToolUse row;
- a terminal ToolUse navigates to the terminal `tool_result` Entry;
- hidden Entries are topology-transparent;
- single-child visible chains stay flat;
- only real visible branch points create nested tree structure.

## 3. Required Deliverables

### D1 — Projection Contracts

Add or deepen reusable projection seams for:

```text
Session Entry Tree -> Message Projection
Session Entry Tree -> Navigation Tree Projection
tool_call + tool_result -> ToolUse projection
```

Projection logic must be deterministic and non-mutating.

### D2 — Finalized Message Persistence

Normal new assistant execution must append one finalized `assistant_message` per completed AgentLoop Model Step rather than a chain of `message_update` Entries. Tool continuation may reuse one AI SDK assistant `UIMessage.id`; this must produce distinct step-scoped durable assistant Entries rather than an incompatible rewrite.

### D3 — Tool Terminal Persistence Refactor

Remove normal Tool terminal message write-back while preserving request-before-side-effect and result-before-continuation durability gates.

### D4 — `/tree` Integration

Render/navigation must use semantic projected nodes and canonical target Entry IDs. The existing branch-summary Carry controller remains the only navigation mutation policy.

### D5 — Legacy Compatibility

Existing v3 Sessions containing `message_update` must load, project, navigate and continue correctly without destructive rewrite.

### D6 — TDD and Regression Evidence

Implement the full test contract in `docs/SESSION-NAVIGATION-PROJECTION-TEST.md`, including real Red regressions before behavior changes.

### D7 — Current-state Documentation

Only after implementation and verification succeed may README/CONTEXT/PROJECT_ANALYSIS/CHANGELOG or this delivery state be changed to claim the behavior is delivered.

## 4. Explicit Non-Deliverables

The implementation must not include:

- Usage/token cost aggregation;
- Context Window/model-capability UI;
- Provider pricing changes;
- cloud Session sync or commercial entitlement work;
- Runtime Store schema redesign;
- Local Session Store table/schema redesign unless a new ADR is approved first;
- parallel Tool execution;
- MCP/provider/tool protocol expansion;
- Windows Sandbox work;
- persisted partial-model-stream recovery;
- physical deletion of historical `message_update` rows;
- unrelated visual redesign outside `/tree`/Tool projection integration.

## 5. Engineering Invariants

1. **Append-only semantic authority:** no existing canonical Entry is edited in place.
2. **Legacy readability:** historical `message_update` remains a supported read path during this delivery.
3. **No duplicate Tool truth:** terminal Tool output is canonically owned by `tool_result`; projection may clone it but must not persist another semantic copy solely for UI.
4. **Durable-first request:** `tool_call` commit precedes external Tool execution.
5. **Durable-first terminal:** `tool_result` commit precedes dependent Provider continuation.
6. **Canonical navigation target:** every selectable projected row resolves to an actual durable Entry ID.
7. **Projection purity:** no projection mutates source history or sibling branches.
8. **Provider continuity:** next-step model input remains semantically valid after Tool execution without `message_update`.
9. **Store separation:** Session Store remains semantic; Runtime Store remains execution/recovery/security.
10. **No silent scope expansion:** any required schema/version/parallel-runtime redesign stops this delivery until explicitly approved.
11. **Step-scoped assistant identity:** aggregate AI SDK `UIMessage.id` must never be treated as the immutable durable identity across multiple AgentLoop Model Steps.

## 6. Compatibility Boundary

The initial implementation should avoid a database migration.

Expected compatibility strategy:

```text
old Session:
  message_update remains in entryJson -> legacy replay -> hidden from navigation

new Session:
  finalized assistant_message(stepId) + tool_call + tool_result
    + later assistant_message(next stepId) -> derived projections
```

`message_update` may remain in TypeScript validation/types as a legacy-read kind even after all new-write paths are removed. Physical removal is a separate migration decision.

## 7. Required Failure Behavior

The redesign must fail closed rather than invent semantic history when:

- a Tool Result has no matching Tool Call;
- duplicate incompatible terminal Tool Results exist for one call;
- Message Projection cannot compile a valid Tool continuation;
- a Tool request is durably incomplete after restart;
- Session persistence fails before Tool execution;
- terminal persistence fails before Provider continuation.

An unresolved historical Tool request must not be auto-replayed because its external side effect may already have occurred.

## 8. Definition of Done

This delivery is complete only when:

- normal new assistant/tool flows create no `message_update` Entries;
- existing update-bearing Sessions remain readable and continuable;
- `/tree` contains no visible/selectable update nodes;
- one Tool Call/Result pair appears as one ToolUse row;
- ToolUse terminal selection restores terminal result state;
- flat-chain and real-branch layout matches the accepted semantics;
- Tool request/result durability gates remain verified;
- fake Provider Tool continuation remains valid without message write-back;
- Tool continuation that reuses one AI SDK assistant `UIMessage.id` persists distinct step-scoped assistant Entries without duplicating prior-step parts;
- compaction, Branch Summary, Tool Result Working Set and restart regressions pass;
- relevant Harness/CLI/Session Store suites, typechecks/build and `git diff --check` pass;
- unrelated `AGENTS.md` or other user changes are not included in the implementation commit;
- documentation is updated from planned to delivered only after evidence exists.

## 9. Rollback Boundary

Because the first implementation is expected to require no SQLite migration, rollback should be code-level:

- restore old new-write behavior if necessary;
- retain all Session Entries already written by the new design, which are ordinary existing Entry kinds (`assistant_message`, `tool_call`, `tool_result`);
- do not rewrite the database to recreate `message_update` Entries.

This rollback property is one reason the design prefers legacy-read compatibility over an immediate schema migration.

## 10. Documentation Delivery Record

The Stage 6.5 follow-up is implemented. During real CLI verification on 2026-08-27, a Tool-using conversation exposed a missing identity invariant: AI SDK v7 reused one assistant `UIMessage.id` across Tool continuation, causing the first implementation to reject the later accumulated message as an incompatible second finalization. The fix keeps `UIMessage.id` process/UI-scoped, derives durable assistant identity from AgentLoop `stepId`, and persists only the just-completed `step-start` segment. No Session Store or Runtime Store migration was introduced.

Verification evidence after the follow-up fix:

- CLI tests: **171 passed / 0 failed / 642 assertions**;
- Harness tests: **99 passed / 0 failed / 341 assertions**;
- Local Session Store tests: **11 passed / 0 failed / 41 assertions**;
- CLI TypeScript check: passed;
- Local Session Store TypeScript check: passed;
- CLI production build: passed;
- `git diff --check`: passed.

The external DeepSeek request that originally revealed the reused-message-id behavior was not used as the automated delivery gate; the regression instead reproduces the relevant AI SDK v7 aggregate-message behavior deterministically and verifies the following fake-Provider continuation path.
