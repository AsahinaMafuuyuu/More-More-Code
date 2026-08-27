# UI Architecture Foundation Implementation Plan

**Status:** Approved execution plan — implementation not started.

**Date:** 2026-08-27

**Design:** `docs/UI-ARCHITECTURE-FOUNDATION-DESIGN.md`

**ADR:**
`docs/decisions/0028-ui-application-architecture-and-render-isolation.md`

**Test contract:** `docs/UI-ARCHITECTURE-FOUNDATION-TEST.md`

**Delivery contract:** `docs/UI-ARCHITECTURE-FOUNDATION-DELIVERY.md`

## 1. Execution Rule

This stage is intentionally large, but it must **not** be implemented as one
monolithic rewrite.

Execute architecture units in order:

```text
A1 UI Store Contracts
  -> A2 Session Controller Extraction
  -> A3 Projection + Subscription Migration
  -> A4 Composer Decomposition
  -> A5 Command + Interaction Routing
  -> A6 SessionWorkspace Composition
  -> A7 Legacy Removal + Architecture Closeout
```

Each unit follows:

```text
read DESIGN/TEST again
-> write Red focused tests
-> implement only the current unit
-> run focused tests/typecheck
-> review authority/render boundaries
-> update task evidence
-> commit the unit
-> continue
```

Do not combine later units early merely because a file is already open.

## 2. Stage Branch and Commit Discipline

Implementation should start from the completed planning commit on a dedicated
implementation branch, for example:

```text
stage/6.5-ui-architecture-foundation
```

Recommended commits:

```text
feat(ui-arch): add session ui store contracts
refactor(ui-arch): extract session controller
refactor(ui-arch): isolate projection subscriptions
refactor(ui-arch): decompose composer
refactor(ui-arch): centralize commands and interactions
refactor(ui-arch): compose session workspace surfaces
docs(ui-arch): close architecture foundation delivery
```

Exact commit count may vary, but there must be enough checkpoints to isolate a
regression to one migration unit.

Do not include unrelated pre-existing workspace changes.

## 3. Pre-Implementation Baseline

Before A1:

- verify the working tree contains only intended stage changes;
- record current branch and base commit;
- run current CLI full tests;
- run Harness tests;
- run CLI/Harness typecheck;
- run CLI build;
- record current approximate module sizes of `use-chat.ts`, `session.tsx` and
  `input-bar.tsx` for delivery comparison;
- confirm the Runtime Activity native-crash mitigation remains present: no
  Session-root one-second Activity timer.

Do not treat line-count reduction as the goal. It is only supporting evidence
that responsibilities actually moved.

## 4. Architecture Unit A1 — Session UI Store Contracts

### Goal

Create the disposable per-Session UI state boundary and selector-based React
subscription seam without changing runtime behavior.

### Required work

1. Define `SessionUiState` slices.
2. Implement a small external store with immutable snapshot semantics.
3. Implement `subscribe`, `getSnapshot`, lifecycle `destroy` and narrow update
   helpers.
4. Add selector/equality React adapter using `useSyncExternalStore` or the
   equivalent supported React 19 seam.
5. Define initial selectors for:
   - conversation;
   - activity;
   - status;
   - composer runtime;
   - approval/recovery;
   - Inspector shell state.
6. Add a context/provider that exposes the stable store **instance**, not the
   changing entire state object.

### Must not do

- move AgentLoop into the store;
- put Session Tree authority into the store as canonical state;
- persist UI store state;
- add a global singleton `currentSessionStore`;
- add a third-party state framework without a separate decision.

### Acceptance

- changing one slice notifies only subscribers whose selected value changes;
- store snapshots cannot be mutated accidentally by consumers;
- two stores can coexist in tests without state leakage;
- destroying one store prevents later updates/listener leaks;
- no production behavior changes yet.

### Gate

A2 cannot start until store selector-isolation tests are Green.

## 5. Architecture Unit A2 — Session Application Controller Extraction

### Goal

Move application coordination out of React while preserving all existing
authority and side-effect ordering.

### Extraction order

Move the narrowest stable behaviors first:

1. interrupt;
2. prompt selection / mode-model authority transition;
3. manual compact;
4. navigation;
5. approval resolution/cancel;
6. submit / steer / follow-up lifecycle;
7. attach/dispose coordination.

The more side-effect-sensitive submit/Tool/model path should move only after
the controller contract is proven with simpler actions.

### Controller dependencies

The controller may receive explicit existing dependencies such as:

- LocalSessionAuthority;
- RuntimeSession;
- AgentLoop;
- LocalModelTransport factory/adapter;
- ApprovalBroker;
- current environment services.

Dependencies must be injected or constructed through existing environment
seams so tests can use fakes without React.

### Compatibility adapter

