# UI Architecture Foundation Delivery Contract

**Delivery state:** Delivered — 2026-08-27. UI-A1 through UI-A7 implemented sequentially and architecture gates passed. A separate Windows Bun/OpenTUI native crash remains reproducible in the live `dev:cli` watch runtime and is recorded below as a runtime limitation; the architecture stress test never claimed to eliminate native runtime defects.

**Date:** 2026-08-27

**Design:** `docs/UI-ARCHITECTURE-FOUNDATION-DESIGN.md`

**Plan:** `docs/UI-ARCHITECTURE-FOUNDATION-PLAN.md`

**Test:** `docs/UI-ARCHITECTURE-FOUNDATION-TEST.md`

**ADR:**
`docs/decisions/0028-ui-application-architecture-and-render-isolation.md`

## 1. Delivery Intent

This document is the required closeout record for UI Slice 1.5.

It is intentionally created before implementation so the next execution stage
has an explicit definition of what must be delivered and what evidence must be
recorded before the architecture refactor can be called complete.

This document now records the implementation and verification evidence for the
completed UI Architecture Foundation. The delivery does **not** claim that all
Windows Bun/OpenTUI native renderer defects are fixed; TEST section 15 defines
the renderer stress loop as best-effort evidence only.

## 2. Business / Engineering Need

The refactor exists because the current UI application layer has accumulated
prototype-era responsibility concentration while the underlying Harness has
already moved to explicit authority/projection boundaries.

Without this stage, the planned Inspector would add more runtime state,
commands, keyboard behavior and diagnostics to already over-broad modules.

The delivery therefore prioritizes architecture stability over visible feature
count.

## 3. Required Deliverables

### D1 — Session UI Store

Deliver a disposable per-Session store with:

- immutable snapshots;
- selector-based subscriptions;
- stable store instance exposure to React;
- independent Conversation/Activity/Status/Composer/Inspector-shell slices;
- lifecycle cleanup;
- no durable persistence.

### D2 — Session Application Controller

Deliver a non-React controller that coordinates current Session actions:

- submit;
- steer;
- follow-up;
- interrupt;
- compact;
- mode/model changes;
- navigation;
- approval resolution/cancel;
- attach/dispose.

The controller must preserve existing durable-first semantics and must not
become a second semantic authority.

### D3 — Surface-specific projection pipeline

Deliver explicit UI-facing seams for:

- Conversation;
- Activity;
- ToolUse;
- Status;
- Composer runtime;
- Approval/Recovery presentation;
- Inspector shell state.

React surfaces must consume projections/store slices rather than raw Harness
objects.

### D4 — Render isolation

Deliver executable proof that:

- Activity elapsed tick does not rerender/notify unrelated surfaces;
- Context/Usage status update does not invalidate Conversation;
- editor typing stays inside Composer;
- Inspector presentation state does not invalidate Conversation;
- no Session-root presentation timer remains.

### D5 — Composer decomposition

Replace the current InputBar responsibility concentration with separate:

- Composer layout;
- Editor;
- Mention model/search/menu;
- Command menu/intents;
- Composer actions;
- StatusLine as a SessionWorkspace surface rather than editor-owned authority
  UI.

Composer must no longer directly own CLI shutdown, Session navigation
semantics, compact authority or Provider/Model authority mutations.

### D6 — Command Intent / Command Router

Deliver typed intent resolution from menu/input selection and one application
execution router.

There must not be parallel old/new execution paths for the same command after
closeout.

### D7 — Interaction Router

Deliver one semantic keyboard precedence model on top of the existing keyboard
layer infrastructure.

At minimum it must resolve dialog, command/mention overlay, Inspector,
Composer, Session runtime and global application priority without double
actions.

### D8 — SessionWorkspace

Deliver explicit primary surfaces:

```text
ConversationPane
ActivityDock
Composer
StatusLine
InteractionHints
InspectorSurface slot/API
```

`Session.tsx` must be reduced toward route/workspace composition rather than
application semantics.

### D9 — Legacy-path removal

Remove superseded normal-path responsibilities from:

- `useChat`;
- `InputBar`;
- `Session.tsx`;
- root prop plumbing;
- distributed semantic keyboard handlers;
- duplicate command execution paths.

Temporary adapters may remain only when explicitly documented with a follow-up
reason and no duplicate authority behavior.

### D10 — Architecture and regression evidence

Record all focused/full tests, typechecks, build, render-isolation counters,
OpenTUI width/height checks and native renderer stress evidence.

