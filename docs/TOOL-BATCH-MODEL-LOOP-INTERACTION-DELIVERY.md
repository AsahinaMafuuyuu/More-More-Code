# Tool Batch, Model Loop, Follow-up Queue & Active Runtime Delivery Contract

## Status

Implementation complete; automated and native-renderer delivery gates passed.

The code scope is implemented and verified by the repository test/typecheck/build gates and the complete native OpenTUI stress matrix below. The stage is **not marked `Delivered` yet only because the test contract also calls for a human, provider-backed active-run keyboard/queue acceptance pass**. That check would invoke a real external Provider and is intentionally not fabricated by this implementation run. Deterministic keyboard/queue/config behavior is covered by automated tests, and native renderer stability is covered by the full stress matrix.

## Required deliverables

### Harness

- [x] ToolUse is removed from user-facing Model Loop counting.
- [x] Follow-up establishes a new Interaction Round / budget epoch.
- [x] Steering remains in the current Round.
- [x] Tool Batch barrier is explicit.
- [x] Serial scheduling remains the default.
- [x] Parallel scheduling is bounded and safety-aware.
- [x] Provider-facing Tool Results preserve model-emitted order.

### Config

- [x] `tools.execution.mode = serial | parallel`.
- [x] `tools.execution.maxConcurrency` is typed and bounded (`1..16`, default `4`).
- [x] global/project merge is covered field-by-field.
- [x] `/config` exposes project-scope serial/parallel and concurrency selection through the typed Agent Config authority; no secret surface is added.

### Pending interaction queue

- [x] Enter while active queues follow-up.
- [x] Ctrl+Enter while active queues steering.
- [x] Shift+Enter remains newline.
- [x] pending follow-up rows appear above Composer.
- [x] pending row can be cancelled.
- [x] pending follow-up can be promoted to steering.
- [x] cancellable pending input is ephemeral until consumption.
- [x] consumed input is durably committed before the next Provider side effect.
- [x] active-to-idle acceptance races re-route the exact input through normal durable submission instead of dropping it.
- [x] run interruption/failure and consumed-interaction commit failure expose explicit not-sent outcomes.

### Active Runtime UX

- [x] collapsed reasoning visibly indicates active work.
- [x] Tool batch visibly indicates active/completed/failed counts.
- [x] Thinking / Tools / Responding / Settling are distinguishable from a frozen TUI.
- [x] active presentation does not add a Session-root render loop.
- [x] safe TUI profile remains supported and disables the presentation-only elapsed timer.

## Implementation notes

- Tool batches are planned by the provider-independent `ToolBatchScheduler`. Parallel-safe tools are bounded by `maxConcurrency`; unsafe/unknown tools form serialized barrier waves.
- A Tool adapter/infrastructure failure settles every already-started Tool in its current wave and then fails closed; later waves never start.
- Pending steering/follow-up text is process-local queue state. The Harness selects the interaction, then the Session adapter performs `commitInteraction` before the next Turn/Provider request.
- `/config` and `/settings` resolve to the same settings authority. Direct Tool execution changes are serialized through the AgentEnvironment mutation queue and atomically persisted without replacing sibling `tools.native` or `tools.mcp` configuration.
- The queue and Active Runtime projections use independent Session UI Store slices so queue/runtime churn does not require historical Conversation rerenders.

## Explicit architecture invariants

Delivery is rejected if any implementation:

- persists a cancellable queue item as semantic Session history before consumption;
- starts the next model call after only a partial Tool Batch result set;
- serializes parallel Tool Results in nondeterministic completion order;
- counts ToolUse as a Model Loop;
- resets the current Round budget on steering;
- mutates an already-snapshotted Provider request with late follow-up text;
- moves AgentLoop or Session authority into React;
- adds raw pending input text to Runtime Event payloads;
- reintroduces a Session-root animation/render timer.

## Expected implementation areas

```text
packages/harness/src/agent-loop.ts
packages/harness/src/types.ts
packages/cli/src/lib/agent-config.ts
packages/cli/src/lib/tool-registry.ts
packages/cli/src/lib/tool-runtime.ts (or dedicated scheduler module)
packages/cli/src/app/session/session-controller.ts
packages/cli/src/ui/session/composer/*
packages/cli/src/ui/session/interaction/*
packages/cli/src/ui/session/store/*
packages/cli/src/components/messages/bot-message.tsx
packages/cli/src/ui/session/surfaces/*
```

The final implementation may choose narrower modules, but it must preserve the documented ownership boundaries.

## Verification evidence to record on delivery

Final code-state evidence on 2026-08-29:

- `bun test packages/harness/tests`: **122 pass, 0 fail, 421 expectations**.
- `bun test packages/cli/tests`: **323 pass, 0 fail, 1093 expectations, 72 files**.
- Harness / Shared / CLI / Server `tsc --noEmit`: **pass**.
- CLI build: **pass**, 6.80 MB bundle.
- Server build: **pass**, 9.0 MB bundle.
- `bun install --dry-run --frozen-lockfile`: **pass**.
- `git diff --check`: **pass**.
- Native OpenTUI release matrix with `MORE_MORE_CODE_TUI_SOAK_BUFFERED_OUTPUT=memory`: **pass**, suite elapsed **110.811 s**.
  - idle 20 s / normal: **pass**.
  - stream 45 s / normal: **pass** — 26,961 source updates, ~599.1 updates/s, 96.81% coalescing, 861 native renderer frames.
  - churn 45 s / normal: **pass** — 13,657 source updates, ~303.5 updates/s, 87.31% coalescing, 3,992 scroll operations, 1,096 dialog operations, 1,306 native renderer frames.
  - every workload reports correct final state, commit budget, stress volume, and interaction pressure.
- Native OpenTUI churn 3 s / safe: **pass** — ~320.3 source updates/s, 87.83% coalescing, 273 scroll operations, 73 dialog operations.

### Native stress transport note

Direct stdout rendering through DevCodex ConPTY captures every ANSI frame and introduces output backpressure. The dev-only soak harness therefore supports `MORE_MORE_CODE_TUI_SOAK_BUFFERED_OUTPUT=memory`, which maps directly to OpenTUI 0.5.9 `CliRendererConfig.bufferedOutput = "memory"`. It keeps the native renderer, scheduler, layout, scroll, dialog, frame accounting, and render budgets active while preventing terminal-byte transport from distorting wall-clock results. Default soak behavior remains `stdout`; production rendering is unchanged.

### Remaining release acceptance

Run one human/provider-backed active session in a normal terminal and manually confirm Enter follow-up, Ctrl+Enter steering, Shift+Enter newline, queue cancel/promote, collapsed active feedback, and `/config` switching. This is a release acceptance check, not an unimplemented code path.

Pre-existing/non-regression warnings observed during successful gates:

- several OpenTUI React tests emit existing `act(...)` warnings while still passing;
- Git on this Windows checkout reports LF -> CRLF working-copy warnings; `git diff --check` itself is clean.

## Rollback boundary

This stage must remain source-revertable without Session/Runtime database migration. Pending queue state is ephemeral. Tool execution config is additive and defaults to existing serial behavior, so reverting the scheduler/UI work must leave existing Session data readable.
