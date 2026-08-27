# UI Runtime Workbench Roadmap

**Status:** Active — UI Slice 1 / P0 Runtime Activity Foundation delivered on
2026-08-27; Inspector and later slices remain planned.

**Target:** Local CLI / OpenTUI presentation layer after the Stage 6.5 local
Session, Runtime, Provider, Context, Usage and Cost foundations.

**Boundary:** This roadmap does **not** redesign Harness, Runtime Event
semantics, Session authority, Context policy, Provider execution, persistence
schemas, permission semantics, pricing semantics or AgentLoop scheduling.

## 1. Goal

Bring the CLI presentation model up to the capability level already available
in the local Agent Runtime.

The current UI is primarily:

```text
Session
  -> Messages
  -> Input
  -> command/dialog surfaces
```

while the runtime already owns:

```text
Session
  -> Run
      -> Turn
          -> Model Step / Tool Step
  -> Session Entry Tree
  -> Context projection
  -> Usage / Cost / Cache projection
  -> Runtime recovery facts
  -> Permission / Approval audit facts
```

The target is a local **Agent Runtime Workbench** in which Conversation remains
the primary surface, active execution is visible as structured Activity, and
deeper operational state is available through one Inspector architecture.

## 2. Current UI Baseline

Already implemented and intentionally reused:

- Home, New Session and Session screens;
- User/assistant/error message rendering;
- reasoning/text/tool message parts;
- streaming/busy/interrupt interaction;
- steering and follow-up submission;
- slash command menu and `@file` mention menu;
- Provider and Model dialogs;
- interactive Tool approval dialog;
- semantic Session Tree / navigation projection;
- Branch Summary Carry / No Carry / Cancel UX;
- manual `/compact` feedback;
- Settings summary/reload/open-file actions;
- StatusBar mode/model plus current Context, API Cost and Cache metrics;
- Toast/Dialog/Theme/keyboard-layer infrastructure.

The UI therefore has real authority integration, but it still presents most
runtime behavior as a linear stream of message parts rather than a structured
agent execution model.

## 3. Hard UI Architecture Rules

### 3.1 UI consumes projections, not raw runtime internals

New React/OpenTUI components must not learn Harness semantics by traversing raw
objects ad hoc.

Preferred direction:

```text
Harness / Runtime / Session authority
  -> CLI-owned pure UI projection
      -> React/OpenTUI component
```

Existing examples to preserve:

```text
Session Entry Tree
  -> SessionNavigationProjection
      -> SessionTreeDialog

Runtime Usage + Current Context
  -> SessionObservability
      -> StatusBar
```

New work should follow the same pattern, for example:

```text
AgentRun
  -> AgentActivityProjection
      -> ActivityView
```

### 3.2 Conversation remains the primary workspace

Do not turn the default Session screen into a dense diagnostics dashboard.
High-frequency information belongs in the main flow; deep diagnostics belong
behind progressive disclosure.

### 3.3 One Inspector architecture, not one slash command per subsystem

Context, Usage, Tree, Runtime and Security need one consistent Inspector shell
rather than independent unrelated dialogs with duplicated navigation patterns.
Slash commands may remain entry shortcuts, but they are not the information
architecture.

### 3.4 UI state must not become semantic Session authority

Expansion state, selected Inspector tab, temporary filters, scroll position and
similar presentation state are device/process-local UI state unless a later
design explicitly approves local persistence. They must not become Session
Entries or Runtime Events.

### 3.5 Missing UI data does not justify silent bottom-layer redesign

If a UI slice requires information that existing approved projections do not
provide, implementation must stop at the boundary and record the missing seam
for explicit architecture review. UI work may not opportunistically mutate
Harness contracts or persistence schemas.

## 4. Priority P0 — Main Session Runtime Visibility

P0 fixes the largest structural gap: Harness knows Run/Turn/Step execution,
while the Session UI mainly shows Messages.

### P0.1 Agent Activity Projection

Introduce a CLI-owned pure projection over the current `AgentRun` suitable for
presentation.

Conceptual output:

```ts
type AgentActivityView = {
  runId: string;
  status: "running" | "completed" | "interrupted" | "failed";
  startedAt: number;
  elapsedMs: number;
  turns: ActivityTurn[];
  activeStepId?: string;
};
```

The projection should express:

- Turn cause: initial / tool-continuation / steering / follow-up;
- Model Step vs Tool Step;
- running/completed/interrupted/failed status;
- Tool name/call identity where relevant;
- elapsed/duration information available from current runtime state;
- bounded progress text if Harness reports progress;
- no Provider prompt/content reconstruction.

Acceptance direction:

- React does not derive Turn/Step semantics itself;
- active Step is visually obvious;
- completed prior Steps remain inspectable without dominating the transcript;
- interrupted/failed Step state remains visible after the transient spinner is
  gone for the current in-memory Run;
- no new durable event or Session Entry is introduced.

### P0.2 Activity Surface in SessionShell

Add a dedicated activity region to the Session layout.

Preferred first layout:

```text
Conversation

Agent Activity
  Model        ✓ 1.4s
  Read File    ✓ 0.1s
  Bash         ● running 3.8s
  Model        ○ pending / not yet created

Input
Build > model · Ctx · API · Cache
```

The first implementation should remain terminal-width tolerant. Avoid a
mandatory permanent side pane until narrow/medium/wide layout behavior has been
tested.

### P0.3 ToolUse Presentation Redesign

Replace the current one-line Tool message rendering with a semantic ToolUse
presentation component.

Required visual states:

- requested/running;
- completed;
- failed;
- cancelled;
- timed out;
- denied;
- approval waiting when currently applicable;
- incomplete historical diagnostic where the canonical projection exposes it.

Default presentation should be compact; details are expandable.

Example:

```text
▸ Bash  bun test packages/cli      ✓ 2.4s
```

Expanded:

```text
▾ Bash
  $ bun test packages/cli

  190 pass
  0 fail

  ✓ completed · 2.4s
```

The component must consume existing canonical/projection state rather than
persisting a second Tool terminal representation.

### P0.4 Main Session Information Architecture Cleanup

After Activity and ToolUse exist, normalize the main screen hierarchy:

1. Conversation content;
2. Agent Activity / current execution state;
3. Input composer;
4. compact StatusBar;
5. secondary keyboard hints.

Avoid adding Context/Usage/Security detail directly into the main transcript.

## 5. Priority P1 — Unified Session Inspector

P1 exposes already-existing deep runtime capabilities without overcrowding the
main Session screen.

### P1.1 Inspector Shell

Create one reusable Session Inspector shell with stable sections:

```text
Session Inspector
  Tree
  Context
  Usage
  Runtime
  Security
```

Requirements:

- common keyboard navigation/search/close behavior;
- narrow-terminal fallback;
- one active section at a time in V1;
- section components consume UI-facing projections;
- existing `/tree` may route into the Tree section rather than being removed;
- future `/inspect` may become the canonical entry command.

### P1.2 Context Inspector

Expose current `CurrentContextUsage` plus existing compaction/pruning metadata
that is already available at the CLI seam.

Target information:

```text
Context                         42.8k / 128k  33%
Input budget                   112k
Reserved output                 12k
Safety margin                    4k
Counter                 heuristic
Quality                   estimated
```

Where existing state safely exposes it, also present last compaction / Tool
Result pruning summaries. Do not manufacture missing history.

### P1.3 Usage / Cost Inspector

Expose the current Session Usage projection already owned by Runtime Usage.

Target information:

```text
Input total                    561.3k
  uncached                     195.7k
  cache read                   365.6k
  cache write                     —
Output                          28.2k
Cache hit                       65.1%
API cost                      $0.0847
Model steps                        29
Coverage                      complete
Integrity                        valid
```

Rules:

- unknown remains `—`, never zero;
- partial Cost must remain explicitly partial/lower-bound;
- Context estimate is never shown as API Usage;
- V1 remains Session-wide; day/week/project analytics stay deferred.

### P1.4 Session Tree UX Upgrade

Keep the current semantic Navigation Projection, but improve the presentation:

- visually distinguish branch points from flat history;
- ToolUse rows use Tool semantics rather than raw Entry vocabulary;
- active path vs sibling branches are easier to scan;
- selected row can show concise semantic metadata/details;
- Branch Summary transfer behavior remains unchanged;
- hidden bookkeeping entries remain hidden.

This is a UI redesign over the existing projection, not a Session Tree model
redesign.

### P1.5 Runtime / Recovery Inspector

Promote recovery state from one transient toast into an inspectable view.

Present only already-approved runtime facts such as:

- recovered offset/snapshot diagnostics where exposed;
- incomplete Run/operation counts;
- current/recent Run terminal state available to the UI seam;
- Usage persistence incomplete flag;
- no automatic replay controls.

The view must not imply that an incomplete external side effect can be safely
replayed unless a later runtime design explicitly supports it.

### P1.6 Security Audit Inspector

Expose `SecurityAuditTimeline` through a CLI UI projection.

Target user-level semantics:

```text
✓ read workspace
  allow · configured

✓ bash
  approval requested -> allow once -> completed

✕ write outside workspace
  denied

⚠ tool call ...
  inconsistent lifecycle
```

Rules:

- never reconstruct redacted command/path/resource values from durable audit
  events;
- ephemeral approval details remain available only while the approval request
  exists;
- pending/inconsistent/legacy must be visibly distinct;
- audit view is read-only.

## 6. Priority P2 — Configuration, Session Management and Semantic Polish

### P2.1 Typed Settings UI

Evolve `/settings` from primarily opening config files into an actual typed
configuration surface for settings whose contracts already exist.

Candidate V1 controls:

- `branchSummaryOnJump`: ask / always / never;
- ProcessSandbox mode/network/environment;
- selected safe settings that can be edited without exposing secrets;
- reload and file-opening remain advanced actions.

Permission rule editing should be a separate carefully designed slice rather
than a generic JSON editor embedded in the TUI.

### P2.2 Session Management

Build on LocalSessionAuthority operations already available or explicitly
approved at the UI seam:

