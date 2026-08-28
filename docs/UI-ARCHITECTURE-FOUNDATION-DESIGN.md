# UI Architecture Foundation Design

**Status:** Implemented — UI Architecture Foundation delivered 2026-08-27.

**Date:** 2026-08-27

**Roadmap position:** UI Slice 1.5, between delivered Runtime Activity P0 and
the Unified Session Inspector.

**Architecture decision:**
`docs/decisions/0028-ui-application-architecture-and-render-isolation.md`

**Execution plan:** `docs/UI-ARCHITECTURE-FOUNDATION-PLAN.md`

**Test contract:** `docs/UI-ARCHITECTURE-FOUNDATION-TEST.md`

**Delivery contract:** `docs/UI-ARCHITECTURE-FOUNDATION-DELIVERY.md`

## 1. Purpose

This stage restructures the CLI UI architecture before additional large UI
features are added.

The goal is not a cosmetic rewrite. The goal is to make the presentation layer
match the maturity of the current local-first Harness architecture.

The current runtime is already organized around explicit authorities and
projections. The UI still has prototype-era concentration of concerns in a
few React modules. If Inspector, Runtime, Security, Context and Usage surfaces
are added directly to that structure, the UI will become harder to reason
about, harder to test and increasingly sensitive to broad OpenTUI rerenders.

This design therefore introduces a stable application/UI boundary:

```text
Runtime / Session / Harness authority
              |
              v
Application Controller
              |
              v
UI Projection / ViewModel
              |
              v
Session UI Store
              |
              v
Selector React Adapter
              |
              v
OpenTUI Surface
```

## 2. Current Baseline and Structural Problems

At planning time the main Session UI is concentrated in:

```text
use-chat.ts       1300+ lines
input-bar.tsx      800+ lines
session.tsx        400+ lines
session-shell.tsx  ~100 lines
```

The problem is not line count alone. It is ownership.

### 2.1 `useChat` currently owns too many layers

It currently coordinates or exposes:

- AgentLoop lifecycle;
- local Session authority;
- RuntimeSession;
- LocalModelTransport;
- durable submit/steer/follow-up;
- Session Tree navigation;
- mode/model transitions;
- Context observability;
- Usage/Cost observability;
- Approval Broker state;
- runtime recovery;
- Activity projection;
- ToolUse projection;
- React state/effects.

That makes the root Session hook both application orchestrator and UI adapter.

### 2.2 `Session.tsx` is both screen and controller

It currently owns:

- route/session loading;
- initial-prompt submission;
- recovery toast emission;
- approval dialog coordination;
- Escape interrupt;
- Session navigation command adapter;
- prompt runtime restore;
- submit/steer/follow-up dispatch;
- message rendering.

The screen therefore has to understand multiple authority semantics just to
compose the page.

### 2.3 `InputBar` is not a composer-only component

It currently owns:

- textarea behavior;
- file-mention discovery/search;
- command-menu selection;
- command execution;
- keyboard routing;
- mode/model authority changes;
- Session Tree command access;
- manual compact;
- navigation;
- dialogs/toasts;
- CLI shutdown and renderer destroy;
- StatusBar rendering.

This makes the input component an application shell hidden inside a form.

### 2.4 Update scope is implicit

Before the Runtime Activity hotfix, a one-second Activity clock in `useChat`
caused Session-root reconciliation every second. That exact timer has been
fixed, but no architectural mechanism currently prevents the same class of
problem from returning through Context polling, Inspector animation, future
subagent progress, background diagnostics or other high-frequency state.

For OpenTUI, this matters more than ordinary DOM React because reconciliation
eventually crosses Bun FFI into a native renderer.

### 2.5 Product surfaces exist without a complete state architecture

The Runtime Workbench information architecture is already sound:

```text
Conversation
Activity
Composer + Status
Inspector
```

The missing layer is how each surface receives and updates its state without
making `Session` the subscription point for everything.

## 3. Design Principles

### Principle A — authority stays below UI

