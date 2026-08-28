# ADR-0028: UI Application Architecture and Render Isolation

## Status

Accepted

## Date

2026-08-27

## Implementation Status

Implemented on 2026-08-27. UI-A1 through UI-A7 delivered the per-Session UI
Store, non-React SessionController, surface-specific projections, decomposed
Composer, typed command/interaction routing, SessionWorkspace composition and
legacy-path removal. The Unified Session Inspector is now unblocked; Inspector
content itself remains a later slice.

## Context

The local-first runtime architecture has matured substantially beyond the
original OpenTUI prototype. Harness and storage layers now have explicit
authority boundaries for:

- Run / Turn / Step lifecycle;
- Session semantic history and navigation;
- Provider execution;
- Context projection and compaction;
- Tool Runtime, permission and approval;
- Runtime recovery;
- Usage, Cost and Cache telemetry.

The UI, however, still concentrates application orchestration and presentation
inside a small number of React modules. At the time of this decision the
largest examples are approximately:

```text
packages/cli/src/hooks/use-chat.ts          1300+ lines
packages/cli/src/components/input-bar.tsx    800+ lines
packages/cli/src/screens/session.tsx         400+ lines
```

`useChat` currently coordinates AgentLoop, local Session authority,
RuntimeSession, Provider-facing transport, Context/Usage observability,
approval, Session Tree navigation, Activity projection, ToolUse projection,
React state and lifecycle effects.

`InputBar` currently mixes the text editor, command menu, file mention search,
keyboard routing, mode/model mutation, Session Tree commands, manual compact,
navigation, dialog/toast access, CLI shutdown, renderer access and StatusBar
presentation.

`Session.tsx` acts simultaneously as route loader, page component,
interaction/controller adapter, approval-dialog coordinator, recovery-toast
coordinator, keyboard handler, navigation adapter and transcript renderer.

This creates four architectural risks.

### 1. Runtime semantics leak upward into React

Although P0 introduced dedicated Activity and ToolUse projections, the root
hook still has broad knowledge of runtime lifecycle and many presentation
concerns. Continuing to add Inspector, Runtime, Security, Context and Usage
surfaces directly to this structure would turn the React layer into a second
runtime coordinator.

### 2. Update frequency and render scope are coupled

The P0 Activity implementation briefly placed a one-second elapsed-time clock
inside `useChat`. That caused the Session root to update once per second merely
to refresh one Activity duration. On OpenTUI, React reconciliation eventually
crosses Bun FFI into native rendering. Even when a native crash is ultimately
owned by Bun/OpenTUI, avoidable broad periodic reconciliation increases native
pressure and makes failure isolation harder.

The immediate timer bug has been fixed by moving the clock into ActivityView,
but the architecture still lacks a general rule preventing future high-rate
state from being attached to Session-root React state.

### 3. Input and interaction responsibilities are centralized by component,
not by capability

Keyboard, command, mention, dialog and lifecycle logic are distributed across
components. `KeyboardLayerProvider` provides a useful layering primitive, but
individual components still decide semantic shortcut behavior themselves.
This becomes increasingly fragile as Inspector, future agent/subagent surfaces,
diff/file views and more overlays are added.

### 4. Product information architecture is ahead of UI state architecture

The approved Runtime Workbench roadmap correctly defines the product surfaces:

```text
Conversation
Activity
Composer / Status
Inspector
  -> Tree
  -> Context
  -> Usage
  -> Runtime
  -> Security
```

But it did not yet define a complete application-controller, UI-store and
subscription architecture underneath those surfaces. Implementing Inspector
before that foundation would multiply the current coupling.

## Decision

Insert a mandatory **UI Slice 1.5 — UI Architecture Foundation** between the
delivered Runtime Activity P0 slice and the planned Inspector slice.

The target flow is:

```text
Harness / Session / Runtime authority
              |
              v
CLI Application Controller / Runtime Adapter
              |
              v
CLI-owned UI Projections / ViewModels
              |
              v
Process-local Session UI Store
              |
              v
Selector-based React adapters
              |
              v
OpenTUI Surfaces
```

The architecture is deliberately downstream-only. It reorganizes CLI
application/UI code without changing Harness semantics or persistence
contracts.

## 1. Separate authority, coordination, projection and presentation state

Every UI-relevant value must belong to exactly one class.

### 1.1 Semantic authority state

Examples:

- Session Entry Tree;
- Agent Run/Turn/Step lifecycle;
- Runtime Usage facts;
- Context authority inputs;
- Tool terminal result;
- permission/approval runtime facts.

These remain owned by existing Harness/Session/Runtime boundaries.

### 1.2 Application coordination state

Examples:

- whether a CLI-owned authority operation is currently being coordinated;
- in-flight durable submit/steer/follow-up transition handles;
- process-local approval transaction wiring;
- route/session attachment lifecycle.

This belongs in non-visual application controllers/adapters, not in view
components.

The controller coordinates existing authorities; it does not become a new
semantic source of truth.

### 1.3 UI projection state

Examples:

- Conversation rows;
- AgentActivityView;
- ToolUseView;
- Status summary;
- Inspector section models.

