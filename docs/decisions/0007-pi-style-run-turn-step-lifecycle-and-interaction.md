# ADR-0007: Pi-Style Run / Turn / Step Lifecycle and Interaction

## Status

Accepted

## Date

2026-08-12

## Context

ADR-0006 made Execution Events the canonical source of Run / Turn / Step state, but the initial implementation still treated one user submit as one Turn and placed every subsequent model/tool cycle inside that same Turn. That made Turn mostly a container rather than an operational lifecycle boundary.

The runtime also exposed `onStateChange(run)` and Run-level interrupt, but it did not provide a first-class lifecycle stream for extensions/UI, an idle-settlement barrier, Turn-safe steering/follow-up queues, or Step progress events.

Pi-agent uses a useful separation:

- a top-level agent processing cycle has start/end lifecycle;
- a Turn is one LLM response plus the tools requested by that response;
- tools and streaming work have their own start/update/end lifecycle;
- steering is accepted while busy but injected only after the current Turn reaches a safe boundary;
- follow-up work is queued until the agent would otherwise become idle;
- final lifecycle subscribers are part of runtime settlement.

MORE-MORE-CODE should adopt these operational semantics while preserving its own Event Store and Run / Turn / Step projections.

## Decision

### Run lifecycle

A Run is the complete processing cycle triggered by an initial user submit. It starts with `run.started` and ends only with `run.completed`, `run.failed`, or `run.interrupted`.

The Harness exposes:

- `interrupt()` — request cancellation of the active Run;
- `waitForIdle()` — wait until execution and awaited `run_end` subscribers settle;
- `isBusy` — includes final lifecycle settlement, not only `run.status === "running"`;
- `currentRun` — event-backed Run projection.

A new structural Run is rejected while `isBusy` is true.

### Turn lifecycle

A Turn is now exactly one model invocation plus all Tool Steps requested by that model response.

Examples:

```text
Run
├── Turn 0 (initial)
│   ├── Model Step
│   ├── Tool Step
│   └── Tool Step
└── Turn 1 (tool-continuation)
    └── Model Step
```

A Turn records a `cause`:

```text
initial
tool-continuation
steering
follow-up
```

Steering and follow-up interactions may carry an `inputMessageId` and metadata. When consumed, their interaction ID and input message ID are attached to the next `turn.started` event and therefore survive Run projection/replay.

### Turn-safe interaction queues

`steer()` and `followUp()` are accepted only while a Run is active.

Steering semantics:

1. queue while the current Turn is running;
2. finish the current model response and all its Tool Steps;
3. emit/settle `turn_end`;
4. consume steering before automatic tool continuation;
5. start a new Turn with cause `steering`.

Follow-up semantics:

1. queue while the Run is active;
2. let steering and any required tool-continuation Turns finish first;
3. when the Run would otherwise complete, consume one follow-up;
4. start a new Turn with cause `follow-up`.

This prevents queued input from mutating an already-snapshotted provider request.

### Follow-up loop-budget epochs

A follow-up remains part of the same structural Run and therefore preserves one continuous Execution Event history. However, it represents a new user interaction after the previous interaction reached an idle boundary. Runtime safety budgets are therefore scoped to the current interaction epoch rather than the entire Run:

- `initial`, `steering`, and `tool-continuation` Turns share the current `maxTurns` / `maxSteps` budget;
- consuming a `follow-up` starts a fresh budget epoch;
- prior Turns and Steps remain in the Run projection and event history and are not deleted or renumbered.

This prevents a long completed interaction from leaving only one or two remaining loop iterations for a newly queued follow-up while keeping replay/history semantics intact.

### Multi-dimensional runaway budgets (2026-08-29 amendment)

The original implementation used one default `maxSteps=64` budget where both a Provider Model Step and every individual Tool Call consumed one unit. Real coding-agent workloads showed that this conflated two materially different resources: one legitimate interaction reached 27 model iterations plus 37 distinct Tool executions and failed exactly at 64 total Steps even though there was no repeated identical Tool Call.

The Harness therefore keeps a finite fail-safe but no longer treats one small total-Step counter as the primary workload policy. One interaction epoch now has independent limits:

```text
maxTurns      = 128
maxModelSteps = 128
maxToolSteps  = 512
maxSteps      = 1024  # absolute safety ceiling
```

`follow-up` still starts a fresh budget epoch. Model and Tool budgets are checked before their respective side effects, and the total-Step ceiling remains an independent last-resort guard for future Step kinds and configuration overrides.

This is deliberately not an unlimited loop. Long-running agents still need bounded resources and explicit interruption. Future protection may add wall-clock/cost budgets and semantic no-progress/cycle detection, but such detectors must not classify a long sequence of distinct repository-inspection Tool Calls as a loop merely because it exceeds 64 Steps.

### Step lifecycle

A Step remains one concrete execution unit:

- `model` — one provider request/stream;
- `tool` — one local Tool execution.

Canonical Execution Events keep coarse lifecycle facts:

```text
step.started
step.completed
step.failed
step.interrupted
```

High-frequency progress is emitted only through the ephemeral lifecycle stream as `step_update`. It is not appended to the canonical Execution Event Store, avoiding future WAL growth from token/tool progress events.

Model and Tool Step contexts receive:

- an `AbortSignal` for the active Run;
- `reportProgress()` for ephemeral progress;
- current Run / Turn / Step projections.

Immediate tool cancellation still depends on the future Tool Runtime supporting the signal.

### Awaited lifecycle stream

`AgentLoop.subscribe()` exposes ordered runtime lifecycle events:

```text
run_start
turn_start
step_start
step_update
step_end
turn_end
run_end
```

Listeners are awaited in registration order. They may inspect current projections and may call documented control APIs such as `interrupt()`, `steer()`, or `followUp()`.

Start events act as barriers: if a listener interrupts at `turn_start` or `step_start`, the Harness must not start the subsequent provider/tool execution.

`run_end` is the final settlement barrier. The Run projection may already be terminal while `isBusy` remains true until all `run_end` listeners have completed.

Lifecycle listener failures are reported through the optional `onLifecycleError` hook and do not rewrite canonical execution history.

### CLI interaction

The CLI keeps the editor available while a Run is active:

```text
Enter       -> queue steering
Alt+Enter   -> queue follow-up
Escape      -> interrupt Run
```

Queued interactions become normal user messages only when the Harness starts their corresponding next Turn.

## Alternatives Considered

### Keep one user submit equal to one Turn

- Pros: minimal changes to the existing implementation.
- Cons: multiple provider/tool cycles collapse into one Turn and there is no stable Turn boundary for steering, compaction checks, hooks, or future permission/runtime decisions.
- Rejected: it makes Turn structurally present but operationally weak.

### Apply steering immediately to the active provider request

- Pros: lower apparent latency.
- Cons: mutates an in-flight snapshot, creates race conditions with tool execution, and makes replay semantics ambiguous.
- Rejected: steering is a next-Turn interaction.

### Persist every Step progress update as an Execution Event

- Pros: complete low-level trace.
- Cons: token streaming and tool progress can create very large event logs and are not required to reconstruct lifecycle state.
- Rejected: progress belongs to the ephemeral lifecycle/UI stream.

### Put interaction handling in React `useChat`

- Pros: easy UI implementation.
- Cons: Turn-safe ordering would then depend on React/AI SDK state rather than Harness execution semantics.
- Rejected: Harness owns queue timing; CLI only converts consumed interactions into concrete messages.

## Consequences

- Run / Turn / Step now each have meaningful lifecycle boundaries and inspection surfaces.
- Tool-result continuation creates a new Turn.
- Steering/follow-up can be entered while the Run is active without mutating the active request.
- Follow-up starts a fresh loop-budget epoch without starting a new Run or discarding earlier Execution Events.
- Lifecycle listeners can safely influence future phases at documented barriers.
- `run_end` settlement is distinguishable from the Run projection becoming terminal.
- Execution Event replay remains deterministic and does not contain high-frequency progress noise.
- Session Tree still persists completed conversation history separately from execution lifecycle.
- Immediate cancellation of an already-running local Tool remains future Tool Registry work.
