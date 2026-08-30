# Session Navigation Projection & Finalized Message Persistence Test Plan

**Status:** Implemented and verified — 2026-08-27.

**Design under test:** `docs/SESSION-NAVIGATION-PROJECTION-DESIGN.md`

**Decision:** ADR-0026.

## 1. Test Objective

Prove that MORE-MORE-CODE can retire new `message_update` writes without weakening durable Session semantics, Tool recovery/order guarantees, Provider continuation, branch navigation, or compatibility with existing Sessions.

The suite must verify two independent projection contracts:

1. **Message Projection** reconstructs valid terminal Tool state from finalized message + `tool_call` + `tool_result` facts.
2. **Navigation Tree Projection** hides/folds persistence mechanics and presents a Pi-style semantic tree while preserving canonical branch targets.

UI-only tests are insufficient. The implementation must prove persistence, restart, navigation and fake-Provider continuation behavior through real module seams.

## 2. TDD Rule

Implementation must begin with focused Red regressions before changing production behavior.

At minimum, the first Red set must prove the current behavior violates the new contract in these ways:

- a normal Tool terminal flow appends at least one `message_update`;
- raw `/tree` projection exposes `message_update` as a distinct navigation node;
- raw Tool facts appear as separate navigation facts rather than one semantic ToolUse row.

Do not begin by deleting the Entry union member. The first Green step must preserve legacy-load compatibility.

## 3. Test Seams

### Seam A — Session/Message Projection

Primary behavior:

```text
canonical active branch Entries
  -> projected Message[] / provider-ready conversation
```

Likely files:

```text
packages/harness/tests/session-tree.test.ts
packages/cli/tests/durable-session-message.test.ts
```

Tests should prefer the exported projection interface rather than private React state.

### Seam B — Tool Terminal Durability

Primary behavior:

```text
assistant_message(tool call)
  -> durable tool_call
  -> Tool execution
  -> durable tool_result
  -> projected terminal Tool state
```

Likely files:

```text
packages/cli/tests/local-session-tool-durability.test.ts
packages/cli/tests/local-session-durable-turn.test.ts
```

### Seam C — Navigation Tree Projection

Primary behavior:

```text
raw Session Entry Tree
  -> semantic NavigationTree
```

Prefer a pure projection test file such as:

```text
packages/cli/tests/session-navigation-projection.test.ts
```

or a Harness test if the accepted implementation places the provider-independent projection there.

### Seam D — Local Session Restart

Primary behavior:

```text
commit -> close -> reopen -> load -> project -> continue
```

Likely files:

```text
packages/cli/tests/local-session-authority.test.ts
packages/cli/tests/durable-session-message-persistence.test.ts
```

## 4. Slice 1 — Navigation Projection Hides Legacy Message Updates

Fixture canonical path:

```text
session_start
user_message U1
assistant_message A1
message_update A1'
message_update A1''
user_message U2
```

Expected navigation rows:

```text
U1
A1(final projected preview)
U2
```

Acceptance:

- no navigation row has `kind/type = message_update`;
- no selectable target points to a `message_update` Entry;
- the assistant preview reflects the effective legacy projected message where appropriate;
- canonical source Entries remain unchanged.

## 5. Slice 2 — Hidden-node Topology Contraction

Construct a branch where hidden records sit between visible records:

```text
visible A
  -> message_update X -> visible B
  -> mode_change Y    -> visible C
```

Expected visible topology:

```text
A
├─ B
└─ C
```

Acceptance:

- B/C both resolve to their own canonical navigation targets;
- neither hidden X nor Y becomes a visible parent;
- branch count is preserved exactly;
- projection does not create a false B -> C chain.

## 6. Slice 3 — Single-child Chains Render Flat

Fixture visible semantic chain:

```text
user -> assistant -> ToolUse -> assistant -> user
```

Acceptance:

- all rows remain at the same visual indentation until a real branch occurs;
- raw Entry depth is not copied directly into visual depth;
- adding a second visible child at one point introduces one branch indentation level only there;
- removing that sibling returns the chain to flat layout.

The pure projection may expose structural metadata while a component-level test verifies final indentation/connectors.

## 7. Slice 4 — Tool Call + Tool Result Become One ToolUse

Canonical fixture:

```text
assistant_message
  content: tool call id=tc1 name=read
tool_call tc1
tool_result tc1 status=completed output=...
```

Expected navigation projection:

```text
[read: ...]
```

Acceptance:

- exactly one ToolUse row is produced for `tc1`;
- `callEntryId` points to the request Entry;
- `resultEntryId` points to the terminal Entry;
- `navigationTargetEntryId` points to the terminal `tool_result` Entry;
- Tool output is not duplicated into canonical assistant message storage;
- source Entries remain separate and immutable.

## 8. Slice 5 — Tool Status Matrix

Table-driven ToolUse projection must cover:

