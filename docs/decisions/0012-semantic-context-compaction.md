# ADR-0012: Semantic Context Compaction

## Status

Accepted

## Date

2026-08-14

## Context

The existing Context Manager already preserves complete Turn groups, keeps a retained recent tail, and can replace omitted history with a persisted compaction checkpoint. The first CLI compactor, however, is a bounded deterministic chronology and only runs after normal projection has already truncated input. That leaves two problems for long-running coding-agent sessions:

1. the runtime approaches the provider limit too closely before reclaiming headroom, especially when later Tool Steps may add large outputs;
2. repeated chronology compression does not maintain a durable representation of current goals, decisions, constraints, artifact state, failures, and pending work, so chained compaction can degrade into summary-of-summary information loss.

Compaction must remain a Context optimization. It must not mutate or delete the append-only Session Tree, become a second Session authority, or be conflated with Branch Summary.

## Decision

### Budget-aware proactive compaction

Context compaction uses three utilization levels over the effective input budget:

- soft limit: 80%;
- hard limit: 92%;
- post-compaction target: 70%.

The values are application policy and remain model-profile configurable. Overflow still forces compaction when possible, but the runtime may proactively compact at the soft or hard threshold before provider rejection is imminent.

A compaction trigger is recorded as `soft-limit`, `hard-limit`, or `overflow` together with before/after token estimates, the effective input budget, the post-compaction target, summary budget, compacted-through message identity, and retained message identities.

### Safe cut points are atomic Context groups

Only optional `historical-conversation` records are eligible for compaction. Context groups are atomic: a Turn or other grouped interaction is either retained or compacted as a whole. Required records, retained recent Turns, stable instructions, dynamic continuation state, and current input are not split to satisfy a token boundary.

The selector keeps the newest eligible complete groups that fit the post-compaction working-set target and compacts the older contiguous prefix. This creates headroom without cherry-picking disconnected older records.

### Compaction is incremental state reduction

For checkpoint `N+1`, the reducer receives:

- the previous effective checkpoint, if one exists; and
- only the newly compacted history since that checkpoint.

The reducer must return one complete replacement snapshot. It is explicitly instructed to apply new events to previous state, preserve still-valid facts, remove superseded facts, and prefer current truth over a chronological narrative.

The canonical semantic snapshot uses fixed Markdown sections:

- Current Goal;
- Current State;
- Decisions;
- Constraints;
- Artifacts;
- Failures and Lessons;
- Pending Work.

This schema is intentionally semantic rather than provider-specific. The Harness owns compaction policy, safe source selection, token bounds, and metadata. The CLI/provider seam owns the LLM reduction call.

### Failure fallback

Semantic reduction is best-effort. If the reducer call fails, returns empty output, or cannot produce a checkpoint within the allowed summary budget, the CLI falls back to the bounded deterministic compactor. A compaction-provider failure therefore does not automatically fail the primary model step when a safe deterministic checkpoint can still be produced.

### Persistence and checkpoint reuse

The resulting checkpoint is appended as a durable `compaction` Session Entry. Older checkpoints and source messages remain unchanged in Session history. Subsequent model requests reuse the latest effective checkpoint until a new real compaction occurs; they do not regenerate an equivalent snapshot every step.

Branch Summary remains a separate knowledge-transfer operation for moving between Session branches. It does not share Compaction's trigger policy or state-snapshot contract.

## Alternatives Considered

### Compact only after provider-budget truncation

- Pros: fewer summary calls.
- Cons: leaves little safety headroom for Tool Steps and output variance and makes context-limit failures more likely.
- Rejected: proactive soft/hard thresholds provide a controlled margin.

### Summarize the complete conversation on every compaction

- Pros: conceptually simple.
- Cons: repeatedly reprocesses the same source, wastes tokens, destabilizes prefix reuse, and increases summary drift.
- Rejected: compact the previous checkpoint plus newly compacted history only.

### Append a delta summary to the previous checkpoint

- Pros: cheap and easy to implement.
- Cons: stale/superseded decisions accumulate and future models must reconcile multiple versions of truth.
- Rejected: every new checkpoint is a complete replacement state snapshot.

### Put LLM summarization inside the Harness

- Pros: one module appears to own all compaction behavior.
- Cons: couples canonical Context management to provider/model execution and weakens the provider-independent seam.
- Rejected: Harness selects and bounds; CLI/provider adapter performs semantic reduction.

### Fail the model step when semantic reduction fails

- Pros: strongest guarantee that every checkpoint is semantic.
- Cons: makes a secondary optimization a new availability dependency for primary agent execution.
- Rejected: deterministic bounded fallback preserves forward progress.

## Consequences

- Long-running sessions reclaim headroom before hard provider overflow in normal cases.
- Cut points remain semantically safe at complete Context-group boundaries.
- Chained checkpoints behave as state updates instead of narrative summaries of summaries.
- Explicit decisions, constraints, artifact state, unresolved failures, and pending work receive stable retention priority through the snapshot schema.
- Session restore remains `Session Tree + activeEntryId`; compaction metadata improves diagnostics without creating another authority.
- Semantic compaction adds an extra model call only when a real checkpoint is created.
- Exact tokenizer support, working-set relevance scoring, tool-result pruning/reference storage, dedicated compaction-model selection, and Branch Summary semantics remain future work.
