# UI Architecture Foundation Delivery Contract

**Delivery state:** Planned — architecture approved, implementation not started.

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

The current document describes **planned deliverables only**. It must not be
changed to `Delivered` until implementation, verification and architecture
review are complete.

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

## 4. Required Delivery Report Structure

When implementation finishes, replace/extend this section with actual results
under the following headings.

### 4.1 Actual architecture shipped

Record:

- final controller module(s);
- final store module(s);
- final projection module(s);
- final React adapter(s);
- final surface/component hierarchy;
- any naming differences from DESIGN and why.

### 4.2 Legacy architecture removed

Record:

- responsibilities removed from `useChat`;
- responsibilities removed from `InputBar`;
- responsibilities removed from `Session.tsx`;
- old modules deleted;
- compatibility adapters intentionally retained.

Do not report line-count reduction as the primary success metric. Report
ownership changes.

### 4.3 Authority-boundary confirmation

Explicitly state whether the delivery changed any of:

- Harness Run/Turn/Step semantics;
- AgentLoop scheduling;
- Runtime Event contracts;
- Session Entry kinds;
- Session/Runtime Store schemas;
- Provider behavior;
- Context policy;
- Permission/Approval semantics;
- Usage/Cost authority.

Expected result for this stage: **no**.

If any answer is yes, this DELIVERY cannot be closed under ADR-0028 without a
separate approved architecture decision.

### 4.4 Side-effect ordering evidence

Record tests proving:

- durable submit ordering;
- Tool terminal ordering;
- model/mode authority ordering;
- approval ordering;
- shutdown/quiescence ordering;
- no duplicate execution from compatibility paths.

### 4.5 Render-isolation evidence

Record concrete counters such as:

```text
Activity elapsed tick:
  Activity subscriber/render: +1
  Conversation: +0
  Status: +0
  Composer: +0

Context/Usage status update:
  Status: +1
  Conversation: +0
```

Exact numbers may differ if one operation legitimately affects more than one
projection. Any cross-surface notification must be justified by shared source
semantics, not convenience.

### 4.6 Responsive/manual evidence

Record manual checks for at least:

- 60x20;
- 72x24;
- 100x30;
- 120x30;
- 160x40.

For each, record:

- Conversation usability;
- Activity behavior;
- Composer width/focus;
- StatusLine truncation;
- overlay bounds;
- Inspector closed/open placeholder behavior if implemented;
- no unexpected scroll jumps.

### 4.7 Test/build evidence

Record exact final counts for:

- architecture-focused tests;
- full CLI tests;
- Harness tests;
- any Session Store/Runtime Store suites touched;
- CLI typecheck;
- Harness typecheck;
- CLI production build;
- `git diff --check`;
- renderer stress loop.

### 4.8 Known limitations

Record any intentional deferrals, including:

- Inspector content not yet implemented;
- remaining legacy adapter;
- OpenTUI native limitations;
- keyboard edge cases deferred;
- measured render paths not yet isolated.

No limitation should be hidden merely to mark the stage complete.

## 5. Required Migration Checkpoints

Delivery evidence should identify the implementation commit/checkpoint for:

```text
A1 UI Store
A2 Session Controller
A3 Projection/Subscription Migration
A4 Composer Decomposition
A5 Command/Interaction Router
A6 SessionWorkspace
A7 Legacy Removal/Closeout
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

## 9. Planned Current-State Outcome

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
