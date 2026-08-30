# Tool Batch, Model Loop, Follow-up Queue & Active Runtime Test Plan

## Status

Executed. Functional/automated gates and the complete native OpenTUI stress matrix pass on the final implementation. A human/provider-backed active-run interaction pass remains a release acceptance item.

## Harness tests

### Model Loop semantics

- A model response with three Tool Calls increments `modelLoops` once, not four times.
- ToolUse count does not consume the primary Model Loop budget.
- Tool continuation increments Model Loop once when the Provider is called again.
- A consumed follow-up starts a new Interaction Round and resets Model Loop / Tool Call round budgets.
- Steering starts the next safe Turn but stays in the current Round and does not reset budgets.
- Auxiliary semantic compaction/reduction Provider calls do not increment Agent Model Loop budget.
- Each exhausted budget reports the correct dimension.

### Tool batch barrier

- Serial mode executes A -> B -> C and invokes the model only after C is terminal.
- Parallel mode starts eligible safe Tools concurrently up to `maxConcurrency`.
- Unsafe/unknown Tools remain serialized in parallel mode.
- Provider-facing results remain A, B, C even when completion order is C, A, B.
- One failed Tool still produces a terminal result and the barrier waits for the rest of the started batch.
- interrupt aborts active batch work and no continuation model request starts before settlement.

## Config tests

- omitted config resolves to `serial` and default concurrency;
- global value is overridden by project value;
- invalid mode fails validation;
- zero/negative/non-integer/over-limit concurrency fails validation;
- `/config` exposes the typed setting without exposing secrets;
- `/settings` compatibility behavior, if retained, resolves to the same authority.

## Session durability tests

- enqueueing a follow-up while running does **not** append a Session `user_message` yet;
- cancelling it leaves Session history unchanged;
- promotion from follow-up to steering leaves Session history unchanged until consumption;
- when consumed, the interaction is committed exactly once before the next Provider call;
- rejected Session commit prevents the next Provider call;
- active/idle submit race never drops or duplicates the text.

## Queue tests

- FIFO follow-up ordering;
- steering priority at the safe boundary;
- cancellation by stable interaction ID;
- atomic follow-up -> steering promotion;
- consumed interactions cannot be cancelled;
- Run completion does not strand an accepted follow-up;
- interrupt/failure produces an explicit queue outcome rather than silently losing text.

## Composer/UI tests

Idle:

- Enter -> submit;
- Shift+Enter -> newline;
- Tab -> Build/Plan.

Running:

- Enter -> follow-up queue;
- Ctrl+Enter -> steering queue;
- Shift+Enter -> newline;
- Esc -> interrupt.

Queue surface:

- renders one/two rows plus `+N queued` overflow summary;
- cancel invokes only queue cancellation;
- Steer promotes the exact selected follow-up;
- queue updates do not rerender unrelated historical conversation rows.

Active state:

- collapsed active reasoning renders an active marker;
- active marker advances only while active under the normal TUI profile;
- safe profile retains a static active indication without presentation churn;
- Tool batch displays active/completed counts;
- completion freezes duration/removes pulse;
- unrelated Status/queue changes preserve Conversation scroll position.

## Provider/cache regression

- DeepSeek Tool continuation preserves prior `reasoning_content`;
- parallel batch completion order does not change Provider message ordering;
- stable system/tool definitions remain byte-stable between Tool continuations;
- previous Tool Result projections are not rewritten merely because a later batch executes in parallel.

## Performance / soak

- 100+ Model/Tool lifecycle transitions without runaway UI renders;
- parallel safe batch with configured concurrency never exceeds the limit;
- queue churn does not grow canonical Runtime Event volume;
- active indicator stays within existing render-budget thresholds.

Executed native evidence:

- full release matrix (`idle 20 s`, `stream 45 s`, `churn 45 s`): pass in 110.811 s using OpenTUI native `bufferedOutput: "memory"` to avoid connector ANSI backpressure;
- normal stream, 45 s: 26,961 updates, ~599.1 source updates/s, ~96.81% coalescing, 861 native renderer frames;
- normal churn, 45 s: 13,657 updates, ~303.5 source updates/s, ~87.31% coalescing, 3,992 scroll and 1,096 dialog operations, 1,306 native renderer frames;
- safe churn, 3 s: pass at ~320.3 source updates/s with ~87.83% coalescing, 273 scroll and 73 dialog operations.

The memory sink is a dev-soak transport option only. Default soak and production renderer output remain stdout. It does not replace OpenTUI with `testRender` or bypass native scheduling/render pressure.

## Delivery commands

```text
bun test packages/harness/tests
bun test packages/cli/tests
bunx tsc --noEmit -p packages/harness/tsconfig.json
bunx tsc --noEmit -p packages/shared/tsconfig.json
bunx tsc --noEmit -p packages/cli/tsconfig.json
bunx tsc --noEmit -p packages/server/tsconfig.json
bun run --filter @more-more-code/cli build
bun run --filter @more-more-code/server build
bun install --dry-run --frozen-lockfile
git diff --check
```

Manual native-TUI verification is required for keyboard semantics, queue actions, collapsed active feedback, scroll preservation, and serial/parallel configuration switching.

Automated equivalents cover these behaviors in the final suite, including the real `/config` dialog and project-config persistence. Manual provider-backed active-run interaction remains a release acceptance item because performing it would intentionally create an external Provider request rather than a deterministic repository test.