Session Entry Tree, AgentLoop, Runtime Events, Provider execution, Permission,
Context and Usage remain owned by current non-UI layers.

### Principle B — controller coordinates, it does not become authority

The Session Application Controller calls existing authority APIs and manages
application lifecycle. It does not invent semantic history.

### Principle C — projections are surface-specific

Do not replace `useChat` with one giant `SessionViewModel` object.

Each surface should receive the smallest already-interpreted model it needs.

### Principle D — UI store is disposable

The Session UI Store is derived process-local state. It can be recreated from
current authority state after navigation, restart or test setup.

### Principle E — high-frequency updates stay local

No presentation-only timer or progress update may require Session-root React
state.

### Principle F — components emit intents, not authority operations

Composer/menu/keyboard components express user intent. Application/controller
code performs durable changes or runtime side effects.

### Principle G — migration is incremental

The stage is large, but implementation must still be split into independently
testable checkpoints.

## 4. Target Package Structure

The exact file names may vary slightly, but the responsibility layout must
converge toward the following structure.

```text
packages/cli/src/
  app/
    session/
      session-controller.ts
      session-controller-types.ts
      session-command-router.ts
      session-lifecycle.ts

  ui/
    session/
      store/
        session-ui-store.ts
        session-ui-selectors.ts
        react-session-ui.ts

      projections/
        conversation-projection.ts
        status-projection.ts
        composer-runtime-projection.ts
        agent-activity-projection.ts     // may move/re-export existing module
        tool-use-projection.ts           // may move/re-export existing module

      workspace/
        session-workspace.tsx
        conversation-pane.tsx
        activity-dock.tsx
        status-line.tsx
        interaction-hints.tsx

      composer/
        composer.tsx
        editor.tsx
        composer-actions.tsx
        suggestion-overlay.tsx
        mention/
          mention-model.ts
          mention-search.ts
          mention-menu.tsx
        command/
          command-intent.ts
          command-menu.tsx

      interaction/
        interaction-router.ts
        interaction-types.ts
        use-interaction-router.ts

  screens/
    session.tsx                         // route/page composition only
```

The migration does not require moving every existing file immediately. It
requires these ownership seams to become true before legacy files are deleted.

## 5. Session Application Controller

### 5.1 Responsibility

The controller is the process-local application coordinator for one mounted
Session workspace.

It owns coordination of existing capabilities such as:

- attach/open current runtime context;
- submit;
- steer;
- follow-up;
- interrupt;
- manual compact;
- mode/model changes;
- Session navigation;
- approval resolution;
- teardown/quiescence.

It may own refs/queues necessary to serialize those application operations,
provided existing semantic authorities remain canonical.

### 5.2 It must not own

- a duplicate Session Tree;
- a second AgentRun state machine;
- Provider business semantics;
- Tool terminal truth;
- permission rules;
- durable Usage aggregation;
- Context policy;
- React component state;
- dialog rendering;
- keyboard shortcut precedence.

### 5.3 Lifecycle

Conceptually:

```text
route resolves Session
  -> create SessionController
  -> controller.attach()
  -> hydrate UI store from current authorities
  -> React workspace subscribes to slices

route changes/unmount
  -> controller.dispose()
  -> cancel process-local approvals
  -> interrupt/await existing required quiescence semantics
  -> dispose UI store
```

Controller disposal must reuse existing shutdown/idle guarantees rather than
inventing a second teardown path.

## 6. Session UI Store

### 6.1 Why an external store

The store exists to separate update producers from React tree ownership.

It should allow:

```text
activity update
  -> activity slice changes
  -> ActivityDock subscriber rerenders
  -> ConversationPane does not rerender
```

React context may provide the store instance, but the entire state object must
not be passed as one context value that changes on every update.

### 6.2 Required store contract

At minimum:

```ts
interface SessionUiStore {
  getSnapshot(): SessionUiState;
  subscribe(listener: () => void): () => void;
  update(mutator: SessionUiUpdater): void;
  destroy(): void;
}
```

React adapters should use selector-based subscriptions, conceptually:

