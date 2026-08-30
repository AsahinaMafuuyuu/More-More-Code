# ADR-0011: Session Runtime Invariants

## Status

Accepted

## Date

2026-08-13

## Context

Stage 5 established deterministic Context Projection and persisted compaction checkpoints. The project now needs explicit invariants for branching history, chained compaction, and restore behavior.

## Decision

Session Entries are immutable durable facts. A new entry is appended as a child of the current `activeEntry` and becomes the new cursor. Continuing from an historical entry creates a branch rather than rewriting or deleting the previous branch.

Every historical `compaction` entry remains in the Session Tree. A newer checkpoint summarizes the previous effective checkpoint plus newly compacted history. Model input uses only the latest effective checkpoint on the active branch followed by retained post-checkpoint history.

Durable restore state is `Session Tree + activeEntryId`. Message history, model/mode/config runtime state, and the latest compaction checkpoint are projections of that active branch. No provider-owned conversation becomes a second Session authority.

Session event appearance is semantic theme data. Message, capability-call, compaction, state-change, branch, error/custom, and timestamp colors live in `ThemeColors`; UI components map entry semantics to those tokens.

Local capability handling receives a dedicated Runtime boundary. AgentLoop owns Run/Turn/Step orchestration and decides when a capability step occurs; the Runtime owns registry visibility, capability metadata, permission decisions, timeout/cancellation propagation, source selection, and normalized outcomes. Native capabilities are the first source. MCP remains a future source adapter.

Permission decisions use `allow | deny | ask`. At the time of this ADR, `ask` was normalized as fail-closed `approval_required`; ADR-0021 later adds a separate interactive Approval Broker that can resume the same Tool Step after an explicit one-time allow. OS-level sandbox enforcement remains separate. Durable result entries may add optional status/source/timing metadata while preserving existing output/error fields.

## Alternatives Considered

- Removing older checkpoints after a newer compaction was rejected because compaction is a Context optimization, not history garbage collection.
- Persisting a separate provider-context restore authority was rejected because it would compete with the Session Tree.
- Putting execution policy directly into AgentLoop was rejected because native and future MCP sources need one reusable boundary.

## Consequences

- Session history remains complete and branchable while provider context can start at the latest effective checkpoint.
- Restored sessions reconstruct message, runtime, and checkpoint projections from one durable tree.
- Session event colors are controlled by themes.
- Local capability outcomes have stable status and timing semantics.
- Interactive one-time approval is subsequently delivered by ADR-0021. MCP transport, persistent approval scopes, OS-level sandboxing, cloud conflict handling, and Subagent Runtime remain deferred; local runtime recovery/WAL concerns are addressed separately by the Stage 6.0 Runtime Store decisions.