- richer Session list metadata;
- archive action;
- rename only if an approved local authority operation exists or is separately
  designed;
- delete must not be invented as an implicit archive alias;
- current model/mode, last updated time and optional trustworthy Session Usage
  summary may be displayed when available without expensive full replay.

### P2.3 Mode / Agent Terminology Cleanup

Current UI labels `Plan` and `Build` as “agents”, while Harness semantics treat
them as modes.

Target direction:

- visible keyboard hint becomes `tab mode`;
- canonical UI command becomes `/mode` or equivalent;
- `/agents` may remain a compatibility alias during migration;
- reserve “Agent” terminology for future actual agent/subagent identity.

### P2.4 Provider and General UI Polish

Provider management is already functionally mature. Later work should focus on
consistency, status hierarchy, layout, destructive-action confirmation and
shared Inspector/Dialog patterns rather than Provider architecture changes.

## 7. Recommended Delivery Sequence

Do not implement all priorities as one branch or one delivery.

### UI Slice 1 — Runtime Activity Foundation (P0)

Scope:

- AgentActivityProjection;
- ActivityView;
- ToolUse presentation redesign;
- SessionShell information hierarchy;
- mode/interaction status consistency needed by the new surface.

This slice is the prerequisite for all other UI work.

### UI Slice 2 — Inspector Foundation + Context/Usage/Tree (P1-A)

Scope:

- Inspector shell;
- Context Inspector;
- Usage/Cost Inspector;
- Tree presentation upgrade;
- entry commands/keyboard navigation.

These areas are grouped because their data seams already exist and are mostly
read-only projections.

### UI Slice 3 — Runtime Recovery + Security Audit (P1-B)

Scope:

- Runtime/Recovery Inspector;
- Security Audit UI projection;
- audit status presentation;
- durable-vs-ephemeral privacy review.

Keep this separate because security/recovery wording and fail-closed semantics
need a dedicated review even when the underlying Harness remains unchanged.

### UI Slice 4 — Settings / Sessions / Semantic Polish (P2)

Scope:

- typed Settings forms;
- Session management improvements;
- Mode/Agent terminology cleanup;
- Provider/dialog consistency polish;
- final responsive/layout/accessibility pass for OpenTUI constraints.

## 8. Required Design Workflow for Every Slice

Before production code changes, each UI slice must produce its own detailed
design/test/delivery contract.

Recommended files:

```text
docs/UI-<SLICE>-DESIGN.md
docs/UI-<SLICE>-TEST.md
docs/UI-<SLICE>-DELIVERY.md
```

The detailed DESIGN must specify:

- current behavior and exact UX problem;
- source-of-truth objects and approved UI projection seam;
- component hierarchy;
- state ownership and lifecycle;
- keyboard/mouse interaction;
- narrow/medium/wide terminal behavior;
- loading/running/completed/error/interrupted/unknown states;
- compatibility behavior;
- explicit out-of-scope bottom-layer changes.

The TEST contract must include:

- pure projection tests first;
- component/formatter tests where feasible;
- keyboard-layer and dialog/Inspector navigation tests;
- integration tests proving authority state reaches UI correctly;
- regressions for interrupted/failed/partial/unknown states;
- CLI typecheck/build;
- relevant existing Harness/CLI suites;
- `git diff --check`.

The DELIVERY document must record:

- what actually shipped versus the approved design;
- files/components/projections changed;
- test/build evidence;
- manual terminal-width interaction checks;
- known limitations and deferred items;
- confirmation that Harness/Runtime/Session persistence contracts were not
  silently changed.

## 9. Architecture Escalation Rule

During UI implementation, any requirement that needs one of the following must
be stopped and reviewed separately before implementation:

- new Harness semantic state;
- new Runtime Event fields/types;
- new Session Entry kind;
- Session/Runtime Store migration;
- AgentLoop scheduling change;
- Provider request behavior change;
- Context/Compaction policy change;
- Permission/Approval semantics change;
- pricing/Usage authority change.

This preserves the current instruction that the bottom design is frozen while
the UI catches up.

## 10. Explicitly Deferred Beyond This UI Roadmap

- day/week/month/project analytics;
- budgets, spend alerts and Provider billing reconciliation;
- cloud sync/commercial entitlement UI;
- account quota/balance monitoring;
- per-message pricing invoices;
- arbitrary branch merge/conflict UI;
- Subagent orchestration UI before an approved Subagent Runtime exists;
- Windows native sandbox redesign;
- new Provider protocols/auth architecture;
- web/desktop GUI migration away from OpenTUI.

## 11. Roadmap Definition of Done

This roadmap itself is complete when:

- UI priorities are ordered P0/P1/P2;
- every priority maps to already-existing runtime capability or an explicit UI
  boundary;
- the recommended implementation sequence avoids a monolithic UI rewrite;
- future slices are required to establish DESIGN/TEST/DELIVERY contracts before
  implementation;
- bottom-layer architecture remains frozen unless an explicit escalation is
  approved;
- `tasks/plan.md` references this roadmap as the source for subsequent UI
  delivery planning.