| terminal state | expected ToolUse state |
|---|---|
| completed | completed |
| failed | failed |
| cancelled | cancelled |
| timed_out | timed_out |
| denied | denied |
| approval_required | approval_required |

Acceptance:

- status is sourced from `tool_result`, not guessed from UI parts;
- error/output fields are projected without modifying canonical result data;
- each terminal row is navigable to the terminal durable state.

## 9. Slice 6 — Incomplete Tool Request

Fixture:

```text
assistant_message(tool tc1)
tool_call tc1
<process interruption; no tool_result>
```

Acceptance:

- projection does not invent a terminal result;
- ToolUse is marked incomplete/pending according to the final UI contract;
- it is not presented as a completed checkpoint;
- restart logic does not automatically execute the Tool again;
- selection behavior is explicit and tested: disabled, or navigable only as incomplete state.

## 10. Slice 7 — Orphan/Duplicate Tool Result Integrity

Negative fixtures:

1. `tool_result tc1` with no matching call on selected branch;
2. two terminal `tool_result` Entries for the same `toolCallId` where no documented legacy rule allows it;
3. assistant tool part ID disagrees with semantic `tool_call` ID.

Required behavior:

- projection fails or surfaces an explicit integrity anomaly;
- it must not silently combine unrelated facts;
- Provider continuation must fail closed if a valid Tool conversation cannot be constructed.

## 11. Slice 8 — Final Assistant Model Step Is Persisted Once

Drive one fake Provider response that streams multiple updates and then finishes.

Acceptance:

- UI can observe streaming updates during execution;
- durable Session history gains one new `assistant_message` for that completed AgentLoop Model Step;
- no newly-written `message_update` Entry is produced;
- final text/reasoning/tool-call content is present in the stored assistant message;
- durable-message normalization still removes expected `undefined` optional fields without weakening strict JSON validation.

### 11.1 Runtime Regression — AI SDK Reuses Assistant `UIMessage.id` Across Tool Continuation

This regression was added after a real CLI Tool-using conversation failed with:

```text
Finalized durable assistant message <id> already exists with different content
```

The failure occurs because AI SDK v7 may keep the last assistant `UIMessage` as one aggregate UI object across multiple Tool-continuation Model Steps. The second Model Step therefore has the same aggregate `UIMessage.id` but contains additional parts.

Red scenario:

1. Model Step 1 completes with aggregate assistant `UIMessage.id=A` and a Tool Call;
2. Step 1 is durably finalized;
3. Tool Call/Result complete;
4. Model Step 2 completes by extending the same aggregate `UIMessage.id=A`;
5. treating `A` as durable message identity attempts an incompatible rewrite and must reproduce the historical failure.

Green acceptance:

- Step 1 and Step 2 persist as two immutable `assistant_message` Entries with identities derived from their distinct AgentLoop `stepId` values;
- the last AI SDK `step-start` marker is used to select only the current Model Step parts;
- the runtime `step-start` marker itself is not persisted as semantic assistant content;
- the second durable assistant Entry does not duplicate Step 1 Tool Call parts or terminal Tool output;
- no normal `message_update` is written;
- re-finalizing the same durable `stepId` with incompatible content still fails closed;
- after both durable steps and a later user follow-up, fake Provider compilation contains exactly one matching Tool Call/Result pair plus the second-step assistant text and follow-up user input.

## 12. Slice 9 — Tool Terminal Flow Produces No New Message Update

Run a fake assistant response containing a Tool Call through the real local Tool durability seam.

Expected canonical new-write order:

```text
assistant_message
tool_call
tool_result
```

Acceptance:

- no normal `message_update` is appended for Tool completion;
- `tool_call` commits before Tool Runtime execution begins;
- `tool_result` commits before next Provider continuation begins;
- terminal Tool UI state is derived from projection after commit;
- failed Tool paths preserve the same ordering.

## 13. Slice 10 — Provider Tool Continuation Remains Valid

This is a mandatory integration regression.

Scenario:

1. fake Provider returns assistant Tool Call;
2. fake Tool returns terminal result;
3. Session persists without `message_update`;
4. next fake Provider continuation captures compiled input.

Acceptance:

- next Provider input contains a valid assistant Tool Call followed by the matching Tool Result semantics expected by AI SDK/provider conversion;
- no Tool result is lost merely because it is no longer copied into a durable assistant message revision;
- no duplicated Tool result appears;
- Tool Result Working Set/pruning can still identify the canonical durable source.

## 14. Slice 11 — Legacy Session Compatibility

Load a fixture containing historical `message_update` Entries from the current v3 format.

Acceptance:

- `LocalSessionStore.load()` succeeds;
- Message Projection reconstructs the same effective historical messages as before;
- Navigation Projection folds update rows;
- continuing the restored Session writes new finalized message style only;
- no migration rewrites/deletes existing Entry rows.

## 15. Slice 12 — Branch Navigation From ToolUse

