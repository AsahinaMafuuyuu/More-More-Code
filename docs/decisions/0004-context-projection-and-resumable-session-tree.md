# ADR-0004: Separate Context Projection from History and Use a Resumable Session Tree

## Status

Superseded in part by ADR-0008

## Date

2026-08-12

## Context

The local-first Agent Loop established by ADR-0003 still used the complete AI SDK `UIMessage[]` list as the effective model context and stored that same linear list as the cloud recovery snapshot. This conflated three different concerns:

- what actually happened in the conversation;
- what the current UI displays;
- what a particular model step is allowed to receive under its context budget.

A linear snapshot also prevents first-class branching. If a user wants to return to an earlier conversation point and continue in a different direction, the runtime needs a stable node identity and parent relationship rather than destructive message truncation.

## Decision

Add two sibling Harness capabilities without changing the existing Run / Turn / Step semantics.

### Context projection

`ContextManager` operates on generic context records and produces an immutable, budgeted projection. The manager:

- has no React or AI SDK dependency;
- keeps required records;
- prefers newer optional history when the full history does not fit;
- reports truncation and over-budget state;
- never mutates or compacts the source history.

The CLI adapter currently converts validated UI messages into Harness context records, applies an approximate token budget, and only then converts the selected payloads to provider messages. Exact provider tokenizers and automatic compaction remain future work behind this boundary.

### Resumable session tree

A session is represented as a versioned tree:

```text
root
  └─ turn A
      ├─ turn B
      │   └─ turn C
      └─ turn B'
```

Each node has:

- a stable node ID;
- `parentId`;
- creation time;
- a resumable message snapshot;
- optional Run and input-message identity.

`activeNodeId` is the current continuation cursor. Selecting any existing node replaces the current UI/model projection with that node's snapshot. Submitting from that node appends a new child, so branching happens naturally without deleting sibling history.

For this first version, nodes store full snapshots. This intentionally favors simple, deterministic recovery over storage efficiency. A later event/delta store may deduplicate snapshots while preserving the same node and parent semantics.

### Persistence

The cloud Session service remains a passive store. To avoid coupling this phase to a database migration, the existing `Session.messages` JSON column stores the versioned tree state. A new command endpoint is used:

```text
POST /sessions/:id/state
```

Legacy sessions whose JSON value is still a message array are upgraded in memory to a one-node tree when loaded. The legacy `POST /sessions/:id/messages` endpoint remains temporarily readable/writable for compatibility, but the current CLI no longer uses it.

### CLI navigation

The CLI exposes:

- `/tree` — browse the current tree and jump to a node;
- `/jump` — open the same node selector focused on navigation;
- `/parent` — move to the active node's parent;
- `/root` — move to the root node.

## Alternatives Considered

### Mutate the message array when rewinding

- Pros: minimal data model changes.
- Cons: destroys abandoned futures, cannot represent sibling branches, and makes recovery ambiguous.
- Rejected: branching is a first-class session concern, not an undo operation.

### Persist Run / Turn / Step events immediately

- Pros: strongest audit and recovery model; avoids snapshot duplication.
- Cons: substantially increases schema, replay, migration, and synchronization scope before Context/Session semantics are stable.
- Deferred: event sourcing remains the intended later Session Runtime layer.

### Put context budgeting directly in `LocalModelTransport`

- Pros: fewer Harness types.
- Cons: context policy would remain coupled to one provider/UI adapter and would be difficult to reuse for subagents or non-React runtimes.
- Rejected: context projection is Harness infrastructure.

### Store each tree node in a database table now

- Pros: normalized queries and less JSON rewriting.
- Cons: requires a schema migration and cloud model commitment before the local tree semantics are proven.
- Deferred: the versioned JSON snapshot provides a migration-safe first implementation.

## Consequences

- `AgentLoop` remains focused on orchestration; context and session navigation are separate runtime layers.
- Model input can be budgeted without deleting historical data.
- A user can jump to any prior node and continue from there, creating a branch automatically.
- Legacy linear sessions remain recoverable.
- Cloud state snapshots are larger because each node currently duplicates its resumable message list.
- UI messages are still the CLI adapter payload in v1; a future canonical event/history store can replace that payload without changing `ContextManager` or session-tree parent semantics.
- Automatic compaction, exact token counting, conflict resolution, and event-sourced recovery remain explicitly out of scope for this decision.