## 4. Actual Delivery Report

### 4.1 Actual architecture shipped

The final Session UI path is:

```text
Harness / Local Session / Runtime authority
    -> SessionController
        -> SessionRuntimeBridge + UI projections
            -> per-Session SessionUiStore
                -> selector React adapters
                    -> SessionWorkspace
                        -> ConversationPane
                        -> ActivityDock
                        -> Composer
                        -> StatusLine
                        -> InteractionHints
                        -> InspectorSurface slot
```

Primary modules:

- controller: `packages/cli/src/app/session/session-controller.ts`;
- command router: `packages/cli/src/app/session/session-command-router.ts`;
- store/selectors/React adapter: `packages/cli/src/ui/session/store/*`;
- projection producers: `packages/cli/src/ui/session/projections/session-ui-projections.ts`;
- runtime bridge: `packages/cli/src/ui/session/runtime/session-runtime-bridge.tsx`;
- Composer capabilities: `packages/cli/src/ui/session/composer/*`;
- semantic interaction routing: `packages/cli/src/ui/session/interaction/*`;
- workspace surfaces: `packages/cli/src/ui/session/workspace/*` and
  `packages/cli/src/ui/session/surfaces/*`.

The Inspector surface is intentionally only a shell/slot in this slice. No
Inspector content was implemented early.

### 4.2 Legacy architecture removed

The original normal-path UI orchestration was removed rather than retained in
parallel:

- deleted `packages/cli/src/hooks/use-chat.ts`;
- deleted `packages/cli/src/components/input-bar.tsx`;
- deleted `packages/cli/src/components/session-shell.tsx`;
- deleted the old executable command-menu component/hook path;
- `COMMANDS` is metadata-only; application effects execute through the typed
  Session Command Router;
- `Session.tsx` owns route/session composition and initial-load behavior, not
  ToolUse/Activity/command/keyboard semantics;
- Session runtime Escape handling is isolated under the interaction layer;
- no compatibility adapter remains that can execute a duplicate Session
  submit/command/shutdown side effect.

### 4.3 Authority-boundary confirmation

No bottom-layer semantic contract changed in this delivery:

- Harness Run/Turn/Step semantics: **no change**;
- AgentLoop scheduling: **no change**;
- Runtime Event contracts: **no change**;
- Session Entry kinds: **no change**;
- Session/Runtime Store schemas: **no change**;
- Provider behavior: **no change**;
- Context policy: **no change**;
- Permission/Approval semantics: **no change**;
- Usage/Cost authority: **no change**.

The new store is process-local presentation state and is not a semantic or
durable authority.

### 4.4 Side-effect ordering evidence

Existing and new regressions prove the authority-first/once-only ordering:

- `local-session-durable-turn.test.ts`: user Session commit precedes AgentLoop;
- `local-session-tool-durability.test.ts`: Tool terminal commit precedes
  continuation and failed/deferred commits fail closed;
- `input-bar-model-change.test.ts` (renamed test description to Composer model
  selection): prompt model changes only after authority model change resolves;
- `tool-runtime-approval.test.ts`: approval lifecycle is durable/fail-closed
  before executor invocation;
- `local-session-shutdown.test.ts` and `session-command-router.test.ts`: exit
  preserves quiescence and does not destroy the renderer before shutdown;
- `ui-architecture-closeout.test.ts`: superseded executable command/UI paths
  are absent, preventing duplicate normal-path execution.

### 4.5 Render-isolation evidence

`session-ui-render-isolation.test.tsx` and `session-ui-store.test.ts` provide
executable isolation evidence:

```text
Activity slice update:
  Activity +1
  Conversation +0
  Status +0
  Composer +0

Status slice update:
  Status +1
  Conversation +0
  Activity +0
  Composer +0
```

The one-second elapsed refresh remains inside `ActivityView`; no Session-root
presentation timer was reintroduced.

### 4.6 Responsive/manual evidence

`session-workspace-layout.test.tsx` exercises the required width classes and
representative heights, including 60x20, 72x24, 100x30, 120x30 and 160x40.
Across those sizes the surface order remains Conversation -> Activity ->
Composer -> Status -> Hints and Composer no longer carries the old 80% width.

The same suite manually sets the Conversation ScrollBox to `scrollTop=4`,
updates the Activity sibling, then verifies `scrollTop` remains 4. This proves
an unrelated Activity update does not reset an existing manual transcript
position in the test renderer.