During migration, a thin `useSessionController`/legacy adapter may bridge the
controller to existing React code.

It must remain thin and temporary. It must not become a renamed `useChat`.

### Side-effect invariants to prove

- durable user intent before model/tool side effects;
- model change visible after commit succeeds;
- Tool terminal durability ordering unchanged;
- approval allow durability ordering unchanged;
- interrupt semantics unchanged;
- teardown/quiescence unchanged;
- Provider completion is not retried because a UI/store update fails.

### Gate

A3 cannot start until controller-focused tests prove semantic parity for every
migrated command path.

## 6. Architecture Unit A3 — Projection and Subscription Migration

### Goal

Route runtime/controller outputs into surface-specific projections and Session
UI Store slices, then migrate React surfaces from root-prop fanout to selectors.

### Migration order

#### A3.1 Activity

- write Activity projection into activity slice;
- `ActivityDock`/existing ActivityView subscribes directly;
- keep local elapsed timer inside Activity surface;
- prove Activity tick does not notify Conversation/Status/Composer selectors.

#### A3.2 Status

- introduce `SessionStatusView` projection;
- compose mode/model/Context/API/Cache presentation upstream;
- StatusLine subscribes directly;
- Context/Usage telemetry update must not rerender Conversation.

#### A3.3 Composer runtime

- introduce `ComposerRuntimeView`;
- expose disabled/runActive/canInterrupt/submit mode/follow-up availability;
- Composer must not receive raw AgentRun.

#### A3.4 Conversation

- create/standardize Conversation projection;
- ToolUse map/correlation stays inside conversation-related projection path;
- ConversationPane subscribes directly;
- Activity/Status changes must not invalidate message components.

#### A3.5 Approval / Recovery presentation

- publish narrow UI views;
- move Session-level effects toward dedicated presentation adapters;
- do not change Approval Broker or Runtime recovery semantics.

### Gate

A4 cannot start until integration tests demonstrate independent surface
updates with render counters/subscription counters.

## 7. Architecture Unit A4 — Composer Decomposition

### Goal

Replace the current 800-line InputBar responsibility concentration with
capability-focused Composer modules while preserving exact interaction
behavior.

### Required decomposition

1. `Composer`
   - layout/composition;
   - subscribes only to Composer runtime/status needs.

2. `Editor`
   - text/cursor/textarea lifecycle;
   - submit/newline behavior;
   - no application command semantics.

3. Mention model/search
   - extract `findActiveMention` and path matching into pure/testable modules;
   - retain current workspace containment rules;
   - mention candidate async lifecycle isolated to mention subsystem.

4. Mention menu
   - local selection/scroll/rendering only.

5. Command menu
   - search/selection/rendering;
   - returns typed CommandIntent rather than invoking application dependencies.

6. StatusLine
   - no longer physically embedded inside the editor surface if that causes
     Composer ownership coupling;
   - becomes a SessionWorkspace sibling surface.

### Required behavior parity

- Enter submit/steer;
- Shift+Enter newline;
- Alt/Option+Enter follow-up;
- `@file` discovery and insertion;
- slash command search/navigation;
- mode/model changes;
- manual compact entry;
- dialogs/toasts as currently expected;
- input disabled/settling behavior;
- existing focus behavior.

### Gate

A5 cannot start until Composer integration tests show parity and InputBar no
longer owns renderer shutdown, navigation semantics or authority execution.

## 8. Architecture Unit A5 — Command Intent and Interaction Router

### Goal

Centralize application command execution and semantic keyboard precedence.

### A5.1 Command Intent

Define typed intents covering current command actions. Map existing slash
commands to intents.

Command menu should be able to render/search/select without receiving:

- renderer;
- Session authority;
- AgentLoop;
- RuntimeSession;
- navigation implementation;
- compact implementation.

### A5.2 Session Command Router

Route intents to:

- SessionController;
- navigation/router actions;
- dialog/toast presentation services;
- application shutdown coordinator.

Exit/quiescence behavior must preserve current safe teardown semantics.

### A5.3 Interaction Router

Implement one semantic priority table on top of current KeyboardLayerProvider.

Required priority:

```text
Dialog
> transient overlay
> Inspector
> Composer
> Session runtime
> global application
```

### Required regressions

- Escape performs exactly one action;
- overlay arrows/Enter do not leak;
- Tab mode shortcut respects higher layers;
- follow-up shortcut does not fire in dialogs/menus;
- Inspector open/close behavior can later plug into the same router;
- Ctrl+C/exit safety remains compatible with current product rules.

### Gate

A6 cannot start until existing keyboard and command behaviors are represented
through the new routing contracts with focused tests.

## 9. Architecture Unit A6 — SessionWorkspace Composition

### Goal

