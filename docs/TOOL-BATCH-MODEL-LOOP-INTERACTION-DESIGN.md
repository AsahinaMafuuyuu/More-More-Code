# Tool Batch, Model Loop, Follow-up Queue & Active Runtime Design

## Status

Accepted design / implementation not started.

This document defines the next runtime-interaction follow-up for MORE-MORE-CODE. It deliberately spans Harness and UI because the user-visible interaction semantics depend on the execution boundary.

## Goals

1. Support serial and bounded-parallel execution for one model-emitted Tool batch, with serial as the default.
2. Redefine the user-facing Agent loop budget around primary model invocations rather than ToolUse count.
3. Make follow-up a first-class queued interaction while an Agent Run is active.
4. Allow a queued follow-up to be cancelled or promoted to steering before it is consumed.
5. Preserve Shift+Enter as multiline input and provide an explicit steering shortcut.
6. Make active reasoning/tool execution visibly alive even when detailed reasoning/tool content is collapsed.
7. Preserve Session append-only durability, provider Tool Call/Result pairing, Context cache stability, and UI render isolation.

## Non-goals

- No dependency-inference language for arbitrary shell commands.
- No unsafe `Promise.all()` over every Tool Call.
- No mid-token mutation of an already-snapshotted Provider request.
- No Tool Result streaming back into the model before the current Tool batch barrier.
- No new Provider protocol.
- No new durable Runtime Event type merely for UI queue animation.
- No persistence of pending/cancellable follow-up drafts as semantic Session messages before consumption.

## 1. Execution vocabulary

The implementation must stop using `step` and `loop` as if they were equivalent.

### Interaction Round

An Interaction Round begins with either the initial user submission or a consumed follow-up. Follow-up starts a new Round and resets the primary Model Loop budget. Steering does not start a new Round.

The current structural `AgentRun` may continue across follow-ups so execution/audit history remains continuous. Round boundaries can be derived from `initial` / `follow-up` Turn causes; a new persistent entity is not required for V1.

### Model Loop

One Model Loop is one **primary Agent Provider invocation** that receives the current canonical context and returns assistant output / Tool Calls.

It does not include ToolUse execution, Tool Result persistence, permission/approval waiting, semantic compaction Provider calls, or Branch Summary reduction Provider calls.

Auxiliary Provider calls remain billable Usage/Cost and retain their own timeout/retry limits, but they do not consume the Agent's `maxModelLoops` budget.

### Tool Batch

All Tool Calls emitted by one completed Model Loop belong to one Tool Batch. The next primary Model Loop may not begin until every Tool Call in that batch reaches one terminal Tool Result state.

```text
Model Loop N
   |
   +-- tool_call A
   +-- tool_call B
   +-- tool_call C
   |
   v
Tool Batch N
   |
   +-- A terminal
   +-- B terminal
   +-- C terminal
   |
   v
Batch Barrier
   |
   v
Model Loop N+1
```

This barrier remains invariant in both serial and parallel modes.

## 2. Tool execution configuration

V1 configuration belongs in the existing layered Agent Config and is exposed through the typed `/config` surface. Project config overrides global config using the existing merge rules.

Proposed shape:

```json
{
  "tools": {
    "execution": {
      "mode": "serial",
      "maxConcurrency": 4
    }
  }
}
```

Resolved defaults:

```text
tools.execution.mode = serial
tools.execution.maxConcurrency = 4
```

Validation:

- `mode`: `serial | parallel`;
- `maxConcurrency`: positive integer, bounded to a conservative implementation maximum such as 16;
- `maxConcurrency` is ignored in serial mode but still validated.

`/settings` may remain as a compatibility alias if the current command surface requires it; `/config` is the preferred user-facing terminology for this stage.

## 3. Serial vs parallel semantics

### Serial mode

Preserve today's deterministic behavior:

```text
A -> B -> C -> barrier -> Model
```

### Parallel mode

Parallel mode means **bounded safe concurrency**, not blindly executing every call concurrently.

Tool capability metadata gains an execution-safety declaration, conceptually:

```ts
type ToolExecutionSafety = {
  parallelSafe: boolean;
  effect: "read" | "write" | "process" | "unknown";
};
```

Initial safe candidates may include read-only native capabilities such as `readFile`, `grep`, `glob`, `listDirectory`, and `loadSkill`. `bash` remains unsafe/unknown by default because its dependency and mutation surface cannot be inferred from the Tool name alone.

The scheduler creates execution waves:

```text
Wave 1: readFile A | grep B | glob C    (bounded parallel)
Wave 2: bash D                         (serialized)
Wave 3: readFile E | readFile F        (bounded parallel if safe)
```

V1 does not attempt full resource-DAG analysis. A later stage may add read/write resource keys and conflict-aware scheduling.

### Deterministic Result ordering

Parallel completion order must never become Provider history order.

```text
model order:      A, B, C
completion order: C, A, B
provider results: A, B, C
```

This is required for deterministic replay, Provider prefix stability, and stable Tool Call/Result pairing.

## 4. Budget semantics

The main runaway policy becomes multi-dimensional:

```text
maxModelLoops       primary Agent reasoning iterations per Interaction Round
maxToolCalls        independent ToolUse runaway ceiling per Interaction Round
maxExecutionSteps   catastrophic internal safety ceiling only
```

The existing `maxSteps`/`maxTurns` terminology should be retired from user-facing loop errors. Internal compatibility aliases may remain during migration, but ToolUse must not consume `maxModelLoops`.

Recommended V1 behavior:

