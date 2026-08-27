# UI Runtime Activity Foundation Design

**Status:** Delivered — implemented and verified on 2026-08-27.

**Roadmap:** `docs/UI-RUNTIME-WORKBENCH-ROADMAP.md` — UI Slice 1 / P0.

**Tasks:** `tasks/plan.md` — UI-1 through UI-4.

## 1. Problem

The Session screen currently presents runtime work mainly as message parts plus
a transient spinner. The Harness already owns structured `Run -> Turn -> Step`
execution, but React does not receive a dedicated presentation projection.
Tool message parts are also rendered as a one-line string, which hides the
canonical Tool terminal outcome and collapses running, denied, cancelled,
timed-out and incomplete states into nearly the same visual treatment.

P0 closes that presentation gap without changing lower-layer semantics.

## 2. Frozen Architecture Boundary

This slice is CLI presentation work only. It must not add or change:

- Harness Run/Turn/Step semantics or AgentLoop scheduling;
- Runtime Event fields/types;
- Session Entry kinds or Session/Runtime Store schemas;
- Context/Compaction, Provider request, Permission/Approval, or Usage/Cost
  authority semantics.

If implementation cannot satisfy a UI requirement through already-approved
state, it stops at the seam rather than manufacturing new durable facts.

## 3. Source-of-Truth Seams

### 3.1 Agent Activity

Canonical source:

```text
Harness AgentRun / AgentTurn / AgentStep
        + ephemeral step_update progress
    -> CLI AgentActivityProjection
    -> ActivityView
```

`AgentActivityProjection` is a pure CLI module. React must not infer Turn cause,
active Step, Tool identity, terminal status, or duration by traversing raw
Harness objects.

`step_update` progress already exists as an ephemeral AgentLoop lifecycle
event. The CLI may keep the latest bounded progress update process-locally for
the current in-memory Run. It is UI state, not a Runtime Event or Session
Entry.

### 3.2 ToolUse

ToolUse has a different semantic source from Activity Step status:

```text
AI SDK Tool message part
  + active-branch canonical tool_call/tool_result
  + current ephemeral Approval request
  + current Agent Activity Tool Step
    -> CLI ToolUseProjection
    -> ToolUse component
```

This distinction is mandatory. An AgentLoop Tool Step can complete normally
while the Tool Runtime outcome is `denied`, `cancelled`, or `timed_out`.
Activity therefore reports execution-step lifecycle; ToolUse reports Tool
outcome.

Canonical `tool_result.status` wins for historical terminal state. AI SDK part
state is a live/fallback presentation input only and does not become a second
durable Tool authority.

## 4. Agent Activity Projection

The CLI projection exposes presentation-ready state approximately shaped as:

```ts
type AgentActivityView = {
  runId: string;
  status: "running" | "completed" | "interrupted" | "failed";
  startedAt: number;
  endedAt?: number;
  elapsedMs: number;
  activeStepId?: string;
  turns: ActivityTurn[];
};
```

Each Turn includes its canonical cause and status. Each Step includes:

- `model | tool` kind;
- semantic display label;
- canonical lifecycle status;
- Tool name/call identity for Tool Steps;
- start/end/duration/elapsed timing;
- `active` flag;
- bounded process-local progress text when reported.

No prompt, model input, Provider payload, Tool input/output, or arbitrary
progress `details` is reconstructed into Activity.

Progress text is whitespace-normalized and bounded before it reaches React.
Numeric `completed/total` progress may be represented when both values are
valid. `details` stays opaque and is not rendered in P0.

## 5. ActivityView

The Session layout becomes:

```text
Conversation

Agent Activity
  Model      ✓ 1.4s
  Read File  ✓ 0.1s
  Bash       ● running 3.8s

Input
StatusBar
secondary interaction hints
```

Conversation remains the only flex-growing transcript surface. Activity is a
compact, non-side-pane region between Conversation and Input.

### Density

- The active/latest Turn is expanded by default.
- Earlier completed Turns are summarized to one line each by default so a long
  Run does not displace the transcript.
- A mouse disclosure action can expand/collapse summarized Turns and the whole
  Activity history for the current in-memory Run.