Make the page structure reflect explicit surfaces and reduce `Session.tsx` to
route/workspace composition.

### Target hierarchy

```text
SessionWorkspace
  ConversationPane
  ActivityDock
  Composer
  StatusLine
  InteractionHints
  InspectorSurface placeholder/API
```

### Required work

- replace or retire generic SessionShell responsibilities;
- move StatusLine out of Composer ownership;
- remove arbitrary Composer `width="80%"` as a structural default;
- specify responsive width classes and height caps;
- preserve sticky conversation scrolling;
- preserve Activity bounded height;
- establish Inspector shell slot/state API without implementing P1 Inspector
  content;
- move route-independent approval/recovery presentation effects out of
  `Session.tsx` where practical.

### Target `Session.tsx`

After A6, Session screen should primarily:

```text
resolve route/session
mount Session application/runtime provider
render SessionWorkspace
handle route-level load/not-found failures
```

### Gate

A7 cannot start until narrow/medium/wide renderer tests and current Session
behavior regressions pass.

## 10. Architecture Unit A7 — Legacy Removal and Closeout

### Goal

Remove superseded compatibility wiring, prove no duplicate side effects exist,
and establish the new architecture as the only normal Session path.

### Required cleanup

- delete or drastically shrink the legacy `useChat` orchestration hook;
- delete superseded InputBar application logic;
- remove root prop plumbing replaced by store selectors;
- remove duplicate command execution paths;
- remove duplicate keyboard semantic handlers;
- remove stale compatibility adapters that would allow both old/new paths to
  execute;
- update module names/imports to match final ownership;
- ensure there is no hidden global current-session state.

### Architecture audit

Review final code against ADR-0028 and record:

- authority owners;
- controller responsibilities;
- UI store slices;
- projection ownership;
- React subscription boundaries;
- local high-frequency timers;
- keyboard/command routing;
- remaining intentionally deferred adapters.

### Final gate

Only after A7 is fully Green may UI Slice 2 Inspector implementation begin.

## 11. Required Test Cadence

After each architecture unit:

```text
focused new tests
relevant existing CLI tests
CLI typecheck
git diff --check
```

At A3, A5, A6 and final A7 also run renderer-focused OpenTUI tests.

At final A7 run:

```text
full packages/cli/tests
full @more-more-code/harness tests
CLI TypeScript typecheck
Harness TypeScript typecheck
CLI production build
git diff --check
```

If controller extraction touches Session Store/Runtime Store adapters, also run
their relevant package tests even though their contracts must remain unchanged.

## 12. Render-Isolation Verification Plan

The stage must provide executable proof for these cases:

```text
Activity elapsed tick
  -> Activity render/subscriber changes
  -> parent SessionWorkspace does not rerender because of the tick
  -> Conversation/Composer/Status selectors unchanged

Context/Usage update
  -> Status changes
  -> Conversation selector unchanged

editor typing
  -> Composer local render
  -> Activity/Conversation selectors unchanged

Tool terminal update
  -> matching Conversation/ToolUse path changes
  -> unrelated Inspector/Status state unchanged except where explicitly sourced
```

Use render counters/subscription counters in tests rather than subjective
performance claims.

## 13. Manual OpenTUI Verification Matrix

Record at least:

| Width | Height | Required check |
| ---: | ---: | --- |
| 60 | 20 | narrow conversation/composer remains usable |
| 72 | 24 | width transition does not overflow |
| 100 | 30 | standard Session workspace hierarchy |
| 120 | 30 | wide layout remains conversation-first |
| 160 | 40 | Inspector slot/open state does not distort primary flow |

Also manually exercise:

- long assistant stream;
- multiple ToolUse rows;
- active Activity elapsed clock for several minutes;
- command menu;
- mention menu;
- approval dialog;
- steering/follow-up;
- Escape interrupt;
- terminal resize while Run is active;
- user manual scroll while messages continue streaming.

## 14. Failure Handling During Migration

If a unit uncovers a requirement for new bottom-layer semantics:

1. stop the unit;
2. do not add the field/event/schema opportunistically;
3. record the missing seam in DELIVERY/plan notes;
4. create a separate architecture discussion/ADR if required;
5. continue only after explicit approval.

If a unit creates duplicate side effects or cannot prove ordering parity, roll
back the incomplete unit rather than keeping both paths active.

## 15. Completion Criteria for the Next Agent

The next implementation agent must not mark this stage complete merely because
files were split.

Completion requires:

- behavioral parity;
- explicit controller boundary;
- selector-based store isolation;
- Composer responsibility cleanup;
- centralized semantic interaction routing;
- explicit SessionWorkspace surfaces;
- removal of superseded execution paths;
- render-isolation evidence;
- full regression evidence;
- updated DELIVERY with actual—not planned—results.
