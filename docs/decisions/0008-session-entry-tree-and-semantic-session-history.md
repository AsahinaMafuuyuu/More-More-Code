# ADR-0008: Use a Session Entry Tree as the Durable Semantic Session History

## Status

Accepted

## Date

2026-08-13

## Context

ADR-0004 introduced a resumable Session Tree whose nodes were conversation checkpoints. ADR-0005 reduced snapshot duplication by moving message mutations into canonical `message-upsert` events referenced by checkpoint nodes. That model was sufficient for chat branching, but it still treated conversational messages as the primary durable history and treated a tree node as a checkpoint containing multiple semantic changes.

The Harness now needs a stronger Session model inspired by pi-agent session history. A Session must be able to record not only user and assistant messages, but also durable semantic facts such as tool calls/results, model or mode changes, configuration changes, errors, context compaction, branch summaries, and extension/custom events. Some of these entries are visible in the UI, some affect model context, and some only affect runtime restoration or audit/replay.

These facts must remain branchable and persistable without conflating them with high-frequency Run/Turn/Step lifecycle telemetry.

## Decision

### One durable semantic event equals one Session Entry

Session Tree snapshot version 3 stores a single branchable `entries[]` collection. Every persisted semantic event is itself a tree node identified by `id` and linked by `parentId`.

The root is a persisted `session_start` entry so an empty Session has a stable continuation target.

Representative entry families are:

```text
Conversation
- user_message
- assistant_message
- custom_message
- message_update

Tool / semantic execution
- tool_call
- tool_result
- error

Runtime state
- model_change
- mode_change
- config_change

Context control / extension
- compaction
- branch_summary
- custom
```

Entry identity remains distinct from message IDs, tool-call IDs, Run IDs, Turn IDs, and Step IDs. Entries may reference those identities as metadata without becoming the execution lifecycle store.

### Session history is projected for different consumers

The Session Entry Tree is the durable semantic source history. Consumers derive different views from the active root-to-entry branch:

```text
Session Entry Tree
    ├─ Message Projection
    ├─ Runtime State Projection
    ├─ Context Projection
    └─ UI / audit projection
```

Message Projection replays message-bearing entries and immutable `message_update` entries. State entries such as `model_change` and `mode_change` are not inserted into normal chat messages; Runtime State Projection replays them separately.

The CLI `/tree` and related navigation operate on Session Entries directly. Normal chat rendering continues to show the Message Projection only.

### Historical changes are append-only

A finalized historical entry is never rewritten merely because the current branch changes. If an AI SDK message evolves, for example when a tool result updates an existing assistant UI message, the Session appends a `message_update` entry on that branch rather than mutating the original message entry.

Jumping to any earlier Session Entry moves the active continuation cursor. New Session Entries become descendants of that historical entry, naturally preserving sibling branches.

### Tool calls/results are first-class Session Entries

Although provider message formats may encode tool calls inside an assistant message, the Harness persists semantic `tool_call` and `tool_result` entries separately. This gives permissions, retries, subagents, tool auditing, and future extensions a stable place in Session history without forcing them into the UI message format.

### Compaction is durable when it actually occurs

Context compaction remains non-destructive: source Session history is never deleted. When the CLI Context Projection actually creates a compacted summary for a model request, the CLI records a `compaction` Session Entry containing the summary and the compacted/retained message identities.

This records the context-control event without turning token streaming or projection progress into durable Session nodes.

### ExecutionEventStore remains separate

ADR-0006 remains valid. Run/Turn/Step lifecycle history and Session semantic history have different retention and projection semantics:

```text
Session Entries   = durable semantic Session history
Execution Events  = Run / Turn / Step runtime lifecycle facts
Lifecycle updates = ephemeral high-frequency notifications
```

`step_update`, token deltas, progress frames, and similar telemetry do not become Session Entries.

### Persistence and compatibility

Version 3 remains stored in the existing Session JSON field and is written through:

```text
POST /sessions/:id/state
```

No Prisma migration is required in this phase. The Server accepts v1, v2, and v3 payloads during the compatibility period.

The CLI upgrades:

- legacy linear message arrays;
- v1 per-node message snapshots;
- v2 checkpoint nodes plus canonical message-upsert events;

into the v3 Session Entry Tree in memory.

V2 branch-local message updates are migrated as branch-local `message_update` entries so sibling branches do not leak revisions into one another.

Because v3 is persisted incrementally at semantic boundaries, cloud state writes are serialized client-side to prevent an older best-effort request from completing after and overwriting a newer state snapshot.

## Supersedes

This ADR supersedes the **Session node granularity and canonical message-history representation** chosen in ADR-0004 and ADR-0005.

It does not supersede:

- ADR-0004's separation of history, UI projection, and model Context Projection;
- ADR-0005's turn-aware context budgeting/token-counter decisions;
- ADR-0006's separate Execution Event Runtime;
- ADR-0007's Run/Turn/Step and steering/follow-up lifecycle semantics.

## Alternatives Considered

### Keep v2 checkpoint nodes and add more event kinds to `events[]`

- Pros: smaller immediate refactor.
- Cons: preserves two identities for one semantic fact: a checkpoint node plus referenced events; arbitrary state/tool/custom events still cluster under artificial checkpoints.
- Rejected: the durable event itself should carry the branch relationship.

### Make every Run, Turn, and Step a Session Tree node

- Pros: one universal tree.
- Cons: conflates semantic conversation/workflow history with runtime telemetry and creates excessive nodes for implementation-level lifecycle details.
- Rejected: ExecutionEventStore already models this concern correctly.

### Persist only UI-visible messages

- Pros: simplest storage and rendering.
- Cons: cannot restore historical model/config state, audit tool semantics, represent compaction, or support richer extension/subagent workflows.
- Rejected: a Session is broader than its chat transcript.

### Mutate old entries when messages or configuration change

- Pros: fewer stored entries.
- Cons: destroys branch fidelity and makes replay/audit dependent on mutable snapshots.
- Rejected: branch-local append-only semantics are required.

## Consequences

- A Session can represent a complete durable semantic history rather than only a conversation transcript.
- `/tree` exposes fine-grained navigation through messages, tools, errors, compaction, and state changes.
- Jumping restores both message history and persisted model/mode state for the selected branch.
- Model and mode changes made through the CLI are recorded as Session state entries; generic configuration/custom entry APIs are available for future settings/extensions.
- Tool calls/results and actual context-compaction operations are persisted incrementally.
- V1/v2 stored Sessions remain recoverable without an immediate database migration.
- Session snapshots may contain more nodes than v2, but each node is semantically meaningful and no longer requires a separate checkpoint/event ownership layer.
- A future Local WAL or normalized database representation can persist the same append-only Session Entry model without changing the domain semantics.
