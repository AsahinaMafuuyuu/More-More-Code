# UI Runtime Activity Foundation Test Contract

**Status:** Verified — implementation and regression gates passed on 2026-08-27.

**Design:** `docs/UI-RUNTIME-ACTIVITY-DESIGN.md`

## 1. Test Seams

Tests are written against the approved public CLI seams:

1. `AgentRun + ephemeral progress -> AgentActivityProjection`;
2. `Tool message/canonical Tool facts/current activity -> ToolUseProjection`;
3. projection values -> Activity/ToolUse formatting/presentation;
4. `useChat -> Session -> SessionShell` integration proving authority state
   reaches presentation without React reinterpreting Harness internals.

No test adds a private Harness seam or inspects a database merely to verify UI.

## 2. Slice A — Agent Activity Projection

Red first:

- initial Run with Model Step projects canonical `initial` Turn cause;
- Tool continuation, steering and follow-up causes remain distinct;
- Model and Tool Steps remain distinct and Tool identity is retained;
- active running Step is selected deterministically;
- completed/interrupted/failed statuses remain exact;
- running elapsed time uses injected `now`; completed duration uses `endedAt`;
- absent timing is never fabricated;
- progress message is whitespace-normalized/bounded and progress `details` are
  not surfaced.

## 3. Slice B — Ephemeral Progress Integration

Use an AgentLoop/fake lifecycle path or the narrowest existing CLI seam:

- `step_update` updates process-local Activity progress;
- a new Run clears prior Run progress;
- no Runtime Event or Session Entry is written solely for UI progress;
- progress updates do not alter canonical AgentRun status.

## 4. Slice C — ToolUse Projection

Cover precedence and all states:

- live `input-available` without a canonical call -> `requested`;
- matching active Tool Step -> `running`;
- current pending Approval -> `approval_waiting`;
- canonical completed result -> `completed`;
- canonical failed/cancelled/timed_out/denied -> exact matching presentation;
- historical `approval_required` -> explicit non-resumable diagnostic;
- canonical call without result and no active execution -> `incomplete`;
- terminal canonical result wins over stale live message state;
- duration/source/error/output are projected from canonical result when present;
- no second Tool terminal state is persisted.

## 5. Slice D — ToolUse Formatting / Disclosure

- collapsed row exposes Tool name, concise input summary, semantic status and
  duration when available;
- failure/denial/timeout/cancellation status remains visible while collapsed;
- expanded details bound serialized input/output/error text;
- unserializable/unknown values fail soft in presentation rather than crashing
  the Session transcript;
- mouse disclosure changes local presentation only.

## 6. Slice E — Activity Surface / Width Behavior

Formatter/layout tests where feasible must cover:

- Activity is absent when there is no current Run;
- active/latest Turn is visible by default;
- older completed Turns are compact by default and can be disclosed locally;
- failed/interrupted rows remain visible;
- narrow mode drops secondary metadata before primary status/label;
- medium/wide modes retain duration/progress according to design;
- Session hierarchy is Conversation -> Activity -> Input/StatusBar -> secondary
  hints, with no permanent side pane.

## 7. Slice F — Regression / Integration

- existing steering/follow-up/interrupt behavior is unchanged;
- approval dialog remains authoritative while Activity/ToolUse only observes;
- existing Session Tree navigation semantics remain unchanged;
- Context/API/Cache StatusBar tests remain green;
- legacy/historical incomplete Tool state remains fail-closed and is never
  auto-replayed;
- no Harness/Runtime/Session persistence schema changes occur.

## 8. Required Verification

Run, at minimum:

```text
bun test packages/cli/tests/agent-activity-projection.test.ts
bun test packages/cli/tests/tool-use-projection.test.ts
bun test packages/cli/tests/activity-view.test.tsx        (if renderer-stable)
bun test packages/cli/tests/tool-use.test.tsx             (if renderer-stable)
bun test packages/cli/tests
bun run --filter @more-more-code/harness test
bunx tsc --noEmit -p packages/cli/tsconfig.json
bunx tsc --noEmit -p packages/harness/tsconfig.json
bun run build:cli
git diff --check
```

If OpenTUI renderer behavior makes a component-render test unstable, keep
semantic formatting in exported pure helpers and test that seam instead of
snapshotting terminal internals.

## 9. Definition of Done

- projection tests precede production implementation for each semantic slice;
- Tool outcome and Agent Step lifecycle are not conflated;
- running/completed/interrupted/failed and all Tool terminal states regress;
- current Approval and historical incomplete behavior regress;
- width/density and bounded-detail formatters regress;
- full CLI/Harness relevant suites, typechecks/build and `git diff --check`
  pass before delivery status is changed.