- keep the current conservative primary-model ceiling during migration rather than lowering it in the same change;
- reset Model Loop and Tool Call round counters when a follow-up is consumed;
- steering stays in the current Round and therefore does not reset counters;
- auxiliary semantic reduction calls are accounted for Usage/Cost but not Agent Model Loop budget.

## 5. Follow-up and steering interaction model

### Keyboard semantics

When idle:

```text
Enter        submit a new Interaction Round
Shift+Enter  newline
Tab          toggle Build / Plan
```

When a Run is active:

```text
Enter        enqueue Follow-up
Ctrl+Enter   enqueue Steering for the current Round
Shift+Enter  newline
Esc          interrupt Run
```

Shift+Enter stays newline because that is already the established Composer contract and a common multiline convention.

Steering is not a mid-token Provider mutation. It takes priority at the next safe Turn boundary, matching the current Harness steering semantics.

### Queue surface

Pending interactions appear in a narrow surface immediately above the Composer.

```text
Follow-up queued
  Check the migration tests again.                 Steer  ×
  Verify the README after the build.                Steer  ×
  +3 queued
```

Rules:

- FIFO for follow-ups;
- Steering has priority over automatic Tool continuation at the next safe boundary;
- show at most 1-2 full rows by default, then `+N queued`;
- `×` cancels an unconsumed pending interaction;
- `Steer` atomically promotes that follow-up to steering;
- once an interaction is consumed and durably committed, it can no longer be cancelled from this queue.

## 6. Critical durability change for cancellable queues

The current implementation persists steering/follow-up as a `user_message` **before** adding it to the AgentLoop queue. That is incompatible with a cancellable queue: cancelling would leave an immutable semantic Session message that was never consumed by the model.

V1 therefore changes the boundary:

```text
User Enter while active
        |
        v
Ephemeral PendingInteraction
        |
  cancel/promote allowed
        |
        v
Harness selects interaction at safe boundary
        |
        v
CLI commits user_message durably
        |
        v
commit succeeds
        |
        v
start next primary Model Loop
```

The durable-before-side-effect invariant remains mandatory. The Provider must never see the follow-up/steering input until its Session message commit succeeds.

Implementation should prefer extending the AgentLoop adapter with a pre-turn interaction preparation/commit seam rather than moving Session authority into Harness.

Pending queue state is runtime/UI state, not semantic Session history and not a durable Runtime Event payload.

## 7. Queue authority and race handling

The queue must have stable interaction IDs and atomic operations:

```ts
enqueueFollowUp(...)
enqueueSteering(...)
cancelPendingInteraction(id)
promoteFollowUpToSteering(id)
```

The submit path must resolve the active/idle race inside SessionController/Harness authority rather than in React:

- if the Run is still active, enqueue;
- if the Run became idle before acceptance, route the same text through a normal new submission;
- never silently lose or duplicate the text.

Queue-change notification is ephemeral lifecycle/projection state. It must not append high-frequency canonical Runtime Events.

## 8. Active Runtime indicator

Reasoning is intentionally collapsed to two lines. When the current assistant message is actively thinking but no visible text changes, the TUI can look frozen.

Derive a narrow active phase from existing runtime projections:

```text
thinking    primary model active, reasoning phase/current reasoning
tools       Tool batch has active ToolUse
responding  primary model streaming visible answer text
settling    durable terminal/usage commit is finishing
idle        no active work
```

Collapsed examples:

```text
◐ Thinking... 12s
◐ Tools 3 · 2 active · 1 completed
◐ Responding...
```

When reasoning is collapsed, the disclosure header itself remains visibly active. The user must not need to expand reasoning to know the process is alive.

Render rules:

- pulse/timer state belongs to the smallest active presentation component;
- do not add a Session-root render loop;
- target a low-frequency presentation tick, approximately 750-1000 ms;
- preserve the existing safe TUI stability profile, which may disable nonessential animated timing while still showing a static active marker;
- terminal completion freezes elapsed time and removes the active pulse.

## 9. Provider and Context invariants

This stage must preserve:

1. one model output creates one Tool Batch;
2. all Tool Results reach terminal state before the next primary model call;
3. provider Tool Result serialization follows original Tool Call order, not completion order;
4. DeepSeek assistant `reasoning_content` continues to round-trip on Tool continuation;
5. parallel execution does not rewrite older model-visible Tool Results;
6. Context compaction/checkpoint logic remains the only mechanism that intentionally establishes a new historical prefix boundary;
7. pending UI follow-ups are not injected into an already-built Provider request.

## 10. Failure semantics

For a Tool Batch containing multiple calls:

- every started Tool Call must reach a terminal normalized result;
- one Tool failure does not implicitly cancel independent already-running Tools unless interruption policy explicitly requires it;
- the batch barrier waits for all started calls to settle;
- the next model call receives terminal results for the complete emitted batch;
- interrupt aborts active Tools through existing signals and marks unresolved calls cancelled where supported;
- permission/approval behavior remains per Tool Call and retains existing fail-closed semantics.

## 11. Implementation slices

1. Harness vocabulary/budget migration.
2. Agent Config schema for Tool execution.
3. Tool capability execution-safety metadata and ToolBatchScheduler.
4. Deterministic batch-result barrier and serial/parallel tests.
5. Cancellable/promotion-capable pending interaction queue with durable-on-consume seam.
6. Composer keyboard and queue surface.
7. Active Runtime indicator and render-budget tests.
8. Full regression, docs, and manual native-TUI verification.

Implementation should not combine all slices into one unreviewable patch.