The Inspector placeholder remains closed/empty by design; Inspector content is
deferred to UI Slice 2.

### 4.7 Test/build evidence

Final implementation verification before this delivery closeout:

```text
CLI tests                 250 pass / 0 fail / 824 expect() calls
Harness tests             107 pass / 0 fail / 364 expect() calls
CLI TypeScript            PASS
Harness TypeScript        PASS
CLI production build      PASS
git diff --check          PASS
renderer stress loop      PASS (10 mount/flush/destroy iterations)
```

The renderer stress loop covers Conversation, ToolUse, running Activity and
the 60x20 / 72x24 / 100x30 / 120x30 / 160x40 size set. It uses OpenTUI's test
renderer; TEST section 15 explicitly states that passing this loop does not
prove all Bun/OpenTUI native defects are eliminated.

### 4.8 Known limitations

Known limitations at closeout:

- Unified Inspector content is not implemented; only its surface/state seam is
  present.
- No legacy `useChat` / InputBar / SessionShell normal-path adapter remains.
- React/OpenTUI tests still emit non-failing `act(...)` warnings in existing
  renderer tests; these warnings are not counted as coverage.
- **Windows live runtime limitation:** a real `npm run dev:cli` session on Bun
  1.3.14 can still crash in the native OpenTUI path with a Bun main-thread
  `Segmentation fault` whose crash report contains repeated `opentui.dll`
  frames. The automated test-renderer stress loop does not reproduce this
  production/watch-runtime failure. This is therefore a separate unresolved
  native-runtime defect/reproduction gap, not evidence that the selector/store
  architecture reverted to the old broad Session-root timer design.

## 5. Required Migration Checkpoints

Delivery evidence should identify the implementation commit/checkpoint for:

```text
A1 b85e655  feat(ui-arch): add session ui store contracts
A2 87c6f79  refactor(ui-arch): extract session controller
A3 50c20de  refactor(ui-arch): isolate session projections
A4 0d1826a  refactor(ui-arch): decompose composer capabilities
A5 6d5b323  refactor(ui-arch): centralize commands and interactions
A6 e3a2828  refactor(ui-arch): compose session workspace surfaces
A7 4bde056  refactor(ui-arch): remove legacy session ui paths
```

This ensures a later regression can be bisected to a meaningful architecture
transition.

## 6. Compatibility Requirements

The delivered refactor must preserve current externally visible behavior unless
an intentional UX correction is documented in DESIGN/PLAN before execution.

At minimum preserve:

- local Session open/create/continue;
- message transcript semantics;
- streaming;
- ToolUse status/disclosure;
- Agent Activity;
- steering;
- follow-up;
- interrupt;
- Approval Dialog;
- `/tree` navigation semantics;
- manual compact;
- model/mode authority persistence;
- Context/API/Cache StatusLine information;
- command/mention overlays;
- safe shutdown.

## 7. Explicitly Deferred to Later UI Slices

UI Slice 1.5 does not claim delivery of:

- Tree Inspector content;
- Context Inspector;
- Usage/Cost Inspector;
- Runtime/Recovery Inspector;
- Security Inspector;
- typed Settings forms;
- Session rename/delete;
- final Mode/Agent terminology migration;
- new Agent/Subagent UI;
- new analytics.

It may establish the Inspector shell state/surface contract required for those
features, but not implement their content.

## 8. Delivery Rejection Conditions

Do not mark this stage Delivered if any of the following remains true:

- `useChat` is simply renamed and still owns the same orchestration/UI mix;
- a new global store contains raw runtime authority and becomes a second source
  of truth;
- selectors exist but every update still changes one giant root state object;
- InputBar remains the executor for application commands;
- keyboard semantic precedence remains duplicated across components;
- both old and new command/controller paths can execute one side effect;
- SessionWorkspace is only a renamed SessionShell without responsibility
  separation;
- no render-isolation tests exist;
- Inspector implementation was started before foundation closeout;
- bottom-layer contracts were changed without separate approval;
- tests/build are not fully Green.

## 9. Delivered Current-State Outcome

After successful delivery, the repository should be ready for UI Slice 2 with
this stable direction:

```text
SessionController
    -> projection producers
        -> SessionUiStore
            -> selector adapters
                -> SessionWorkspace
                    -> ConversationPane
                    -> ActivityDock
                    -> Composer
                    -> StatusLine
                    -> InspectorSurface
```

At that point Tree/Context/Usage Inspector work can be added as new projection
and surface slices without expanding a Session-root god hook.
