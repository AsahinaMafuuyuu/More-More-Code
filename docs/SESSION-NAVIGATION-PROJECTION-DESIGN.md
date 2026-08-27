# Session Navigation Projection & Finalized Message Persistence Design

**Status:** Implemented and verified — 2026-08-27.

**Scope:** Stage 6.5 local Session authority follow-up.

**Related:** ADR-0008, ADR-0011, ADR-0025, ADR-0026, Harness Session Tree, Local Session Store, Local Runtime Store, Tool Runtime, Vercel AI SDK message/tool parts, `/tree` navigation UX.

## 1. Problem Statement

The current Session Tree persists `message_update` as a first-class Entry whenever an existing AI SDK/UI message changes. Tool terminal persistence also updates the assistant UI message and separately appends `tool_result`.

This is technically append-only, but it creates two design problems:

1. one logical conversation message may occupy several branchable Session nodes;
2. one Tool execution may be represented both by a message revision and by canonical `tool_call` / `tool_result` facts.

The current `/tree` implementation renders raw Session Entries. As a result, internal persistence mechanics can become navigation nodes even though a user expects a Pi-like semantic view:

```text
user: ...
assistant: ...
[read: file]
[read: file]
assistant: ...
user: ...
```

Ordinary progression should stay visually flat. Nesting should appear only where the Session has a real branch.

The redesign must improve this without sacrificing the stronger MORE-MORE-CODE invariants already delivered: local Session authority, append-only semantic facts, fail-closed durable-first Tool execution, branch fidelity, restore/recovery safety, and provider-independent Harness semantics.

## 2. Goals

1. Stop writing `message_update` for the normal lifecycle of new messages.
2. Persist one finalized assistant message once per completed AgentLoop Model Step.
3. Keep `tool_call` and `tool_result` as separate durable semantic facts.
4. Derive Tool terminal state in Message/UI Projection instead of writing it back into an earlier assistant Entry.
5. Introduce a Navigation Tree Projection for `/tree`.
6. Render single-child semantic progression as a flat list; introduce indentation/connectors only at real visible branch points.
7. Present one derived Tool Use row for one call/result pair.
8. Preserve old Sessions containing `message_update` without destructive migration.
9. Keep all Provider continuation/context compilation valid after Tool completion.
10. Preserve current durable-first Tool request/result ordering and restart safety.

## 3. Non-Goals

This design does **not** include:

- Usage/cost aggregation or Context Window UI;
- Provider pricing/model-capability redesign;
- Stage 6.6 cloud sync or commercial entitlements;
- parallel Tool execution;
- new Tool protocols or MCP;
- Windows Sandbox work;
- persisted partial-stream crash recovery;
- physical deletion/migration of historical `message_update` rows;
- redesign of Runtime Event permission/approval/security payloads;
- mutation of already-persisted Session Entries;
- a new persistent `tool_use` Entry.

If any implementation task requires one of these areas, it must stop and request a separate design decision rather than expanding this delivery implicitly.

## 4. Current State

### 4.1 Message Projection today

Harness currently treats these Entries as message-bearing:

```text
user_message
assistant_message
custom_message
message_update
```

`projectSessionTreeMessages()` walks the active Entry path and replaces a previous message when it encounters a matching `message_update`.

### 4.2 Tool terminal persistence today

The current Tool flow conceptually performs:

```text
assistant_message with tool part
  -> tool_call
  -> external Tool
  -> message_update containing terminal Tool UI state
  -> tool_result
```

The exact transition is durable-first, but the terminal output is represented twice: once in the projected assistant message and once in the canonical Tool Result Entry.

### 4.3 `/tree` today

The current tree command exposes all raw Entries with `id`, `parentId`, `type`, depth, preview, and jump target. This is useful for debugging but is not the desired user navigation abstraction.

## 5. Target Domain Model

The redesign separates three models explicitly:

```text
1. Canonical Session Entry Tree
   immutable durable semantic facts

2. Message / Navigation Projections
   derived consumer-specific representations

3. Runtime / UI transient state
   streaming and in-flight presentation/execution state
```

### 5.1 Canonical new-write Entry families

The target new-write semantic set remains conceptually:

```text
session_start
user_message
assistant_message
custom_message
tool_call
tool_result
error
model_change
mode_change
config_change
compaction
branch_summary
custom
```

`message_update` remains accepted only as a legacy-read compatibility Entry until a later explicit version/migration removes it physically.

### 5.2 Why `tool_call` and `tool_result` stay separate

They answer different durable questions:

```text
tool_call
  "What external capability was authorized/requested before side effect?"

tool_result
  "What terminal outcome was durably observed after execution?"
```

