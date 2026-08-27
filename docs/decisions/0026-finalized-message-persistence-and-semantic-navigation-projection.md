# ADR-0026: Finalized Message Persistence and Semantic Navigation Projection

## Status

Accepted

## Date

2026-08-26

## Implementation Status

Implemented and verified on 2026-08-27. The delivery changes CLI Message/Navigation projections and normal Session write behavior without changing the Local Session Store schema or Runtime Store schema.

## Context

ADR-0008 established the Session Entry Tree as the durable semantic authority and intentionally separated Session history from Message, Runtime State, Context, and UI projections. It also made `message_update` a first-class branchable Session Entry so an evolving AI SDK message could be persisted without mutating an earlier message Entry. The current CLI therefore may persist a chain such as:

```text
assistant_message
  -> message_update
  -> tool_result
  -> message_update
```

That mechanism preserves append-only history, but it mixes two different concepts:

- durable semantic facts that should be valid navigation/branching anchors;
- transient or derived revisions of one logical UI/model message.

This distinction matters now that `/tree` is a navigation surface rather than a database inspector. A user expects the tree to resemble the conversational history: linear rows for ordinary progression and nested structure only where the Session truly branches. Internal message revisions should not create visible or navigable tree nodes.

Tool execution exposes the same problem. MORE-MORE-CODE deliberately persists `tool_call` and `tool_result` as separate durable facts because recovery, permission, approval, audit, replay, and fail-closed side-effect ordering require distinct request and terminal facts. The normal user experience, however, should present one Tool Use whose state changes from pending/running to terminal. Rewriting or reordering canonical Entries merely to produce that UI would weaken the durable model.

Pi Agent demonstrates the useful separation: its persistent/tool message representation keeps call/result identities separate, while the TUI joins them by `toolCallId` into one tool execution component and its tree hides bookkeeping-oriented rows. The accepted MORE-MORE-CODE design applies the same principle while preserving its stronger local durable-first boundaries.

## Decision

### 1. Retire `message_update` as a newly-written semantic Session Entry

New production flows must stop using `message_update` to represent the normal lifecycle of one AI SDK message.

The target lifecycle is:

```text
provider stream / UI transient state
        -> completed AgentLoop Model Step
        -> one durable assistant_message append for that Model Step
```

Streaming text/reasoning/tool-call deltas remain process/UI runtime state until the Model Step reaches the durable semantic boundary. A finalized assistant step is appended once with its model-visible content and stable metadata available at that boundary.

Implementation clarification discovered during real CLI Tool-continuation verification: Vercel AI SDK v7 may keep one assistant `UIMessage` alive across multiple Provider/AgentLoop Model Steps and reuse the same `UIMessage.id` while appending later Tool continuation content. Therefore `UIMessage.id` is not a durable semantic identity for this boundary. New normal assistant Entries use the AgentLoop `stepId` as their stable durable identity and persist only the current Model Step segment. The AI SDK `step-start` part is used as the runtime segmentation marker; the marker itself is not persisted as semantic assistant content.

Conceptually:

```text
AI SDK aggregate UIMessage (same UIMessage.id)
  step-start -> Tool Call
  Tool terminal state projected into UI
  step-start -> continuation text

Session semantic history
  assistant_message(step-1)
  tool_call
  tool_result
  assistant_message(step-2)
```

This clarification preserves the original ADR intent: finalized semantic facts are append-only, while aggregate UI message revisions remain runtime/projection concerns.

This decision does not authorize in-place mutation of an existing Session Entry. Append-only Session semantics remain unchanged.

### 2. Existing `message_update` data remains readable during compatibility

The first implementation must not make existing local Sessions unreadable.

`message_update` becomes a legacy-read compatibility record:

- old v3 Sessions containing it continue to load;
- legacy Message Projection continues to replay it when reconstructing old history;
- Navigation Tree Projection always folds it away;
- new normal execution paths do not append it;
- physical removal from the Session Entry type/schema requires a later explicit migration/version decision.

This avoids coupling the behavioral cleanup to an immediate destructive database/session migration.

### 3. Tool request and terminal facts remain separate canonical Entries

