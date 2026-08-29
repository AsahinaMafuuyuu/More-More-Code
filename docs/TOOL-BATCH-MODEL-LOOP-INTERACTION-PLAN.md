# Runtime Interaction Follow-up Implementation Plan

## Status

Planned. Architecture accepted in ADR-0032.

## Phase 1 — Lock execution semantics

### Task 1: Rename/reframe loop budgets around primary model invocations

- Define Interaction Round derivation from `initial` / `follow-up` causes.
- Make Model Loop count primary model requests only.
- Keep Tool Call and catastrophic execution safety budgets independent.
- Preserve steering inside the current Round.
- Add migration-compatible error types/messages and tests.

**Gate:** Harness tests prove 1 Model + N Tools consumes one Model Loop.

### Task 2: Introduce Tool Batch scheduler contract

- Define one batch per model output.
- Preserve batch barrier before model continuation.
- Return results in emitted Tool Call order.
- Keep interrupt/permission/approval semantics intact.

**Gate:** deterministic serial batch tests pass.

## Phase 2 — Configuration and parallel execution

### Task 3: Add typed Tool execution config

- Add `tools.execution.mode` and `maxConcurrency` to Agent Config.
- Default to serial.
- Merge global -> project deterministically.
- Expose through `/config`; keep compatibility aliases only where needed.

**Gate:** config validation/merge tests pass.

### Task 4: Add parallel-safety metadata and bounded scheduler waves

- Mark explicitly safe read-only native tools.
- Keep bash/process/mutation/unknown tools serialized in V1.
- Bound active parallel Tools by configuration.
- Do not infer arbitrary shell dependencies.

**Gate:** concurrency, ordering, failure and interrupt tests pass.

## Phase 3 — Cancellable interaction queue

### Task 5: Separate pending interaction draft from durable Session message

- Queue pending text ephemerally with stable IDs.
- Add cancel and follow-up -> steering promotion operations.
- Add safe-boundary preparation/commit seam.
- Commit semantic user message exactly once before Provider work.
- Fail closed on Session commit rejection.

**Gate:** cancellation causes zero Session append; consumed interaction commits before Provider request.

### Task 6: Resolve active/idle races and queue lifecycle

- One authoritative submission method decides submit vs follow-up queue.
- No text loss/duplication when Run settles concurrently.
- Define queue outcome on interrupt/failure.
- Expose narrow queue projection to UI.

**Gate:** race and interruption tests pass.

## Phase 4 — Composer and active runtime UX

### Task 7: Implement queue surface and keyboard semantics

- Idle Enter = submit.
- Active Enter = follow-up.
- Active Ctrl+Enter = steer.
- Shift+Enter = newline in all modes.
- Esc = interrupt.
- Queue rows support cancel and Steer promotion.
- Bound visible rows and show overflow count.

**Gate:** keyboard/component tests and manual TUI check pass.

### Task 8: Add isolated active runtime presentation

- Show active thinking when reasoning is collapsed.
- Show active Tool-batch counts.
- Distinguish responding/settling states where possible from existing projections.
- Use narrow low-frequency pulse/timer only in active leaf components.
- Preserve safe TUI profile.

**Gate:** render-isolation/stability tests and manual TUI check pass.

## Phase 5 — Closeout

### Task 9: Provider/cache and durability regression

- DeepSeek reasoning continuation unchanged.
- Tool result Provider ordering deterministic under parallel completion.
- No late follow-up injected into an in-flight request.
- Auxiliary Provider Usage/Cost accounting unchanged.

### Task 10: Full verification and delivery

- Harness full tests.
- CLI full tests.
- Harness/Shared/CLI/Server typechecks.
- CLI/Server builds.
- frozen lock.
- `git diff --check`.
- native TUI manual matrix.
- update delivery document from Planned -> Delivered with actual evidence.

## Implementation order constraint

Do not implement UI queue cancellation before the durable-on-consume interaction seam exists. Otherwise the UI would expose cancellation for data that has already become immutable Session history.