Collapsing them into one mutable record would weaken recovery, approval/audit correlation, and fail-closed ordering.

## 6. Finalized Message Persistence

### 6.1 Streaming is not Session semantic history

While the Provider is streaming:

```text
message_start
text/reasoning/tool-call deltas
message_update UI events
```

remain runtime/UI state.

They may update an in-memory React/OpenTUI message representation, but they do not append semantic Session Entries merely because another delta arrived.

### 6.2 Final assistant commit boundary

When an AgentLoop Model Step reaches a stable boundary, construct and normalize one final durable assistant step:

```text
AI SDK aggregate assistant UIMessage
  -> select current Model Step segment
  -> normalizeDurableMessage
  -> append assistant_message(stepId) once
  -> LocalSessionAuthority.commit
```

The durable message should include the text/reasoning/tool-call parts produced by that Model Step and stable metadata available at model finish. Provider cache/usage observability remains outside this design unless already part of ordinary JSON-safe message metadata.

### 6.3 AI SDK aggregate message identity is not Session identity

Real Tool-continuation execution exposed an important AI SDK v7 behavior: when the last UI message is an assistant message, later Tool continuation can reuse that same `UIMessage` object/id and append another Model Step to its parts. The UI identity therefore spans more than one durable semantic response.

The implementation must not use `UIMessage.id` as the durable assistant identity. Instead:

- `SessionEntryMetadata.stepId` is the durable Model Step identity source;
- the durable assistant message id is derived from that `stepId`;
- the last AI SDK `step-start` marker identifies the parts belonging to the just-completed Model Step;
- the `step-start` marker itself is omitted from durable semantic content;
- if no marker exists, the completed assistant payload is treated as one Model Step for compatibility with simple/non-Tool responses;
- re-finalizing the same durable `stepId` with incompatible content remains fail-closed.

Example:

```text
aggregate UIMessage id=A
  step-start
  tool-call tc1
  [Tool result state later projected into the same UI message]
  step-start
  final continuation text

durable Session
  assistant_message id=assistant-step:<step-1>  // tool-call tc1 only
  tool_call tc1
  tool_result tc1
  assistant_message id=assistant-step:<step-2>  // continuation text only
```

This keeps append-only Session semantics aligned with AgentLoop execution semantics without reviving `message_update`.

### 6.4 No in-place rewrite

The design does not replace `message_update` with SQL UPDATE of old `entryJson`. Once appended, an `assistant_message` Entry remains immutable.

## 7. Tool Lifecycle Without `message_update`

### 7.1 Required semantic sequence

For the current sequential Harness:

```text
Provider finishes assistant message
        |
        v
durable assistant_message
        |
        v
durable tool_call
        |
        v
Tool Runtime executes external side effect
        |
        v
durable tool_result
        |
        v
next tool-continuation Model Step
```

### 7.2 Request-side durability gate

`tool_call` must commit before `ToolRuntime.run()` starts.

Failure to persist the request remains fail-closed: the external Tool must not run.

### 7.3 Result-side durability gate

The terminal `tool_result` must commit before:

- terminal Tool output is considered authoritative to the Session;
- the next Provider continuation compiles model context from that result.

The UI may have shown process-local streaming/partial Tool output, but durable continuation cannot depend on uncommitted state.

### 7.4 No Tool terminal message write-back

The terminal flow must not append a `message_update` only to transform an assistant tool part from pending to output-available/error.

That transformation belongs to projection.

## 8. Message Projection Redesign

### 8.1 Projection input

Message Projection walks the selected active Session path and observes:

- message Entries;
- Tool Call Entries;
- Tool Result Entries;
- legacy `message_update` Entries where present.

### 8.2 Legacy path

For Sessions created before this redesign, `message_update` continues to replay exactly enough to reconstruct the historical message state. This compatibility path must be isolated from the new-write path so new code does not accidentally reintroduce update generation.

### 8.3 Tool result join

For new-style history, projection maintains a mapping such as:

```text
toolCallId -> {
  assistant message/tool part,
  tool_call Entry,
  optional terminal tool_result Entry
}
```

When a terminal result exists, projection derives the AI SDK/UI terminal tool representation required by existing consumers.

The derived result may be shaped differently for UI Message Projection and model-facing Context compilation, but both must source terminal truth from the same canonical `tool_result` fact.

### 8.4 Projection purity

Projection must not mutate:

- canonical Session Entries;
- loaded `entryJson` objects;
- sibling branch state;
- Tool Result payloads.

It produces clones/derived values.

### 8.5 Provider continuation contract

The strongest acceptance criterion for this section is:

> After one or more Tools complete, the next fake Provider Model Step receives the same semantically valid Tool Call/Result conversation as before the redesign, without any newly persisted `message_update`.