```ts
useSessionUiSelector(selectConversation)
useSessionUiSelector(selectActivity)
useSessionUiSelector(selectStatus)
useSessionUiSelector(selectComposerRuntime)
useSessionUiSelector(selectInspector)
```

Selector equality must prevent notification-derived rerenders when selected
state is unchanged.

### 6.3 Initial slices

The foundation should support at least:

```ts
type SessionUiState = {
  conversation: ConversationView;
  activity: AgentActivityView | null;
  status: SessionStatusView;
  composerRuntime: ComposerRuntimeView;
  approval: ApprovalUiView | null;
  recovery: RecoveryUiView | null;
  inspector: InspectorShellState; // shell state only; detailed sections later
};
```

Inspector state may initially contain only open/closed/section selection so the
foundation can establish its ownership without implementing Inspector content.

### 6.4 Mutation restrictions

Only adapter/controller/projection integration code may write derived runtime
slices.

Components may mutate presentation-only UI fields through explicit actions,
for example:

- select Inspector tab;
- toggle local surface visibility;
- close/open Inspector.

Components must not write semantic runtime state into the UI store.

## 7. Projection Architecture

### 7.1 Conversation projection

Conversation should expose already-renderable message rows or message-level
presentation models, not the entire Session Tree.

Requirements:

- preserve message order;
- preserve finalized assistant semantics from ADR-0026;
- attach ToolUse projections by stable Tool call identity;
- support incremental update without reconstructing unrelated runtime views.

### 7.2 Activity projection

Keep existing AgentActivityProjection semantics.

The local elapsed clock stays inside Activity presentation and must never move
back to Session-root state.

### 7.3 ToolUse projection

Keep canonical terminal precedence and historical fail-closed semantics.

ToolUse should be consumed by Conversation-related subscribers only.

### 7.4 Status projection

Create a dedicated SessionStatusView composed from:

- current mode;
- current model;
- SessionObservability summary;
- current runtime interaction state needed for compact status.

StatusLine should not read PromptConfig plus Observability through multiple
unrelated contexts if one CLI projection can provide a stable view.

### 7.5 Composer runtime projection

Composer should receive only interaction facts needed to decide UI affordance:

```ts
type ComposerRuntimeView = {
  disabled: boolean;
  runActive: boolean;
  canInterrupt: boolean;
  submitMode: "submit" | "steer";
  followUpAvailable: boolean;
};
```

It should not receive raw `AgentRun`.

## 8. Render-Isolation Contract

### 8.1 Required update domains

| Update source | Allowed primary consumers |
| --- | --- |
| assistant streaming text | ConversationPane / active message |
| ToolUse status | matching ToolUse / ConversationPane |
| Run/Turn/Step lifecycle | ActivityDock; Composer runtime status when necessary |
| local elapsed tick | ActivityDock only |
| Context/Usage/Cost update | StatusLine; later relevant Inspector section |
| editor typing | Composer subtree only |
| mention candidate update | Mention overlay only |
| command selection | Command overlay only |
| Inspector tab/filter | Inspector only |
| terminal resize | layout/surface components that depend on dimensions |

### 8.2 Forbidden broad update patterns

- Session root owns a ticking clock;
- Session root owns editor text;
- Session root owns mention search results;
- Session root owns ToolUse expansion;
- one giant context value contains every Session UI slice;
- Inspector polling invalidates Conversation;
- status telemetry update rebuilds message components.

### 8.3 React memoization is not the primary boundary

`memo()` may be used after store/subscription boundaries are correct, but the
architecture must not depend on pervasive memoization to compensate for one
root state object changing constantly.

## 9. SessionWorkspace Design

### 9.1 Main hierarchy

```text
SessionWorkspace
  ConversationPane     flexGrow=1
  ActivityDock         bounded, conditional
  Composer             bounded
  StatusLine           one-line compact state
  InteractionHints     secondary
```

### 9.2 ConversationPane

Responsibilities:

- transcript scrolling;
- message rendering;
- ToolUse disclosure embedded in messages;
- maintaining sticky-bottom vs user-manual-scroll behavior.

