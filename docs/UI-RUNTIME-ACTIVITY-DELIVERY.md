# UI Runtime Activity Foundation Delivery

**Delivery state:** Delivered — 2026-08-27.

**Design:** `docs/UI-RUNTIME-ACTIVITY-DESIGN.md`

**Test:** `docs/UI-RUNTIME-ACTIVITY-TEST.md`

**Roadmap scope:** UI Slice 1 / P0, tasks UI-1 through UI-4.

## Delivered Scope

- D1 — delivered pure `AgentActivityProjection` over current Harness
  Run/Turn/Step state.
- D2 — delivered process-local `step_update` progress tracking. Progress is
  cleared on the next Run and is never written to Runtime Store or Session
  history.
- D3 — delivered compact responsive `ActivityView` between Conversation and
  Input. Current/latest and failed/interrupted Turns remain visible while old
  completed Turns are summarized.
- D4 — delivered pure ToolUse semantic projection using live AI SDK parts,
  canonical active-branch `tool_call/tool_result`, current Activity and current
  Approval state with canonical terminal precedence.
- D5 — delivered compact expandable ToolUse rows with explicit
  `requested/running/completed/failed/cancelled/timed_out/denied/approval_waiting/incomplete`
  states and bounded detail disclosure.
- D6 — renderer regression confirms the hierarchy remains Conversation ->
  Activity -> Input -> StatusBar -> secondary interaction hints.
- D7 — focused/full verification, width-aware rendering tests, typechecks,
  build and `git diff --check` passed.
- D8 — no Harness semantic contract, Runtime Event, Session Entry, persistence
  schema, AgentLoop scheduling, Permission/Approval authority, Provider request,
  Context policy or Usage/Cost authority was changed.

## Delivery Evidence

### Production modules

- `packages/cli/src/lib/agent-activity-projection.ts`
- `packages/cli/src/lib/activity-view-model.ts`
- `packages/cli/src/components/activity-view.tsx`
- `packages/cli/src/lib/tool-use-projection.ts`
- `packages/cli/src/lib/tool-use-view-model.ts`
- `packages/cli/src/components/messages/tool-use.tsx`
- `packages/cli/src/components/messages/bot-message.tsx`
- `packages/cli/src/hooks/use-chat.ts`
- `packages/cli/src/components/session-shell.tsx`
- `packages/cli/src/screens/session.tsx`

### Runtime behavior

`useChat` now subscribes to the already-existing AgentLoop lifecycle seam and
retains only the latest process-local Step progress. It projects the current
Run into `AgentActivityView` and separately projects ToolUse state. Running
elapsed time is advanced by a one-second clock owned inside `ActivityView`, so
the clock rerenders only the Activity subtree rather than the Session root.
React receives these CLI-owned projections instead of interpreting raw Harness
Run semantics.

Activity and ToolUse remain intentionally separate: Agent Step `completed`
does not imply Tool success. Canonical `tool_result.status` is authoritative for
Tool terminal outcome; a missing historical terminal becomes `incomplete` and
is never auto-replayed.

### Verification

- focused P0 suite: **33 pass / 0 fail** across projection, formatter,
  hierarchy and OpenTUI renderer tests;
- full CLI suite: **224 pass / 0 fail** across 47 files;
- full Harness suite: **107 pass / 0 fail** across 15 files;
- CLI TypeScript typecheck: pass;
- Harness TypeScript typecheck: pass;
- CLI production build: pass (`653` bundled modules, `7.93 MB` entry bundle at
  verification time);
- `git diff --check`: pass.

Renderer coverage explicitly exercises a narrow 60-column Activity layout and
a 100-column medium layout; pure view-model coverage exercises 120-column wide
disclosure behavior. The OpenTUI test renderer emits the same non-failing React
`act(...)` warning already present in existing provider-dialog renderer tests;
no assertion or build failure results from it.

## Native Renderer Panic Follow-up — 2026-08-27

After initial P0 delivery, a long-running Windows session exposed a Bun
segmentation fault whose crash report repeatedly referenced `opentui.dll`.
The P0 implementation had placed the one-second elapsed clock in `useChat`,
which caused the whole Session React tree (Conversation/scrollbox/messages,
ToolUse, Activity and Input) to reconcile every second while a Run was active.

The follow-up fix keeps the semantic projection unchanged but moves elapsed
refresh entirely into `ActivityView`. `refreshAgentActivityElapsed()` advances
only display-safe timing fields from the existing `AgentActivityView`; it does
not need raw Harness state. A renderer regression proves that elapsed time
advances after a timer tick while the parent render count remains unchanged.

Post-fix native-renderer stress repeated that real local-clock renderer path
20 times with no panic or segmentation fault. Because the minimal isolation
fix passed, this follow-up deliberately does **not** upgrade Bun or OpenTUI;
dependency changes remain a separate escalation only if the native crash is
reproduced again after this isolation fix.

## Deferred / Not Changed

- Unified Session Inspector (Tree/Context/Usage/Runtime/Security) remains UI
  Slice 2+ work.
- P2 `/agents`/Mode terminology cleanup remains deferred.
- No persistent UI expansion preference was added.
- No day/week/project analytics, recovery replay control, security mutation,
  cloud feature, provider protocol or bottom-layer redesign was introduced.