Create:

```text
user
assistant(tool)
tool_call
tool_result   <- projected ToolUse target
assistant
```

Then select ToolUse and continue with a new user message.

Acceptance:

- underlying jump target is terminal `tool_result`;
- projected branch state includes the Tool outcome;
- new continuation becomes a child branch from the selected canonical terminal state;
- original later assistant branch remains intact;
- no `message_update` node is needed to represent the fork.

## 16. Slice 13 — Navigation Carry / Branch Summary Interop

Use existing `ask | always | never` branch-summary navigation policy around projected rows.

Acceptance:

- selecting a projection row resolves to a canonical Entry before path-loss analysis;
- No Carry changes only active navigation state;
- Carry appends at most the existing one `branch_summary` semantic Entry under the accepted target;
- Cancel leaves source active;
- projection never creates a durable branch by itself.

## 17. Slice 14 — Compaction and Tool Working Set Regression

Build history containing:

- finalized assistant messages;
- Tool Call/Result pairs;
- a compaction checkpoint;
- optionally a legacy update before the checkpoint.

Acceptance:

- latest checkpoint semantics remain unchanged;
- Tool Result pruning continues to use canonical `tool_result` source identity;
- old updates absorbed/restored through legacy compatibility do not duplicate Tool state;
- navigation may display compaction/branch-summary landmarks without changing Context Projection.

## 18. Slice 15 — Session Store Schema Boundary

Acceptance:

- no new SQLite columns/tables are required by this feature;
- existing `LocalSessionEntry.entryJson` rows remain readable;
- strict JSON-safe validation remains unchanged;
- the implementation does not mutate stored historical `entryJson` records to remove `message_update`.

If implementation discovers a schema migration is actually required, stop and update the ADR/design before proceeding.

## 19. Mutation and Purity Tests

For all projections:

- freeze or retain canonical input Entries;
- execute projection;
- assert source Entry objects and nested Tool output/message parts are unchanged;
- assert sibling branch data was not read into the selected branch projection;
- repeat projection and assert deterministic equality.

## 20. Suggested Focused Verification Commands

Exact filenames may evolve, but the implementation sequence should remain focused:

```text
bun test packages/harness/tests/session-tree.test.ts
bun test packages/cli/tests/session-navigation-projection.test.ts
bun test packages/cli/tests/durable-session-message.test.ts
bun test packages/cli/tests/local-session-tool-durability.test.ts
bun test packages/cli/tests/local-session-durable-turn.test.ts
bun test packages/cli/tests/durable-session-message-persistence.test.ts
bun test packages/cli/tests/local-session-authority.test.ts
```

Then run the relevant package suites and checks required by repository instructions.

## 21. Required Red -> Green Delivery Order

1. Red: raw navigation exposes/follows update nodes.
2. Green: pure Navigation Projection folds updates and preserves branch topology.
3. Red: Tool Call/Result appear as independent navigation facts.
4. Green: derived ToolUse pairing and terminal target.
5. Red: normal model/tool flow writes `message_update`.
6. Green: finalized assistant one-time persistence and Tool terminal projection.
7. Red/Green: reused AI SDK assistant `UIMessage.id` across Tool continuation is split into immutable step-scoped durable assistant messages.
8. Red/Green: Provider continuation without durable Tool message write-back.
9. Green: legacy restart/continue compatibility.
10. Green: `/tree` integration and branch-carry behavior.
11. Full regression/documentation delivery gate.

## 22. Definition of Done

The implementation is not considered delivered until all of the following are proven:

- new normal execution produces zero `message_update` Entries;
- legacy updates still load/project correctly;
- one Tool Call/Result pair produces one ToolUse navigation row;
- terminal ToolUse targets terminal canonical state;
- single-child visible history renders flat;
- real branches remain structurally correct after hidden-node contraction;
- Tool request remains committed before external execution;
- Tool result remains committed before Provider continuation;
- aggregate AI SDK assistant message identity never substitutes for durable AgentLoop Model Step identity;
- fake Provider continuation receives valid non-duplicated Tool semantics;
- restart/continue and branch navigation remain local-first and append-only;
- no Session/Runtime Store schema scope creep occurs;
- Usage/Context Window, cloud sync, parallel Tool execution and unrelated UI work remain outside the implementation.

## 23. Verification Record — 2026-08-27

The completed implementation passed:

- CLI suite: **171/171** tests, **642** assertions;
- Harness suite: **99/99** tests, **341** assertions;
- Local Session Store suite: **11/11** tests, **41** assertions;
- CLI TypeScript check;
- Local Session Store TypeScript check;
- CLI production build;
- `git diff --check`.

The reused assistant `UIMessage.id` regression is covered both at the durable-message seam and through fake-Provider compilation after a Tool continuation plus a later user follow-up. Real external DeepSeek execution is not claimed as an automated test gate.
