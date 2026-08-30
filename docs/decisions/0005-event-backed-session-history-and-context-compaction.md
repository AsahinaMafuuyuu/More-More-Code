# ADR-0005: Event-Backed Session History and Turn-Aware Context Compaction

## Status

Superseded in part by ADR-0008

## Date

2026-08-12

## Context

ADR-0004 introduced a resumable Session Tree and a Context Projection boundary, but the first implementation still stored a complete UI message snapshot inside every tree node. Long conversations and branches therefore duplicated the same prefix many times. The Context Manager also budgeted individual messages using a coarse character estimate, so it could theoretically retain one half of a conversational turn and had no compaction path when older history exceeded the model input budget.

The runtime needs one durable history representation from which both UI state and model context can be projected without mutating original history.

## Decision

### Canonical event-backed Session Tree

Session Tree snapshot version 2 stores message changes as global canonical events:

```text
SessionTreeState
├── nodes[]
│   ├── id
│   ├── parentId
│   └── eventIds[]
└── events[]
    └── message-upsert(messageId, message)
```

A node no longer owns a full message array. Its visible conversation is reconstructed by walking the root-to-node path and replaying the referenced events. Appending a turn diffs the completed message state against the active parent projection and stores only new or changed messages. Branches therefore share their unchanged prefix structurally rather than copying it.

Version 1 tree snapshots and legacy linear message arrays are upgraded in memory. The Server accepts both v1 and v2 state payloads during the compatibility period; the current CLI writes v2.

### Turn-aware Context Projection

Context records may carry a `groupId`. Records in the same group are admitted or omitted atomically. The CLI maps user/assistant history into turn groups so budget pressure cannot keep an assistant response while dropping its corresponding user input.

Recent turns are marked as a retained tail according to a model context profile. Optional history is selected as a contiguous recent suffix rather than cherry-picking older small records around an omitted large turn.

### Bounded compaction

When normal projection truncates history, ContextManager reserves a bounded summary budget, retains the recent turn tail, and asks a `ContextCompactor` to replace omitted complete history with a summary record. The original event history is never rewritten or deleted by compaction.

The first CLI compactor is deterministic: it produces a bounded textual chronology from omitted user/assistant content and non-text part types. This is intentionally separate from future LLM-generated semantic summaries.

### Model profiles and token counter adapters

Budget parameters are resolved per model through `ModelContextProfile`:

- context window policy;
- reserved output budget;
- safety margin;
- retained tail turns;
- maximum summary budget;
- token counter adapter.

The runtime exposes both exact-tokenizer adapters and heuristic counters. The current CLI ships provider-calibrated heuristic counters because no provider tokenizer package is currently installed for all configured model families. Their `accuracy` is explicitly `estimated`; an exact tokenizer can replace them without changing ContextManager APIs.

## Alternatives Considered

### Keep a full message snapshot in every tree node

- Pros: trivial restoration and branch reads.
- Cons: prefix duplication grows rapidly with long histories and branching; there is no single canonical history.
- Rejected: it scales poorly and conflates persistence with UI projection.

### Store only parent pointers and regenerate messages from Run/Turn objects

- Pros: fewer persistence types.
- Cons: Run/Turn/Step are execution lifecycle records, not complete message content; interrupted and provider-specific UI parts still need durable history events.
- Rejected: execution history and conversational history are related but distinct projections.

### Drop oldest individual messages under token pressure

- Pros: simple.
- Cons: can split turns and destroy conversational causality.
- Rejected: context selection must preserve complete turn units.

### Modify persisted history during compaction

- Pros: smaller stored state.
- Cons: destroys branch fidelity and makes later re-projection, auditing, or improved summarization impossible.
- Rejected: compaction is a model-context projection concern, not history mutation.

## Consequences

- Session Tree v2 uses shared canonical message events and incremental branch nodes.
- UI and model input are explicit projections of preserved history.
- Old v1 tree snapshots remain recoverable and are upgraded by the CLI.
- Context budgeting preserves complete turns and a configurable retained tail.
- Older history can be represented by a bounded summary without deleting source events.
- Current provider token counts remain estimates. Exact tokenizer implementations can be injected through the same `TokenCounter` contract later.
- Persistent Run/Turn/Step event storage remains a separate future layer; this ADR establishes canonical conversational history, not a complete execution event store.