`tool_call` and `tool_result` remain first-class append-only Session Entries.

Required order for one current sequential Tool Step remains conceptually:

```text
final assistant_message containing tool call
        -> durable tool_call
        -> external Tool execution
        -> durable tool_result
        -> next Provider/tool-continuation step
```

When that continuation completes, it appends a new step-scoped `assistant_message`; it does not revise the earlier Tool-calling assistant Entry even if the AI SDK presents both steps inside one aggregate `UIMessage`.

The Tool side effect must never start before the corresponding durable `tool_call` request fact has committed. The next Provider continuation must never observe a terminal Tool Result that has not committed.

Removing `message_update` must not weaken either side-effect gate.

### 4. Message Projection derives terminal Tool state instead of persisting it twice

A Tool Result must no longer be copied back into an earlier assistant message by appending a `message_update` solely to satisfy UI or provider message shape.

Instead, Message Projection joins:

```text
assistant message tool part / tool_call
            +
tool_result matched by toolCallId
            ->
projected terminal tool part / provider-ready message sequence
```

The projection operates on cloned/derived data. Canonical `assistant_message`, `tool_call`, and `tool_result` Entries remain immutable.

This projection is responsible for producing a valid next-step AI SDK/provider representation after Tool completion. The redesign is not complete if the UI looks correct but Tool continuation can no longer compile valid model input.

### 5. Introduce a Navigation Tree Projection distinct from the canonical Session Tree

`/tree` must consume a dedicated semantic navigation projection rather than directly rendering every stored Entry.

The projection has two responsibilities:

1. select/fold raw Entries into human-meaningful navigation rows;
2. preserve branch topology while compressing ordinary single-child chains into a flat visual sequence.

Canonical persistence remains:

```text
Session Entry Tree
```

User navigation becomes:

```text
Session Entry Tree
    -> Navigation Tree Projection
    -> /tree UI
```

### 6. Default navigation rows

The default projection should expose conversation/workflow rows that are useful as human navigation landmarks:

- `user_message`;
- `assistant_message` when it contains visible text or a terminal assistant error/aborted state as defined by UI policy;
- displayable `custom_message`;
- derived `ToolUse` rows;
- `error` where it represents a meaningful semantic failure;
- `compaction` and `branch_summary` where retaining them as explicit semantic landmarks helps explain branch/context state.

Bookkeeping/state rows such as `session_start`, `model_change`, `mode_change`, `config_change`, and generic hidden `custom` entries are hidden in the default view unless a future explicit filter requests them.

Legacy `message_update` is always folded; it is not independently selectable.

An assistant message whose only visible semantic content is one or more Tool Calls may be hidden in the default navigation view so ToolUse rows occupy the expected position, matching the Pi-style interaction discussed during design.

### 7. `ToolUse` is a projection type, not a new Session Entry

The navigation/UI layer may define a derived shape similar to:

```ts
type ToolUseNode = {
  kind: "tool-use";
  toolCallId: string;
  toolName: string;
  input: unknown;
  status:
    | "pending"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "denied"
    | "approval_required";
  output?: unknown;
  error?: string;
  callEntryId: string;
  resultEntryId?: string;
  navigationTargetEntryId?: string;
};
```

The exact interface may be refined during implementation, but the invariant is fixed: `ToolUse` is derived by joining `tool_call` with its terminal `tool_result`; it is never persisted as an additional semantic fact.

### 8. ToolUse navigation targets terminal durable state

For a completed/failed terminal Tool Use, `/tree` navigation must target the `tool_result` Entry, or an equivalent later terminal semantic anchor explicitly justified by tests, not the initial `tool_call` Entry.

This guarantees that jumping to the row reconstructs a branch state in which the selected Tool execution has already reached its displayed terminal result.

A durable unresolved `tool_call` recovered after interruption may be displayed as incomplete/pending diagnostic state, but it must not masquerade as a completed navigable checkpoint. Implementation must define whether such a row is disabled or navigates only with an explicit incomplete-state warning.

### 9. Visual hierarchy follows semantic branching, not Entry depth

The navigation UI should render a single-child path as a flat list:

```text
user
assistant
[read: file]
assistant
user
assistant
```

Only a node with multiple visible descendants introduces nested branch structure:

```text
user
assistant
user
├─ assistant ...
│  user ...
└─ assistant ...
   user ...
```

Hidden/folded Entries are topology-transparent: visible descendants are attached to the nearest visible ancestor needed to preserve the true branch relationship.

The current active branch may be ordered first inside a branch group for usability, but ordering must remain deterministic and may not mutate canonical Session order.

### 10. Current sequential Tool execution order remains unchanged

The current Harness executes model-returned Tool Calls sequentially. This ADR does not add parallel Tool execution or change AgentLoop Turn/Step semantics.

If parallel Tool execution is introduced later, it must define deterministic terminal commit/navigation semantics before `/tree` relies on completion order. That is explicitly outside this design unit.

### 11. Runtime recovery stays separate from semantic history

If future requirements demand crash recovery of a partially streamed assistant response, that state belongs in the Runtime Store or another execution-recovery projection, not as newly branchable `message_update` Session Entries.

The accepted separation remains:

```text
Session Store  = finalized semantic facts / branch authority
Runtime Store  = execution, recovery, security and transient lifecycle facts
UI state       = high-frequency streaming presentation
```

## Supersedes / Refines

This ADR supersedes two specific decisions in ADR-0008:

1. `message_update` as the normal durable representation for an evolving current message;
2. `/tree` operating on raw Session Entries directly as its user-facing navigation model.

ADR-0008 remains valid for:

- append-only semantic Session authority;
- one durable semantic fact per canonical Session Entry;
- distinct Message/Runtime/Context/UI projections;
- first-class `tool_call` and `tool_result` facts;
- branch continuation from an historical durable anchor.

ADR-0011 remains valid: finalized Session Entries are immutable, restore authority is `Session Tree + activeEntryId`, and Runtime/Tool boundaries remain separate.

ADR-0025 remains valid for the durable-message normalization seam. Under this ADR, that seam normalizes finalized messages before their one-time semantic append rather than requiring normal Tool completion to create an additional persisted message revision.

## Alternatives Considered

### Keep `message_update`, hide it only in `/tree`

- Pros: smallest implementation change.
- Cons: canonical branch topology continues to contain non-semantic revision nodes; every navigation projection must repair that noise; Tool terminal state remains duplicated between message revisions and `tool_result`.
- Rejected: it solves presentation but not the domain-model mismatch.

### Mutate the original assistant Entry when Tool Result arrives

- Pros: simple final message reconstruction.
- Cons: violates append-only branch fidelity and creates race/replay ambiguity.
- Rejected.

### Merge `tool_call` and `tool_result` into one mutable durable Entry

- Pros: closely matches the visual Tool Use.
- Cons: weakens request-before-side-effect durability, recovery and audit semantics; requires mutation or incomplete in-place records.
- Rejected: pairing belongs in projection, not persistence.

### Persist a new `tool_use` Entry in addition to call/result

- Pros: simple `/tree` query.
- Cons: duplicates the same semantic interaction three times and introduces consistency problems.
- Rejected.

### Persist every stream delta/update for crash recovery

- Pros: maximum recovery granularity.
- Cons: turns Session semantic history into high-frequency execution telemetry and produces branch noise.
- Rejected for Session Store; a future Runtime recovery design may persist bounded snapshots/deltas separately.

## Consequences

- New Sessions become semantically cleaner: one finalized assistant message is one durable message fact.
- Existing Sessions remain readable through legacy `message_update` replay.
- Tool recovery/audit semantics stay strong because call/result facts remain separate and durable-first.
- Message Projection becomes deeper: it must reconstruct terminal Tool state from independent durable facts.
- `/tree` becomes a semantic navigation projection instead of a raw Entry browser.
- UI hierarchy can match human conversation structure while preserving canonical branching underneath.
- No database schema migration is required for the first implementation if legacy-read support is retained; physical removal of `message_update` remains a later explicit decision.
- Usage/Context Window observability, cloud sync, parallel Tool execution, and new Runtime streaming persistence are not part of this ADR.