This must be integration-tested, not inferred only from UI rendering.

## 9. Navigation Tree Projection

### 9.1 Purpose

The Navigation Tree Projection is a user-facing semantic index over the canonical Session Tree.

It is **not** a second persistence authority and does not own new IDs that can be mistaken for Session Entry IDs.

### 9.2 Suggested projection interface

The exact types may be refined, but the seam should resemble:

```ts
type NavigationNode = {
  id: string; // stable projection key; may reference underlying semantic identity
  kind: "message" | "tool-use" | "error" | "compaction" | "branch-summary" | "custom";
  parentId: string | null;
  navigationTargetEntryId: string;
  createdAt: number;
  preview: string;
  active: boolean;
  selectable: boolean;
};

projectSessionNavigationTree(state, options): NavigationTree
```

The public interface should hide raw folding mechanics from `/tree`.

### 9.3 Default visibility policy

Default visible/folded behavior:

| Canonical fact | Default `/tree` behavior |
|---|---|
| `session_start` | hidden/root plumbing |
| `user_message` | visible |
| `assistant_message` with visible text | visible |
| assistant message containing only Tool Calls | normally folded |
| `custom_message` | visible only when its display policy permits |
| legacy `message_update` | always folded |
| `tool_call` + terminal `tool_result` | one derived ToolUse row |
| unresolved `tool_call` | diagnostic/incomplete ToolUse row; not treated as completed checkpoint |
| `error` | visible when semantically meaningful |
| `model_change` / `mode_change` / `config_change` | hidden by default |
| `compaction` | visible semantic landmark by default unless later UX testing rejects it |
| `branch_summary` | visible semantic landmark by default |
| generic `custom` | hidden by default unless explicit display/filter contract exists |

This table is a default-view contract, not permission to delete hidden Entries.

### 9.4 Hidden-node topology contraction

If hidden Entries sit between two visible nodes, the visible descendant is connected to the nearest visible ancestor.

Example canonical path:

```text
assistant_message
  -> legacy message_update
  -> mode_change
  -> user_message
```

Navigation Projection:

```text
assistant
  -> user
```

No semantic branch may be invented or lost during contraction.

### 9.5 Single-child chain flattening

Visual indentation is not equal to raw Session depth.

When a visible node has exactly one visible child, the child remains at the same visual indentation level. Only multiple visible children introduce a branch indentation level.

This yields the desired Pi-style linear layout for ordinary conversation.

### 9.6 Branch preservation

Suppose hidden raw Entries exist between one visible ancestor and two visible descendants. Projection must still show a real branch:

```text
visible A
  -> hidden X -> visible B
  -> hidden Y -> visible C
```

becomes:

```text
A
├─ B
└─ C
```

The implementation should compute visible topology first and visual indentation second. Do not derive branch connectors from raw depth after filtering.

### 9.7 Active-branch ordering

Within a branch point the active branch may be placed first to improve navigation, matching the useful Pi behavior. If implemented, ordering must be deterministic and must not change persisted Session sequence or parent relationships.

## 10. ToolUse Projection

### 10.1 Pairing

Pair by exact `toolCallId`.

Required validation:

- one visible ToolUse must not combine different call IDs;
- a terminal result without a matching call is an integrity/recovery anomaly, not a normal ToolUse;
- duplicate terminal results for one call must fail validation or follow an explicitly documented legacy rule; they must not be silently merged.

### 10.2 Display data

The derived row should primarily display the action, not dump result bodies:

```text
[read: packages/.../file.ts:1-300]
[bash: bun test ...]
[edit: src/foo.ts]
```

Result status may influence styling/indicator. Large Tool output remains available through the normal Tool UI/inspection path rather than expanding the navigation line.

### 10.3 Navigation target

For terminal ToolUse:

```text
navigationTargetEntryId = tool_result.id
```

This means selecting the row restores a state containing both request and terminal result.

For an incomplete recovered Tool request, the node must not claim the result exists. The implementation test plan requires an explicit selectable/disabled behavior before shipping.

## 11. Interaction With Branch Summary and Navigation Carry

Existing Branch Summary semantics remain unchanged:

- browsing alone does not append Entries;
- jumping analyzes source/target path loss;
- Carry may append one `branch_summary` after target selection according to existing policy.

Navigation Tree Projection changes which rows the user can conveniently select; it must not bypass the existing navigation/Carry controller.

When a projection node maps to a terminal Tool Result Entry, path-loss analysis continues to operate on the underlying canonical Entry ID.

## 12. Interaction With Context Compaction and Tool Result Working Set

No Context semantics are redesigned here.

