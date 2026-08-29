# ADR-0032: Separate Model Loops from Tool Batches and Add a Cancellable Runtime Interaction Queue

## Status

Accepted / planned.

## Context

The current Harness models one Provider request and each ToolUse as separate Steps. A historical total-Step ceiling therefore conflated model reasoning iterations with Tool execution volume. Long coding tasks can legitimately issue many different Tool Calls without being in a runaway model loop.

The desired active-run UX is also different from the current persistence order: normal Enter should queue a follow-up, while explicit steering should remain a higher-priority action. A cancellable queue cannot safely persist the semantic user message before queue consumption.

One model response may also contain multiple Tool Calls. Serial execution is deterministic but can be unnecessarily slow for independent read-only operations. Parallel execution is useful only if the Harness preserves a complete Tool Batch barrier and deterministic Provider result ordering.

## Decision

### Model Loop is a primary Provider reasoning iteration

ToolUse does not count as a Model Loop. Follow-up starts a new Interaction Round and resets round-scoped Model Loop/Tool Call budgets. Steering stays in the current Round.

Auxiliary Provider reductions remain Usage/Cost facts but do not consume the primary Agent Model Loop limit.

### One model output creates one Tool Batch

All Tool Calls emitted by one model output must reach terminal Tool Results before the next primary model request.

Serial mode is the default. Parallel mode is explicit, bounded, and may run only Tool capabilities declared safe for concurrent execution. Unsafe/unknown capabilities remain serialized.

Provider-facing Tool Result order follows the model-emitted Tool Call order, not wall-clock completion order.

### Tool scheduling is configurable

The layered Agent Config gains typed Tool execution settings under `tools.execution`, including serial/parallel mode and bounded concurrency. `/config` is the preferred typed UI surface.

### Pending follow-up/steering is ephemeral until consumed

While a Run is active, Enter queues a follow-up; Ctrl+Enter queues steering; Shift+Enter remains newline.

Pending items may be cancelled or a follow-up may be promoted to steering. Therefore pending interaction text is Runtime/UI state until the Harness selects it at a safe boundary. Immediately before the corresponding model work, CLI Session authority commits the semantic user message. Provider work is blocked if that commit fails.

### Active collapsed work remains visible

Collapsed reasoning and Tool groups show a narrow active indicator while work is live. Animation/timing is isolated to the smallest presentation component and respects the safe TUI stability profile.

## Consequences

- Long Tool-heavy coding tasks are no longer misclassified as excessive model loops.
- Serial behavior remains backward-compatible by default.
- Parallel mode can reduce Tool-batch latency without sacrificing deterministic Provider history.
- Queue cancellation becomes semantically correct because unconsumed drafts are not immutable Session facts.
- Follow-up and steering have different, visible priorities and budget semantics.
- UI remains visibly active during collapsed reasoning without reviving a global render loop.

## Rejected alternatives

### Count every ToolUse as one Agent loop

Rejected because it measures implementation work volume rather than model reasoning iterations and prematurely fails legitimate long tasks.

### `Promise.all()` every Tool Call in parallel mode

Rejected because shell/write/process operations can have ordering dependencies and shared-state races.

### Return each completed Tool Result to the model immediately

Rejected as the default because it breaks the one-output/one-batch barrier, adds Provider round trips, complicates Tool Call/Result pairing and sibling cancellation, and can reduce cache stability.

### Persist follow-up immediately and append a cancellation tombstone later

Rejected for V1 because a cancelled draft is not semantic conversation history.

### Use Shift+Enter for steering

Rejected because Shift+Enter already provides multiline input and should remain stable. Explicit steering uses Ctrl+Enter in the planned interaction map.
