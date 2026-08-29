# ADR-0013: Tool Result Working Set and Manual Compaction

## Status

Accepted. The age/aggregate-pressure projection policy in this ADR is
superseded by ADR-0030; Session authority, strategy-aware projection and manual
Compaction boundaries remain accepted.

## Date

2026-08-14

## Context

Semantic Context Compaction (ADR-0012) can reclaim older conversational history safely, but a coding-agent Turn may also contain very large Tool Results: shell logs, test/build output, grep matches, or file bodies. Treating every large Tool Result as ordinary history creates two failure modes:

1. a recent oversized observation can repeatedly force historical Compaction even though the durable Session history itself does not need another checkpoint;
2. deleting or overwriting Tool Result payloads to save model tokens would make Session history incomplete and break the append-only Session authority.

Users also need an explicit way to request safe compaction before the automatic soft/hard thresholds are reached.

Tool Result Pruning, historical Compaction, and Branch Summary therefore need separate contracts.

## Decision

### Three different reduction mechanisms

- **Tool Result Pruning** is an ephemeral model-facing working-set projection. It reduces oversized Tool Result payloads while the complete canonical `tool_result` Session Entry remains unchanged.
- **Historical Compaction** replaces eligible older conversation Context with one persisted semantic state checkpoint. It never deletes source Session Entries.
- **Branch Summary** is knowledge transfer between branches and remains independent from both mechanisms.

The model request pipeline is:

```text
active Session branch
  -> Tool Result working-set projection
  -> canonical Context records
  -> Context budget / compaction policy
  -> provider request
```

Pruning therefore gets the first chance to remove Tool-output noise before historical Compaction is considered.

### Provider-independent Tool Result working-set policy

The Harness owns Tool Result projection contracts, freshness, working-set budgeting, and over-budget signaling. The default application policy derives all limits from the effective model input budget:

- Tool Result working set: 25%;
- individual full-result threshold: 6%;
- compact reference target: 0.6%.

These are profile policy values rather than provider limits.

Tool Results move through a small model-visible lifecycle:

```text
fresh -> warm -> cold/reference-eligible
```

Fresh/current results are non-prunable for their immediate continuation step whenever possible. If fresh/required Tool Results alone exceed the Tool Working Set budget, the projection reports `overBudget`; it does not silently discard required state.

### Strategy-aware deterministic V1 projections

The CLI owns concrete deterministic projection strategies because it understands native Tool output shapes. V1 supports:

- small results: full payload;
- generic oversized results: bounded truncation/reference;
- shell: exit status, error-bearing lines, useful head/tail;
- test/build: exit status plus failures/errors/warnings before routine context;
- search/grep: bounded matches with file/line locations;
- file read: bounded head/tail content plus durable source reference.

A projected payload records its tool identity, status, projection mode, original-token estimate, and durable Session Entry reference when available. Only a cloned model-facing UI message is modified; the Session Tree and canonical Tool Result payload remain complete.

### Manual `/compact`

`manual` is a fourth `ContextCompactionTrigger` alongside `soft-limit`, `hard-limit`, and `overflow`.

`/compact` is a request to compact now, not an unconditional force operation. Before invoking the reducer, ContextManager evaluates a deterministic manual-compaction eligibility gate. The default policy requires:

- safely compactable history of at least `max(2048 tokens, 3% of effective input budget)`;
- when an effective checkpoint already exists, at least 2 newly completed Turns since that checkpoint and enough history to satisfy the same compactable-token floor;
- conservative estimated savings of at least `max(1024 tokens, 2% of effective input budget)`;
- conservative savings of at least 30% of the checkpoint replacement source.

The repeat-compaction gate is based on Session/checkpoint progress, not elapsed wall-clock time. Previous retained-tail message IDs stored by the checkpoint are excluded when counting newly completed Turns, so restoring a Session does not reset or weaken the gate. A rejected request returns a typed `nothing-compactable`, `insufficient-history`, `recent-compaction`, or `insufficient-gain` no-op before any semantic reducer call.

Once eligible, `/compact` invokes the same ContextManager source-selection, semantic reducer, deterministic fallback, checkpoint metadata, and Session persistence path as automatic compaction. The manual trigger bypasses automatic utilization thresholds only. It does not bypass:

- complete Context group/Turn boundaries;
- retained/current required records;
- replacement-checkpoint semantics;
- active-branch isolation;
- append-only Session persistence.

The command does not manufacture a user message or Agent Turn to run compaction. Successful manual compaction emits exactly one durable `compaction` Entry with `trigger = manual`.

## Alternatives Considered

### Delete old Tool Result payloads from Session history

Rejected. It saves storage/context simultaneously but destroys the complete semantic Session history and makes later branch inspection/recovery lossy.

### Let every large Tool Result force historical Compaction

Rejected. Tool-output noise and long-term conversation state have different lifecycles. A local oversized observation should be reducible without creating a new semantic checkpoint.

### Use one universal character slice for all tools

Rejected. Shell failures, test diagnostics, grep locations, and file contents have different high-value regions. Strategy-aware deterministic projections preserve more actionable information at the same budget.

### Implement `/compact` as a synthetic user prompt

Rejected. That would create a fake user message/Turn and duplicate compaction semantics in the command layer. Manual compaction is a runtime control operation, not conversation content.

### Make manual compaction ignore retained/current records

Rejected. A manual command should not weaken the invariants that make automatic checkpoints safe. More aggressive modes such as `/compact --all` remain explicitly deferred.

### Use a wall-clock cooldown after manual compaction

Rejected. Five minutes may contain no useful new context or many large Tool/Model Turns. Checkpoint-relative Turn/token progress survives restore and measures the actual reason another compaction might be useful.

### Use one weighted eligibility score

Rejected for V1. Independent gates for safety, incremental progress, and estimated savings are deterministic, explainable to the user, and easier to tune without accidental interactions between unrelated weights.

## Consequences

- Large warm Tool Results can be reduced without mutating durable Session history or necessarily creating a Compaction checkpoint.
- Historical Compaction receives a smaller, cleaner working set and runs only when pruning is insufficient or explicitly requested.
- Immediate Tool continuation keeps current observations available under normal budgets.
- `/compact` is branch-local, safe below automatic thresholds, and uses the same checkpoint/reducer pipeline as automatic compaction, but refuses low-history, too-recent, and low-benefit requests before paying reducer cost.
- Tool Result V1 remains deterministic; LLM per-result summarization, external blob storage, arbitrary relevance scoring, and aggressive manual flags remain future work.
