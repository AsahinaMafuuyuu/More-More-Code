# UI Session Inspector Design

**Status:** DELIVERED / VERIFIED — 2026-08-29

**Stage:** UI Slice 2 / P1-A — Inspector Foundation + Context / Usage / Tree

**Scope:** CLI/OpenTUI presentation path only. Harness semantics, Runtime Event
schemas, Session authority, Provider execution, Context/Compaction policy, Usage
authority, pricing semantics and persistence schemas remain unchanged.

## 1. Problem

The local runtime already exposes a semantic Session Tree, Current Context
observability and durable Session Usage/Cost summaries, but the Session UI only
surfaces a compact status line and a standalone Session Tree dialog. This creates
three usability problems:

1. operational state is fragmented across unrelated surfaces;
2. Context and Usage details are not inspectable without changing the main
   transcript hierarchy;
3. the existing `/tree` dialog cannot become a common home for future Runtime and
   Security diagnostics without duplicating navigation/keyboard/layout behavior.

UI Architecture Foundation already reserved an `InspectorSurface` and an
`inspector.open/section` UI-store slice. This stage completes that seam rather than
introducing another application authority.

## 2. Source-of-truth boundaries

```text
SessionController snapshot
  ├─ sessionTree --------------------┐
  ├─ contextUsage ----------------┐  |
  ├─ sessionUsage ---------------┐|  |
  └─ usagePersistenceIncomplete -┘|  |
                                  ||  |
SessionRuntimeBridge              ||  |
  ├─ SessionObservability --------┘|  |
  └─ pure Inspector projections ---┴--┘
                    |
                    v
SessionUiStore
  ├─ inspector shell state
  ├─ inspectorContext
  ├─ inspectorUsage
  └─ inspectorTree
                    |
                    v
InspectorSurface / section views
```

Rules:

- UI components do not traverse raw Harness Runtime Events or reconstruct Usage.
- Inspector projections are read-only and provider-independent.
- Navigation actions call `SessionController`; the Inspector does not mutate the
  Session Tree directly.
- Inspector open/section/search/selection state remains process-local UI state.
- No Inspector action creates a Session Entry or Runtime Event merely by browsing.

## 3. Inspector shell

V1 sections are stable and ordered:

```text
Tree | Context | Usage | Runtime | Security
```

This stage delivers Tree, Context and Usage. Runtime and Security remain visible as
disabled/deferred section labels so information architecture does not change again
when P1-B lands.

Interaction contract:

- `/inspect` opens the Inspector on Tree.
- `/tree` opens the Inspector directly on Tree.
- `/jump` remains the direct jump dialog for a fast single-purpose navigation path.
- `Tab` / `Shift+Tab` cycles Inspector sections.
- `Escape` closes the Inspector before Session Run interruption is considered.
- Tree search is local to the Tree section and never changes Session authority.
- Up/Down selects Tree rows; Enter navigates only selectable semantic rows.
- Mouse selection is supported for section tabs and Tree rows where OpenTUI exposes
  the event.

The Inspector owns one keyboard layer named `inspector`. It must be above the base
Session interaction layer and below modal Dialogs.

## 4. Responsive layout

The Inspector is a full-workspace overlay so opening it does not force Conversation
reflow.

### Wide / medium terminals

```text
┌ Session Inspector ───────────────────────────────────────────────┐
│ Tree   Context   Usage   Runtime   Security           Esc close │
├─────────────────────────────────────────────────────────────────┤
│ section content                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Narrow terminals

- section labels use compact names without explanatory suffixes;
- detail rows stack label/value vertically when needed;
- long values are bounded/truncated for the retained renderer;
- Tree metadata is reduced before semantic preview/navigation identity is removed.

The overlay uses existing terminal dimensions context; it must not create another
renderer resize listener.

## 5. Context Inspector projection

The Context section consumes only `CurrentContextUsage` already produced by
`LocalModelTransport.inspectCurrentContext()`.

Displayed fields:

```text
Current input
Context window
Utilization
Input budget
Reserved output
Safety margin
Counter ID
Quality: estimated | exact
```

Unknown Context state is rendered as unavailable; the UI must not estimate it a
second time.

Compaction detail is limited to already-approved UI/runtime state. This slice does
not add a new durable compaction-history query or Runtime Event field.

## 6. Usage / Cost Inspector projection

The Usage section consumes `SessionUsageSummary` plus the existing
`usagePersistenceIncomplete` flag.

Displayed fields:

```text
Input total
  uncached
  cache read
  cache write
Output total
  text
  reasoning
Cache hit
API cost
Model steps
Coverage
Integrity
```

Semantics:

- missing Provider field -> `—`;
- explicit zero -> `0`;
- `cacheRead / inputTotal` remains the durable Session cache-hit authority;
- incomplete Usage persistence downgrades the presentation to partial/unavailable
  rather than fabricating missing facts;
- partial Cost is labeled partial and is never presented as complete;
- Current Context estimates never enter API Usage/Cost arithmetic.

## 7. Tree Inspector projection

The Tree section reuses `projectSessionNavigationTree()` as the semantic source.
It does not read raw Session Entries in the component.

The Inspector projection keeps:

- projected node ID;
- canonical navigation target Entry ID;
- semantic type/label;
- visible branch depth;
- active state;
- selectable state;
- Tool terminal status when present;
- bounded preview;
- creation timestamp.

Presentation rules:

- ordinary single-child history remains visually flat;
- depth only appears at real visible branch points;
- `tool_use` is rendered as ToolUse, not raw `tool_call/tool_result` vocabulary;
- hidden bookkeeping entries remain hidden;
- incomplete ToolUse remains visible but non-selectable;
- Branch Summary Carry / No Carry / Cancel continues through the existing
  `SessionController` navigation path.

## 8. Store and render isolation

Inspector data is split into independent Session UI slices:

```text
inspector          // open + active section only
inspectorContext   // Context view
inspectorUsage     // Usage view
inspectorTree      // navigation view
```

This prevents Context/Usage/Tree refreshes from notifying unrelated Conversation,
Activity, Composer or Status subscribers. Context and Usage are small projections and
stay current. The potentially unbounded semantic Tree is projected lazily when the
Inspector opens and then refreshed only while the Inspector remains open. This
preserves the delivered long-context rule that closed diagnostics must not add an
O(history) cost to every durable Session mutation.

## 9. Explicit non-goals

- Runtime / Recovery Inspector content (P1-B).
- Security Audit Inspector content (P1-B).
- day/week/month/project Usage analytics.
- account quota/balance or Provider billing reconciliation.
- new Context/Compaction telemetry.
- Session schema, Runtime Event schema or database migrations.
- Session branch merge semantics.
- replacing OpenTUI.

## 10. Acceptance criteria

1. `/tree` and `/inspect` open one unified Inspector shell; `/jump` retains the
   direct jump dialog.
2. Inspector keyboard layer closes before Run interruption and section navigation is
   deterministic.
3. Context fields come only from existing Current Context authority and preserve
   exact/estimated quality.
4. Usage preserves unknown-vs-zero, partial coverage and integrity semantics.
5. Tree uses the existing semantic Navigation Projection and preserves Carry / No
   Carry / Cancel behavior.
6. Inspector slice updates do not rerender unrelated Session UI subscriptions.
7. Narrow/medium/wide rendering stays bounded and does not add resize listeners.
8. Focused tests, full CLI/Harness regressions, CLI/Harness typechecks, production
   CLI build, native TUI stress and `git diff --check` pass before delivery.
