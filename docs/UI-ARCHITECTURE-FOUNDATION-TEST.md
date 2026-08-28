# UI Architecture Foundation Test Contract

**Status:** Satisfied — final verification recorded in `docs/UI-ARCHITECTURE-FOUNDATION-DELIVERY.md`.

**Date:** 2026-08-27

**Design:** `docs/UI-ARCHITECTURE-FOUNDATION-DESIGN.md`

**Plan:** `docs/UI-ARCHITECTURE-FOUNDATION-PLAN.md`

**ADR:**
`docs/decisions/0028-ui-application-architecture-and-render-isolation.md`

## 1. Test Goal

This stage is an architectural refactor. Passing visual snapshots alone is not
sufficient.

The test contract must prove four classes of correctness:

1. existing Session/runtime semantics are unchanged;
2. application side effects execute exactly once and preserve durable-first
   ordering;
3. UI surfaces subscribe independently and unrelated updates do not trigger
   broad rerenders;
4. current keyboard, Composer, ToolUse, Activity and Session behavior remains
   usable across OpenTUI terminal sizes.

## 2. Test Strategy

Use the narrowest seam that proves the behavior.

Order of preference:

```text
pure contract/unit test
-> controller/store integration test
-> React/OpenTUI component test
-> full Session integration test
```

Do not rely only on large renderer tests when a deterministic pure test can
prove the architecture rule more precisely.

## 3. A1 — Session UI Store Tests

Write Red tests before store implementation.

### 3.1 Store lifecycle

- initial snapshot is deterministic;
- `getSnapshot()` returns the current immutable snapshot;
- subscription receives updates after a valid mutation;
- unsubscribe prevents later notifications;
- destroy makes later writes fail or no-op according to one documented policy;
- destroy releases listeners;
- two store instances remain isolated.

### 3.2 Selector isolation

Given selectors:

```text
conversation
activity
status
composerRuntime
approval
recovery
inspector
```

prove:

- updating activity does not notify unchanged conversation selector;
- updating status does not notify unchanged composer selector;
- Inspector selection does not notify Conversation;
- equality prevents structurally equivalent selected values from causing a
  React rerender;
- an actual selected-value change does notify exactly once.

### 3.3 Authority separation

- store contains projections, not raw RuntimeSession/AgentLoop instances;
- store update cannot create Session Entry or Runtime Event;
- store can be rebuilt from supplied projection snapshots in test without a
  database.

## 4. A2 — Session Controller Tests

Controller tests should use fake/in-memory existing authority adapters where
possible and must not require React.

### 4.1 Command parity

Cover:

- submit;
- steer;
- follow-up;
- interrupt;
- compact;
- change mode;
- change model;
- navigate;
- approval resolve/cancel;
- attach/dispose.

### 4.2 Exactly-once side effects

For each migrated command prove:

- controller invocation calls one intended authority path;
- a UI-store/projection failure after an already-completed Provider call does
  not trigger a Provider retry;
- old compatibility adapter plus new controller cannot both execute the same
  command;
- repeated UI rendering does not repeat authority operations.

### 4.3 Durable-first ordering

Retain regression coverage for:

- user intent commit before AgentLoop side effect;
- model selection visible after successful durable transition;
- Tool terminal persistence before continuation exposure;
- approval allow persistence before executor invocation;
- quiescence before renderer teardown where required.

### 4.4 Failure behavior

- rejected authority operation propagates a typed/normal error to presentation;
- controller does not update UI as if a rejected semantic transition succeeded;
- controller disposal during active work reuses current interrupt/quiescence
  behavior;
- failed attach does not start model/tool work.

## 5. A3 — Projection and Subscription Tests

### 5.1 Activity isolation

Retain and extend the existing regression:

- local elapsed clock advances running Run/Turn/Step display;
- parent workspace render count remains unchanged from elapsed tick;
- Conversation selector notification count remains unchanged;
- Status selector notification count remains unchanged;
- Composer selector notification count remains unchanged;
- terminal elapsed values are not rewritten.

### 5.2 Status isolation

When Context/Usage/Cost/Cache projection changes:

- StatusLine selected state changes;
- Conversation selection remains referentially/equivalently unchanged;
- Activity selection remains unchanged unless runtime lifecycle also changed;
- unknown vs zero semantics remain intact;
- partial/incomplete observability remains explicit.

### 5.3 Composer runtime projection

Test runtime interaction states:

```text
idle
submitted
streaming/model active
tool active
settling
interrupted
failed
```

Prove Composer receives presentation facts rather than raw AgentRun traversal.

### 5.4 Conversation projection

Retain regressions for:

- finalized assistant ordering;
- ToolUse exact call/result correlation;
- terminal Tool status precedence;
- historical incomplete ToolUse;
- legacy `message_update` read compatibility;
- active streaming/final message transition;
- Session branch navigation projection independence.

## 6. A4 — Composer Decomposition Tests

### 6.1 Editor behavior

- Enter submits current text;
- Shift+Enter inserts newline;
- empty/whitespace input does not submit;
- disabled editor does not submit;
- successful submit clears editor exactly once;
- rejected semantic action follows existing product behavior without silently
  losing state if the approved UX requires retention.

### 6.2 Follow-up behavior

- Alt/Option+Enter uses follow-up path when available;
- normal Enter while Run active uses steering path;
- follow-up does not fire while disabled/settling;
- shortcut is blocked by higher interaction layers.

### 6.3 Mention parser/search

Pure tests for:

- active mention token boundaries;
- punctuation around mentions;
- nested path matching;
- hidden-file behavior;
- directory insertion behavior;
- current workspace containment;
- absolute/outside-workspace queries rejected according to existing behavior;
- maximum fallback candidate bound;
- stale async candidate result does not replace newer query state.

### 6.4 Mention menu

- keyboard up/down bounds;
- mouse selection;
- scroll behavior;
- Enter selection;
- Escape closes overlay;
- selection state remains local to mention subsystem.

### 6.5 Command menu

- filtering and selection unchanged;
- selecting a command returns the expected typed CommandIntent;
- menu code cannot directly call Session authority/renderer shutdown in unit
  tests;
- aliases resolve to the same canonical intent where required.

## 7. A5 — Command Router Tests

For every supported CommandIntent:

- maps to exactly one target controller/application action;
- preserves current toast/dialog error behavior where still applicable;
- `/tree` or later `/inspect` routing does not mutate Session semantics merely
  by opening a UI surface;
- `/compact` routes to existing compact authority;
- `/models` model selection uses durable authority transition;
- `/new` remains route/application behavior rather than Composer logic;
- `/exit` reuses safe quiescence/shutdown and does not destroy renderer first.

## 8. A5 — Interaction Router Tests

Build a priority matrix rather than independent one-off shortcut tests.

### 8.1 Escape priority

| State | Expected Escape action |
| --- | --- |
| approval/dialog open | dialog-specific cancel/close |
| mention open | close mention only |
| command menu open | close command only |
| Inspector open | close Inspector only |
| active Run, no higher layer | interrupt Run |
| idle base layer | no accidental semantic action |

Assert that lower-priority handlers do not also execute.

### 8.2 Enter priority

- command menu Enter selects command, does not submit editor;
- mention Enter inserts candidate, does not submit message;
- normal Composer Enter submits/steers;
- dialog Enter follows dialog semantics where defined.

### 8.3 Tab/arrow/follow-up priority

- Tab mode change only on base Composer/session layer;
- arrow keys stay inside active overlay/Inspector navigation;
- Alt/Option+Enter follow-up never leaks through modal/overlay layers.

## 9. A6 — SessionWorkspace Renderer Tests

Use OpenTUI test renderer where stable.

### 9.1 Structural order

Verify rendered order:

```text
Conversation
Activity when present
Composer
StatusLine
InteractionHints when relevant
```

Inspector placeholder/surface must not permanently consume space while closed.

### 9.2 Width matrix

At minimum test:

- 60 columns;
- 72 columns;
- 100 columns;
- 120 columns;
- 160 columns.

Verify:

- no fixed 80% Composer width leaving unnecessary dead area;
- no primary status words clipped by secondary metadata first;
- overlays stay within terminal width;
- Conversation remains usable;
- Activity remains bounded;
- no permanent side pane on narrow width.