It does not own runtime commands.

### 9.3 ActivityDock

Responsibilities:

- current Run visibility;
- current/latest Turn and Step summary;
- failed/interrupted current Run visibility;
- local elapsed display;
- local disclosure only.

It is not historical execution storage.

### 9.4 Composer

Responsibilities:

- editor text;
- submit/follow-up intent emission;
- local overlays;
- local selection state;
- accessibility/focus for the editor.

Authority-changing actions are emitted as intents.

### 9.5 StatusLine

StatusLine remains compact. Deep Context/Usage information belongs in later
Inspector sections.

### 9.6 InteractionHints

Hints are derived from active interaction context and should disappear or
change when irrelevant. They must not imply incorrect semantics such as
calling Plan/Build separate agents.

## 10. Responsive Terminal Architecture

The foundation must establish stable behavior at three width classes.

### Narrow `<72`

- no permanent Inspector side pane;
- Conversation remains primary;
- Activity is compact;
- Composer fills available width rather than retaining arbitrary fixed 80%;
- StatusLine may elide secondary fields deterministically;
- overlays stay within terminal bounds.

### Medium `72-119`

- normal Conversation/Activity/Composer stack;
- Inspector later opens as overlay/full-width surface unless enough width is
  explicitly available;
- StatusLine retains core model/context/cost/cache summary.

### Wide `>=120`

- foundation may reserve a responsive Inspector slot API, but this stage does
  not need to implement Inspector content;
- no permanent side pane is shown unless Inspector is actually open;
- Conversation retains a useful minimum width.

Height must also be treated as a first-class constraint. Activity and overlays
must cap themselves before reducing Conversation below a usable minimum.

## 11. Composer Refactor

### 11.1 Editor

Own:

- textarea ref;
- text/cursor state if needed;
- submission callback;
- newline semantics.

Do not own command semantics or environment shutdown.

### 11.2 Mention subsystem

Split filesystem search from rendering.

`mention-search.ts` owns pure/path-bound candidate discovery rules.

`mention-model.ts` owns mention parsing and candidate projection.

`MentionMenu` owns rendering and local selection.

Mention search remains workspace-contained according to current behavior; this
stage must not silently expand filesystem authority.

### 11.3 Command subsystem

Command menu resolves user input to typed CommandIntent.

It must not receive direct renderer destroy, local Session authority or
AgentLoop references.

### 11.4 Composer actions

Model/mode/compact/Inspector actions may be rendered near Composer, but they
emit intents to controller/router boundaries.

## 12. Command Intent Architecture

The command layer separates **selection** from **execution**.

Example flow:

```text
user selects /compact
  -> CommandMenu resolves `compact-context` intent
  -> SessionCommandRouter receives intent
  -> invokes SessionController.compact()
  -> authority result updates projections/store
  -> toast/dialog surfaces display result if necessary
```

This prevents InputBar from becoming the owner of every command dependency.

Command compatibility aliases may remain, but their target intent must be the
same canonical action.

## 13. Interaction Router

### 13.1 Purpose

KeyboardLayerProvider remains useful for stack ordering. Interaction Router
adds semantic interpretation above it.

### 13.2 Priority contract

```text
modal dialog
> transient overlay (command / mention)
> Inspector
> focused Composer behavior
> Session runtime actions
> global application actions
```

### 13.3 Required semantic cases

- Escape does exactly one highest-priority action;
- Enter submits/steers only when Composer owns the interaction;
- Alt/Option+Enter queues follow-up only in the appropriate runtime state;
- Tab changes mode only when no higher layer owns Tab;
- command/mention arrow keys never leak to Session navigation;
- Inspector shortcuts never interrupt a Run unless explicitly routed.

### 13.4 Mouse behavior

Mouse disclosure remains local to the clicked surface. No presentation-only
click may create semantic Session history.

## 14. Dialog and Overlay Ownership

Approval remains a runtime interaction transaction, but rendering should move
behind an application-to-dialog presentation adapter rather than being
coordinated directly in `Session.tsx` long-term.