- canonical Tool Result remains complete in Session history;
- Tool Result Working Set may still project a bounded model-facing representation;
- Compaction remains historical Context reduction;
- Branch Summary remains cross-branch knowledge transfer.

Message Projection reconstruction for Tool continuation must happen before/within the existing context compilation seam without merging these mechanisms.

## 13. Compatibility Strategy

### 13.1 No immediate SQLite migration

The Local Session Store stores indexed Entry fields plus canonical `entryJson`. This design does not require adding/removing table columns.

### 13.2 Legacy `message_update`

Existing stored Entries remain valid. The implementation should prefer:

```text
read legacy update -> replay for compatibility
new execution -> never append update
```

over a destructive rewrite of all local `.db` files.

### 13.3 Session Tree version

The implementation should not bump `SESSION_TREE_VERSION` merely to stop writing one legacy Entry kind if old data can remain safely readable under the same loader contract.

A version bump is justified only if validation/type contracts can no longer represent both legacy-read and new-write states cleanly. That would require an explicit review before implementation proceeds.

## 14. Error and Recovery Semantics

### Missing Tool Result

A `tool_call` with no terminal `tool_result` can occur after interruption/restart. It remains a durable incomplete fact. Recovery must not automatically re-run it because it may have produced an external side effect.

### Orphan Tool Result

A `tool_result` with no matching call on the selected branch is an integrity anomaly. Projection must not invent a fake request.

### Projection failure

If Message Projection cannot construct a valid Provider continuation because canonical Tool facts are inconsistent, the next Model Step must fail closed rather than silently dropping Tool state.

### Streaming interruption

An unfinished in-memory assistant stream is not automatically promoted to a finalized semantic message. Persisting partial stream recovery is a separate Runtime Store design.

## 15. Implementation Slices

Implementation must be performed test-first and should remain in these slices:

### Slice A — Pure Navigation Projection

Add a pure Harness/CLI projection over fixture Session Trees. No persistence write behavior changes yet.

### Slice B — ToolUse Projection

Pair call/result facts and expose terminal navigation anchors. Preserve canonical Entries unchanged.

### Slice C — Finalized assistant persistence

Change new assistant-message synchronization so each completed AgentLoop Model Step is appended once and no new `message_update` is generated. Include a regression where AI SDK reuses one aggregate assistant `UIMessage.id` across Tool continuation; durable identity must remain step-scoped and only the current `step-start` segment may be persisted.

### Slice D — Tool terminal projection

Remove normal Tool terminal message write-back and derive terminal message/UI state from `tool_result`.

### Slice E — `/tree` integration

Replace raw Entry rendering with Navigation Tree Projection while routing selection through the existing navigation/Carry controller.

### Slice F — Legacy/restart verification

Load old `message_update` fixtures and real local-session-style histories; prove compatibility, restart, Tool continuation, branch navigation, and incomplete Tool recovery.

## 16. Files Likely Touched During Implementation

Expected areas, subject to code review:

```text
packages/harness/src/session-tree.ts
packages/harness/tests/session-tree.test.ts

packages/cli/src/lib/durable-session-message.ts
packages/cli/src/lib/durable-tool-terminal.ts
packages/cli/src/hooks/use-chat.ts
packages/cli/src/screens/session.tsx
packages/cli/tests/*session* / *tool* / navigation projection tests
```

The Local Session Store schema should not require modification for this design. Runtime Store changes are not authorized.

## 17. Rejected Implementation Shortcuts

### Hide `message_update` only in JSX/TUI

Rejected because canonical navigation still targets non-semantic revision nodes and Tool terminal duplication remains.

### Delete `message_update` support immediately

Rejected because existing local Sessions already contain these Entries.

### Turn Tool Result into a mutation of assistant message

Rejected because it violates append-only Session history.

### Make `/tree` use array index after filtering

Rejected because filtering changes visible indexes and can mis-target branch navigation. Every selectable projection row must resolve to an explicit canonical Entry ID.

### Let UI build ToolUse independently from Message Projection

Rejected as the only source of truth. UI can have a presentation adapter, but Tool pairing semantics should live behind a reusable projection seam so `/tree`, restore, and provider continuation cannot drift.

## 18. Design Completion Gate

This documentation is approved for implementation only if the implementation stays within these invariants:

- no new normal `message_update` writes;
- old updates remain readable;
- no canonical Session Entry mutation;
- no persistent `tool_use` duplication;
- Tool side-effect request remains durable-first;
- Tool result remains durable before Provider continuation;
- navigation targets canonical Entry IDs;
- single-child display is flat and real branches remain branches;
- next Provider continuation receives valid Tool Call/Result semantics;
- no Usage/Context Window, cloud, parallel Tool, Runtime Store, or database-schema scope creep.
