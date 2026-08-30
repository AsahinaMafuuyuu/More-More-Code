# ADR-0006: Event-Backed Agent Execution Runtime

## Status

Accepted

## Date

2026-08-12

## Context

The Harness already distinguishes Run, Turn, Model Step, and Tool Step, but the first implementation treated `AgentRun` as the canonical mutable execution state. Lifecycle changes such as `step.status = "completed"` or `run.status = "failed"` existed only in process memory. The UI could observe snapshots through `onStateChange`, but the Harness had no append-only record answering what actually happened during an execution.

ADR-0005 separately established canonical message events for conversational history. Message history and execution history must not be conflated: a message event records how conversation content evolves, while an execution event records Agent runtime facts such as a model step starting, a tool step failing, or a Run being interrupted.

The next runtime layers—WAL/crash recovery, tool cancellation, permissions, telemetry, and Subagents—need a stable execution history before they are added.

## Decision

### Execution events are canonical runtime facts

The Harness defines typed append-only lifecycle events for:

```text
run.started / completed / failed / interrupted
turn.started / completed / failed / interrupted
step.started / completed / failed / interrupted
```

Every event carries:

- stable event id;
- session id and run id;
- per-run monotonic `sequence`;
- timestamp;
- Turn/Step identity where applicable;
- Step kind and tool-call metadata on `step.started`;
- error information on failed terminal events.

A Step is represented by a start event plus one terminal event rather than by mutating a persisted Step object.

### Event Store is separated from AgentLoop

`AgentLoop` emits lifecycle facts through the `ExecutionEventStore` contract. The first implementation uses `InMemoryExecutionEventStore`, which:

- keeps append-only event history for the lifetime of the loop/store;
- enforces per-run contiguous sequence numbers;
- rejects duplicate event ids;
- rejects events appended after a terminal Run event;
- returns copies rather than exposing mutable internal event objects.

The Harness does not add database, cloud, or WAL concerns to `AgentLoop`. Durable storage is a later adapter/layer built around the same execution-event model.

### Run / Turn / Step are projections

`AgentRun`, `AgentTurn`, and `AgentStep` remain the public runtime state models expected by the CLI, but they are no longer the canonical execution facts. `projectAgentRun()` / `projectAgentRuns()` replay execution events to reconstruct their current state.

`AgentLoop.currentRun`, adapter contexts, `onStateChange`, and the value returned by `AgentLoop.run()` are therefore projections of event history. This preserves the existing CLI integration while changing the underlying source of truth.

### Execution history and message history remain distinct

```text
Canonical Message Events
    -> Session/UI conversation projection

Execution Events
    -> Run/Turn/Step execution projection

Context Projection
    -> Model input for a specific Model Step
```

These histories may reference common ids such as session/run/message ids, but neither one replaces the other.

## Alternatives Considered

### Keep mutable AgentRun snapshots as the source of truth

- Pros: simplest implementation; already working for UI state.
- Cons: no replay, audit trail, crash diagnosis, or durable execution semantics; future permission/Subagent state would add more mutation paths.
- Rejected: mutable snapshots are useful projections, not a sufficient execution record.

### Persist Run/Turn/Step rows directly to the cloud database

- Pros: immediately durable and queryable.
- Cons: couples local Agent execution to network/database availability, conflicts with the local-first runtime boundary, and prematurely fixes a database schema before local event semantics stabilize.
- Rejected: cloud persistence must remain outside the core execution loop.

### Reuse Session Tree message events for execution lifecycle

- Pros: only one event collection.
- Cons: conversation history and runtime execution have different causality, retention, projection, and recovery requirements.
- Rejected: combining them would recreate the history/context/runtime coupling removed by ADR-0004 and ADR-0005.

## Consequences

- Agent execution can now be deterministically replayed into Run/Turn/Step state.
- Normal, tool, failure, interruption, and max-step paths produce explicit execution traces.
- Existing CLI Run state APIs remain compatible because they consume projections.
- The in-memory Event Store is process-local only; CLI restart still loses execution events.
- Event-store failure is treated as a Harness execution failure because local execution history is canonical. Best-effort cloud session synchronization remains a separate failure domain.
- Local WAL and crash recovery can be added without changing AgentLoop lifecycle semantics.
- Tool Registry/cancellation, Permission Engine, Sandbox telemetry, and Subagent parent/child events can extend the event model in later ADRs without moving those concerns into AgentLoop.