### 9.3 Height matrix

At minimum:

- 18 rows;
- 24 rows;
- 30 rows;
- 40 rows.

Verify Conversation retains a documented minimum useful viewport before
Activity/overlays consume additional rows.

## 10. Scroll and Streaming Regressions

These are critical because the refactor changes subscription ownership.

Test:

- sticky bottom remains pinned when user has not manually scrolled away;
- manual scroll position is not reset by unrelated Activity/Status updates;
- streaming text update does not jump a manually scrolled transcript;
- ToolUse expansion does not unexpectedly reset scroll;
- Activity local clock never changes transcript scroll position;
- terminal resize preserves a valid scroll position.

## 11. Approval and Recovery Presentation Tests

- pending Approval still opens one authoritative interaction surface;
- resolving/cancelling one Approval affects only that transaction;
- dialog close cleanup does not double-cancel;
- Recovery notice appears once for one recovery report key;
- moving presentation effect ownership does not change runtime recovery facts;
- Recovery/Approval UI store slices are disposable and non-durable.

## 12. Session Switching and Lifetime Tests

Mount/switch between Session A and Session B.

Prove:

- each has its own controller/store;
- presentation state does not leak between Sessions;
- Session A activity/approval cannot update Session B after dispose;
- subscriptions are cleaned up;
- no singleton current-session state survives;
- returning to a Session rebuilds UI projections from current authorities rather
  than relying on stale discarded store state.

## 13. Regression Suites That Must Remain Green

At minimum preserve existing coverage for:

- AgentLoop lifecycle;
- Session durable turn;
- local Session authority;
- durable Tool terminal;
- approval broker/Tool Runtime approval;
- branch navigation and Navigation Projection;
- compaction;
- Provider model selection persistence;
- Runtime recovery;
- Usage/Cost/Context observability;
- ToolUse projection/presentation;
- Activity projection/presentation;
- Ctrl+C/exit guard;
- provider/dialog keyboard context.

## 14. Performance / Render-Isolation Evidence

Do not use vague claims such as “feels faster”. Record deterministic test
evidence.

Required counters/observations:

```text
Activity tick:
  activity subscriber/render +1
  conversation +0
  status +0
  composer +0

Status telemetry update:
  status +1
  conversation +0

Editor keystroke:
  composer/editor updates
  activity +0
  status +0
```

Where OpenTUI renderer behavior is difficult to count directly, use the
selector subscription seam plus a small React probe component.

## 15. Native Renderer Stress Check

Because the preceding P0 exposed a Windows Bun/OpenTUI native crash trigger,
final validation must include a best-effort renderer stress loop covering the
new architecture.

At minimum:

- repeated mount/destroy of SessionWorkspace or critical surfaces;
- Activity local elapsed ticks;
- Conversation updates;
- ToolUse rendering;
- terminal dimension changes where the test harness supports them.

A passing stress test is evidence that the refactor did not introduce an
obvious deterministic native-crash trigger. It is not a claim that all Bun or
OpenTUI native defects are eliminated.

## 16. Required Final Commands

Use repository-equivalent commands for:

```text
bun test packages/cli/tests
bun run --filter @more-more-code/harness test
bunx tsc --noEmit -p packages/cli/tsconfig.json
bunx tsc --noEmit -p packages/harness/tsconfig.json
bun run build:cli
git diff --check
```

If Session Store or Runtime Store adapter files are touched, also run the
relevant package test/Prisma validation gates even though no schema change is
allowed.

## 17. Definition of Done

The TEST contract is satisfied only when:

- every architecture unit started with Red focused tests;
- selector isolation is executable, not merely documented;
- controller parity and exactly-once side effects are proven;
- keyboard priority matrix passes;
- Composer behavior parity passes;
- responsive SessionWorkspace renderer tests pass;
- streaming/scroll regressions pass;
- Session lifetime/isolation tests pass;
- full relevant CLI/Harness suites pass;
- typechecks/build pass;
- `git diff --check` passes;
- any non-failing OpenTUI test warnings are recorded explicitly rather than
  mistaken for test coverage.