Recovery toast similarly should be emitted from a narrow presentation effect
that observes RecoveryUiView transitions.

Dialogs remain appropriate for short modal interactions. Long-lived
inspectable information should use Inspector instead of proliferating dialogs.

## 15. Session Route/Screen After Refactor

`screens/session.tsx` should converge toward:

```text
resolve route/session snapshot
create/attach SessionWorkspace runtime
render SessionWorkspace provider/root
handle route-level not-found/failure
```

It should not know how ToolUse is correlated, how Activity is projected, or
how `/compact` executes.

## 16. Error and Unknown-State Handling

The architecture must preserve existing fail-closed semantics.

- unknown telemetry is not zero;
- incomplete ToolUse remains incomplete;
- failed controller operation must not be rendered as success;
- projection failure degrades the affected surface rather than crashing the
  entire workspace where possible;
- controller/store initialization failure must surface a route/workspace error
  and must not begin Provider/Tool side effects accidentally.

## 17. Store and Controller Lifetime

One mounted Session workspace gets one controller and one UI store.

They must not be global singletons keyed implicitly by “current session”.

This avoids state leakage when navigation changes Sessions or tests mount more
than one isolated workspace.

Shared process services such as configured Provider registry may remain shared
through existing environment seams.

## 18. Side-Effect Ordering

UI restructuring must preserve existing durable-first rules.

Examples:

- user intent durable commit before AgentLoop side effects;
- Tool terminal persistence before continuation exposure;
- model change visible only after authority transition succeeds;
- approval allow persisted before executor invocation;
- quiescence before renderer teardown where currently required.

Moving calls behind SessionController must not change these orders.

## 19. Migration Strategy

Implementation is divided into architecture units A1-A7 in the PLAN document.

The migration deliberately avoids replacing `useChat`, `Session.tsx` and
`InputBar` all at once.

At each checkpoint:

1. establish new contract and focused tests;
2. route one existing behavior through the new seam;
3. prove parity and render isolation;
4. remove only the superseded legacy path;
5. run relevant CLI regressions;
6. continue to the next responsibility.

## 20. Explicit Non-Goals

This stage does not implement:

- Inspector content for Tree/Context/Usage/Runtime/Security;
- new analytics;
- Session rename/delete semantics;
- new Provider protocols;
- new Agent/Subagent runtime;
- new MCP runtime;
- web/desktop GUI migration;
- Windows native sandbox changes;
- new persistent UI preference schema;
- Harness/Runtime/Session persistence redesign.

## 21. Architecture Escalation Triggers

Implementation must stop and request explicit architecture approval if it
requires:

- new AgentRun/Turn/Step semantics;
- new Runtime Event type/field;
- new Session Entry kind;
- persistence migration;
- Provider request semantic change;
- Context policy change;
- permission/approval semantic change;
- Usage/Cost authority change;
- automatic replay of external side effects;
- replacement of existing durable-first ordering.

## 22. Definition of Done

UI Architecture Foundation is delivered only when all of the following are
true:

- `useChat` no longer acts as the monolithic owner of application orchestration
  and all UI projections;
- a non-React SessionController boundary coordinates Session runtime actions;
- a disposable per-Session UI store exists with selector-based subscriptions;
- Conversation, Activity, Status and Composer runtime state can update without
  forcing unrelated surfaces to rerender;
- no Session-root presentation timer exists;
- InputBar is decomposed so Composer no longer executes application lifecycle,
  navigation or authority semantics directly;
- CommandIntent/command routing separates menu selection from execution;
- keyboard shortcut precedence is centralized through an Interaction Router on
  top of the existing keyboard-layer primitive;
- SessionWorkspace has explicit Conversation/Activity/Composer/Status/Hints
  boundaries;
- current durable-first runtime semantics remain unchanged;
- Inspector Slice 2 can consume the store/projection/controller architecture
  without expanding a god hook/component;
- all TEST contract gates pass;
- DELIVERY records actual migration, remaining legacy adapters, performance
  evidence and architecture-boundary confirmation.