- Failure/interruption rows remain visible without requiring expansion.
- No durable expansion preference is stored.

P0 introduces no global Activity keyboard shortcut. Keyboard input remains
owned by the composer/base keyboard layer; the Activity surface must never
steal Enter/Escape/Tab from existing interaction semantics. Keyboard-only users
still receive the active/latest Turn and all failure/interruption state in the
default view. A future Inspector may provide a dedicated navigable execution
history.

### Terminal widths

Use terminal dimensions only for presentation density; semantic projection is
unchanged.

- **Narrow `< 72` columns:** single-line rows; compact status glyph/text;
  optional progress/cause metadata is omitted before the primary label/status.
- **Medium `72-119`:** label, status and duration are retained; Turn cause is
  visible on Turn headers; bounded progress appears when space permits.
- **Wide `>= 120`:** same hierarchy with full bounded progress metadata; no
  permanent side pane is introduced.

## 6. ToolUse Projection and Presentation

ToolUse presentation status is one of:

```text
requested
running
completed
failed
cancelled
timed_out
denied
approval_waiting
incomplete
```

Resolution precedence:

1. canonical terminal `tool_result.status`;
2. current ephemeral approval request for the same `toolCallId`;
3. current Agent Activity running Tool Step;
4. live AI SDK Tool part state;
5. canonical call without terminal while no matching active execution exists ->
   explicit `incomplete` diagnostic.

Historical `approval_required` terminal state is not presented as a live
approval dialog. It becomes an explicit incomplete/approval-required
diagnostic because no process-local transaction can be resumed after restart.

The collapsed row shows only high-value information:

```text
▸ Bash  bun test packages/cli      ✓ 2.4s
```

The expanded row can show bounded input, output/error, source and duration.
Raw values are rendered from already-authorized UI/canonical state; they are
not copied into new persistence. Long strings and serialized structures are
bounded for terminal safety.

Mouse click toggles details. No transcript-level keyboard shortcut is added in
P0, avoiding conflicts with the composer. Essential failure/status text is
always visible in the collapsed row.

## 7. Component / State Ownership

```text
useChat
  owns current AgentRun
  owns process-local latest step progress
  owns current pending Approval
  owns active Session Tree
  -> returns AgentActivityView + ToolUse projection map

Session
  passes projections only

SessionShell
  lays out Conversation -> Activity -> Input -> hints

ActivityView
  owns disclosure-only UI state

BotMessage -> ToolUse
  owns ToolUse disclosure-only UI state
```

Expansion state, terminal-width density, hover/click state and scroll state are
presentation-only and never enter Session/Runtime persistence.

## 8. Status / Failure Semantics

- Running Step: visibly active even if the old spinner is absent.
- Completed Step: lifecycle completion only; ToolUse outcome may differ.
- Interrupted/failed Step: remains visible for the current in-memory Run after
  transient loading indicators disappear.
- Cancelled/timed-out/denied ToolUse: use canonical Tool terminal status.
- Approval waiting: only while the current process-local approval exists.
- Historical pending Tool call: `incomplete`, never auto-replayed.
- Missing timing/progress: omitted, never fabricated as zero.
- Unknown Tool output: no empty-success implication.

## 9. Compatibility

- Existing user/assistant/reasoning/text rendering remains unchanged outside
  the ToolUse branch.
- Existing steering/follow-up/interrupt behavior remains unchanged.
- Existing approval dialog remains the interaction authority.
- Existing StatusBar Context/API/Cache behavior remains unchanged.
- Existing Session Navigation Projection remains unchanged.
- P2 Mode/Agent terminology migration remains deferred; P0 does not repurpose
  `/agents` or change mode authority.

## 10. Acceptance

P0 is acceptable when:

- React consumes `AgentActivityView`, not raw AgentRun semantics;
- current Run/Turn/Step lifecycle is visible and active Step is obvious;
- current in-memory interrupted/failed execution remains visible after loading
  indicators stop;
- ToolUse distinguishes every approved Tool terminal state plus current approval
  waiting and historical incomplete state;
- Tool input/output detail is progressively disclosed and bounded;
- narrow/medium/wide layouts preserve Conversation-first hierarchy;
- no new Harness/Runtime/Session persistence contract is introduced.