These are pure/disposable representations derived from authority state.

### 1.4 Presentation-only state

Examples:

- expanded ToolUse;
- expanded Activity Turn;
- selected Inspector section;
- scroll position;
- hover state;
- command/mention overlay selection;
- local elapsed display clock.

These must remain process/device-local UI state and must not create Session
Entries or Runtime Events.

## 2. Introduce a non-React Session Application Controller

The current `useChat` responsibilities must be decomposed incrementally into a
CLI application controller boundary.

Conceptual API:

```ts
interface SessionController {
  attach(): Promise<void>;
  dispose(): Promise<void>;

  submit(input: PromptInput): Promise<void>;
  steer(input: PromptInput): Promise<void>;
  followUp(input: PromptInput): Promise<void>;
  interrupt(): void;

  compact(selection: PromptSelection): Promise<ManualCompactionOutcome>;
  changeMode(mode: ModeType): Promise<void>;
  changeModel(model: ModelRef): Promise<void>;
  navigate(intent: NavigationCommand): Promise<NavigationOutcome>;

  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean;
  cancelApproval(approvalId: string): boolean;
}
```

Exact names may change during implementation, but the boundary rules do not:

- controller code is not a React hook;
- controller methods call existing local authorities;
- controller does not render UI;
- controller does not own a second durable Session/Runtime model;
- controller emits/updates UI-facing projections through a narrow store
  adapter rather than returning dozens of fields to one root hook.

## 3. Introduce a disposable Session UI Store with slice subscriptions

Create one process-local store per mounted Session workspace.

Conceptual shape:

```ts
type SessionUiState = {
  conversation: ConversationView;
  activity: AgentActivityView | null;
  status: SessionStatusView;
  composer: ComposerRuntimeView;
  inspector: InspectorShellView;
  approvals: ApprovalUiView;
};
```

The store must support:

- immutable snapshots;
- `getSnapshot()`;
- subscription;
- selector-based React consumption;
- equality checks that prevent unrelated slice updates from rerendering a
  consumer.

Implementation should prefer a small project-owned external-store adapter
compatible with React `useSyncExternalStore` before adding a new state-library
dependency. A third-party state library requires separate justification.

The store is a **projection cache for presentation**, not authority. It must be
safe to discard and rebuild from current local state.

## 4. Render isolation is a correctness requirement for OpenTUI

The UI must encode update-frequency boundaries explicitly.

Required subscription behavior:

```text
message/assistant stream update -> Conversation subscribers
Run/Turn/Step update            -> Activity subscribers
Usage/Context update            -> Status/Inspector subscribers
composer typing                 -> Composer subtree only
local elapsed tick              -> Activity subtree only
Inspector selection             -> Inspector subtree only
```

Prohibited pattern:

```text
high-frequency timer/event
  -> Session root React state
  -> whole workspace reconciliation
```

No Session-root periodic timer is allowed merely for presentation.

Renderer isolation is not claimed to fix native Bun/OpenTUI defects, but it is
required to minimize unnecessary native reconciliation and make UI behavior
testable and diagnosable.

## 5. Replace `SessionShell` with an explicit SessionWorkspace composition

The target main surface is:

```text
SessionWorkspace
  +- ConversationPane       // only flex-growing transcript surface
  +- ActivityDock           // current execution, bounded height
  +- Composer
  |   +- Editor
  |   +- SuggestionOverlay
  |   +- ComposerActions
  +- StatusLine
  +- InteractionHints       // optional/secondary
  +- InspectorSurface       // responsive overlay/side surface, later slice
```

The Workspace is a layout composition boundary, not a semantic controller.

Conversation remains primary. Activity remains current-execution status rather
than becoming a second historical transcript. Historical Run diagnostics
belong in the later Runtime Inspector.

## 6. Decompose Composer from the current InputBar god component

The target ownership is:

```text
Composer/
  Composer.tsx
  Editor.tsx
  ComposerActions.tsx
  SuggestionOverlay.tsx
  mention/
    mention-model.ts
    mention-search.ts
    MentionMenu.tsx
  command/
    command-intent.ts
    CommandMenu.tsx
```

Composer may own editor-local state and overlay presentation. It must not
directly own:

- CLI renderer shutdown;
- Session navigation semantics;
- local Session authority mutation;
- Provider/Model authority mutation;
- compaction semantics;
- Inspector semantic routing.

Instead, commands resolve to typed **CommandIntent** values.

Example:

```ts
type CommandIntent =
  | { type: "new-session" }
  | { type: "change-mode"; mode: ModeType }
  | { type: "change-model"; model: ModelRef }
  | { type: "open-inspector"; section?: InspectorSection }
  | { type: "compact-context" }
  | { type: "navigate-session"; target: NavigationTarget }
  | { type: "exit" };
```

The application command/controller layer executes the intent.

## 7. Centralize semantic keyboard routing

Keep the existing keyboard-layer stack, but move semantic shortcut resolution
into one Interaction Router.

Conceptual priority:

```text
Dialog
  > command/mention overlay
  > Inspector
  > Composer
  > Session runtime shortcuts
  > application/global shortcuts
```

For example Escape is resolved once according to the active interaction layer:

```text
Dialog open        -> close/cancel dialog transaction
Mention open       -> close mention
Command open       -> close command menu
Inspector open     -> close inspector
Run active         -> interrupt Run
Otherwise          -> no semantic Session action
```

Components may register local handlers, but they must not independently invent
conflicting application shortcut precedence.

## 8. Keep projections CLI-owned and surface-specific

The P0 rule remains mandatory:

```text
authority -> pure CLI projection -> UI store -> component
```

React components must not traverse raw Harness objects to rediscover semantic
status.

Expected projection families after the foundation:

- ConversationProjection;
- AgentActivityProjection;
- ToolUseProjection;
- SessionStatusProjection;
- ComposerRuntimeProjection where runtime state is needed;
- later Inspector projections for Tree/Context/Usage/Runtime/Security.

No giant `SessionViewModel` should be introduced that recreates the same
monolithic update problem at a different layer.

## 9. Inspector implementation is blocked until this foundation is delivered

The Workbench product design remains approved, but Inspector is reordered:

```text
UI Slice 1   Runtime Activity Foundation       delivered
UI Slice 1.5 UI Architecture Foundation        next
UI Slice 2   Inspector + Context/Usage/Tree     blocked by 1.5
UI Slice 3   Runtime/Security Inspector
UI Slice 4   Settings/Sessions/Polish
```

This is not a cancellation of Inspector. It prevents Inspector from being
built into the current monolithic React ownership model.

## 10. Migration must be incremental, not a big-bang rewrite

The implementation phase must preserve working behavior while moving one
responsibility at a time behind the new seams.

Required migration order is defined in
`docs/UI-ARCHITECTURE-FOUNDATION-PLAN.md`.

At every migration checkpoint:

- existing Session authority remains usable;
- no parallel durable authority is created;
- migrated behavior has focused tests before legacy wiring is removed;
- old and new implementations must not both execute one side effect;
- legacy code is deleted only after the new seam owns the path.

## 11. Bottom-layer architecture remains frozen

UI Architecture Foundation must not silently introduce:

- new Harness semantic state;
- new AgentLoop scheduling semantics;
- new Runtime Event field/type;
- new Session Entry kind;
- Session/Runtime Store schema migration;
- Provider request change;
- Context/Compaction policy change;
- Permission/Approval semantic change;
- Usage/Cost authority change.

If a UI migration appears to require one of those changes, implementation must
stop and escalate through a separate architecture decision.

## Consequences

### Positive

- UI capabilities can grow without expanding one root hook indefinitely.
- High-frequency updates can be isolated to the smallest OpenTUI surface.
- Inspector can be added on a stable state/subscription architecture.
- Composer, commands and keyboard semantics become testable independently.
- React components become presentation consumers rather than runtime
  coordinators.
- UI projection state becomes explicitly disposable and non-authoritative.

### Costs

- The next UI stage is primarily architectural refactoring rather than visible
  feature growth.
- During migration some legacy adapters will temporarily coexist with new
  controllers/stores.
- More small modules and contracts will replace fewer large files.
- The migration requires strong regression coverage to prove side effects are
  still executed exactly once.

### Risks

- A careless controller extraction could duplicate AgentLoop or Session write
  execution.
- A poorly designed store could become another global mutable authority.
- Over-generalizing the Interaction Router could make simple local UI behavior
  unnecessarily abstract.
- Moving too much in one commit could make regressions difficult to localize.

These risks are controlled by the staged plan, selector/isolation tests and
the explicit rule that the UI store is disposable derived state only.

## Rejected Alternatives

### Continue directly with Inspector on the current structure

Rejected. It would add more subscriptions, dialogs and projection wiring to
already over-broad `useChat`, `Session.tsx` and `InputBar` responsibilities.

### Rewrite the entire CLI UI in one branch

Rejected. The runtime is already functional and heavily tested. A big-bang
rewrite would make authority/order regressions hard to isolate and would
violate the project's staged-delivery discipline.

### Move AgentLoop or Session authority into a React store

Rejected. React/UI state is not semantic runtime authority. The existing
Harness/Session/Runtime boundaries remain canonical.

### Persist UI store state into Session history

Rejected. Expansion, active tab, scroll and similar view state are not semantic
conversation facts.

### Add a broad third-party state framework first

Rejected as the default. The required contract is small enough to establish
with a project-owned external store plus `useSyncExternalStore`. A dependency
may be proposed later only if measured complexity justifies it.

## References

- `docs/UI-RUNTIME-WORKBENCH-ROADMAP.md`
- `docs/UI-RUNTIME-ACTIVITY-DESIGN.md`
- `docs/UI-ARCHITECTURE-FOUNDATION-DESIGN.md`
- `docs/UI-ARCHITECTURE-FOUNDATION-PLAN.md`
- `docs/UI-ARCHITECTURE-FOUNDATION-TEST.md`
- `docs/UI-ARCHITECTURE-FOUNDATION-DELIVERY.md`
