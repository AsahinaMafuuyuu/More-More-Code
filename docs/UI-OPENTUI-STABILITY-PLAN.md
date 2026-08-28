# UI OpenTUI Framework Stability Implementation Plan

**Status:** Delivered — S1 through S7 completed and validated on 2026-08-28.

**Date:** 2026-08-27

**Design:** `docs/UI-OPENTUI-STABILITY-DESIGN.md`

**ADR:** `docs/decisions/0029-opentui-native-renderer-stability-and-render-budget.md`

**Test contract:** `docs/UI-OPENTUI-STABILITY-TEST.md`

**Delivery contract:** `docs/UI-OPENTUI-STABILITY-DELIVERY.md`

## 1. Stage Boundary

This stage keeps OpenTUI and stabilizes its Windows runtime/render path. It must
not add Inspector content or change Harness/Session/Provider semantics.

Implementation order is mandatory:

```text
S1 Baseline + Diagnostics Seam
  -> S2 Bun Runtime Baseline
  -> S3 OpenTUI 0.5.x Migration
  -> S4 Render-Storm Removal + Commit Scheduler
  -> S5 Watch Isolation + Stability Profiles
  -> S6 Native Windows Soak + Tuning
  -> S7 Closeout + Delivery
```

Each checkpoint follows:

```text
re-read DESIGN/TEST
-> write/confirm focused Red test where code changes are involved
-> implement only current checkpoint
-> run focused tests/typecheck/build
-> record version/runtime evidence
-> commit checkpoint
```

Do not combine S2/S3/S4 into one commit: the stage needs A/B evidence about
which transition materially changes native stability.

## 2. Baseline Snapshot

Record before implementation:

```text
Bun 1.3.14
OpenTUI 0.4.2
opentui-spinner 0.0.7
80ms dots scheduler
targetFps 60
dev:cli uses --watch
Windows real crash around 48s with opentui.dll frames
```

Existing user crash evidence is sufficient for M0. Do not intentionally waste
time repeatedly crashing the old version merely to reproduce an already
captured native failure.

## 3. S1 — Baseline and Diagnostics Seam

### Goal

Create testable runtime/render-policy primitives and diagnostic counters before
changing dependency versions.

### Planned modules

```text
packages/cli/src/tui/runtime-compatibility.ts
packages/cli/src/tui/render-profile.ts
packages/cli/src/tui/stability-probe.ts
packages/cli/tests/tui-runtime-compatibility.test.ts
packages/cli/tests/tui-render-profile.test.ts
packages/cli/tests/tui-stability-probe.test.ts
```

### Tasks

- [ ] Add pure Bun-version parsing/classification.
- [ ] Add pure normal/safe render profiles.
- [ ] Add process-local stability counters with no prompt/message/tool content.
- [ ] Add explicit version/profile fields to diagnostic snapshots.
- [ ] Keep diagnostics disabled by default.
- [ ] Add a source/audit test proving diagnostic payload types cannot include
  message/prompt/tool raw data.

### Acceptance

- [ ] Pure modules can be tested without creating an OpenTUI renderer.
- [ ] Baseline runtime facts can be logged locally when diagnostics are enabled.
- [ ] No durable Session/Runtime Event is added.

### Checkpoint commit

```text
test(tui-stability): establish runtime and render diagnostics
```

## 4. S2 — Bun Runtime Baseline

### Goal

Move the supported Windows runtime away from Bun 1.3.14 while isolating that
change from OpenTUI/render-policy changes.

### Tasks

- [ ] Record `bun@1.4.0` as the repository development baseline.
- [ ] Add startup compatibility guard before `createCliRenderer()`.
- [ ] Bun `<1.4.0` fails early with a concise actionable message.
- [ ] Record exact `Bun.version` and `Bun.revision` for native smoke evidence.
- [ ] Do not change OpenTUI version in this checkpoint.

### Verification

- [ ] version parser tests;
- [ ] startup guard tests;
- [ ] full CLI test/typecheck/build;
- [ ] short real Windows smoke on Bun 1.4.0 + OpenTUI 0.4.2.

The smoke result may still crash. S2 is a discriminator, not the delivery gate.

### Checkpoint commit

```text
chore(tui-stability): require Bun 1.4 runtime baseline
```

## 5. S3 — OpenTUI 0.5.x Migration

### Goal

Move from OpenTUI 0.4.2 to an exact-pinned validated 0.5.x pair before changing
the application's render workload.

### Candidate policy

Start with:

```text
@opentui/core  0.5.9
@opentui/react 0.5.9
```

Only fall back to 0.5.8 if 0.5.9 has a reproducible project compatibility or
native regression.

### Tasks

- [ ] Upgrade core/react together.
- [ ] Exact-pin versions in package manifest.
- [ ] Regenerate `bun.lock` with the selected exact pair.
- [ ] Resolve public API migration differences only; no unrelated refactor.
- [ ] Verify renderer `maxFps`, `idle()` and scheduler-state APIs used later are
  public in the selected version.
- [ ] Keep spinner/render policy unchanged in this checkpoint to preserve A/B
  attribution.

### Verification

- [ ] OpenTUI-focused component tests;
- [ ] full CLI suite;
- [ ] CLI typecheck/build;
- [ ] real Windows native smoke using the same workload as S2.

### Checkpoint commit

```text
chore(tui-stability): migrate OpenTUI renderer baseline
```

## 6. S4 — Render-Storm Removal and Session UI Commit Scheduler

### Goal

Remove avoidable high-frequency render requests and bound provider-stream UI
reconciliation without changing provider/semantic throughput.

### S4.1 Remove autonomous spinner

- [ ] Remove `opentui-spinner` dependency.
- [ ] Replace animated `Spinner` with static semantic `BusyIndicator`.
- [ ] No busy component owns `setInterval`, `requestRender`, `requestLive` or
  equivalent autonomous animation.
- [ ] Preserve current theme/mode semantics.

### S4.2 Renderer budget

- [ ] Normal profile `targetFps=30`.
- [ ] Normal profile `maxFps=30` using selected public OpenTUI API.
- [ ] Renderer remains automatic/on-demand; do not call `start()` at startup.
- [ ] Existing shutdown path still owns renderer destruction.

### S4.3 Presentation commit scheduler

Planned module:

```text
packages/cli/src/ui/session/runtime/session-ui-commit-scheduler.ts
```

- [ ] Conversation/Activity/Status are coalescible.
- [ ] Normal coalescing period is 50ms / max 20Hz.
- [ ] latest value per slice wins inside one pending frame.
- [ ] Approval/Recovery/Composer runtime stays immediate.
- [ ] immediate transitions flush relevant pending visible state first.
- [ ] terminal stream transition flushes final Conversation state.
- [ ] dispose cancels pending work and prevents post-destroy writes.
- [ ] one scheduler instance per Session UI store.

### S4.4 Runtime bridge integration

- [ ] `SessionRuntimeBridge` publishes through the scheduler instead of calling
  unrestricted store updates for coalescible slices.
- [ ] durable/model/tool execution remains outside the scheduler.
- [ ] no semantic event is dropped or delayed by the presentation scheduler.

### Verification

- [ ] fake-clock scheduler Red/Green tests;
- [ ] 100 rapid Conversation patches produce bounded notifications;
- [ ] final chunk is present after terminal flush;
- [ ] Approval remains immediate;
- [ ] no store write after destroy;
- [ ] architecture audit finds no `opentui-spinner` normal-path dependency;
- [ ] architecture audit finds no production `renderer.start()`;
- [ ] full CLI tests/typecheck/build.

### Checkpoint commit

```text
fix(tui-stability): bound OpenTUI render pressure
```

## 7. S5 — Watch Isolation and Stability Profiles

### Goal

Separate renderer/runtime validation from Bun's watcher/restart lifecycle and
provide a bounded diagnostic fallback profile.

### Tasks

- [ ] `dev:cli` becomes non-watch.
- [ ] add `dev:cli:watch` for opt-in watch development.
- [ ] add normal/safe renderer profile selection.
- [ ] safe profile caps renderer at 15 FPS.
- [ ] safe profile coalesces presentation to 10 Hz.
- [ ] safe profile disables presentation-only elapsed timers.
- [ ] profile choice appears in diagnostics.
- [ ] normal remains the release target; safe is not used to hide a failing
  normal profile.

### Verification

- [ ] script tests/source audit;
- [ ] normal and safe policy tests;
- [ ] CLI can start without watcher;
- [ ] watcher path still starts after normal smoke passes.

### Checkpoint commit

```text
chore(tui-stability): isolate watch mode and safe profile
```

## 8. S6 — Native Windows Stress Harness and Tuning

### Goal

Create a real renderer workload that can fail in the same native boundary as the
production CLI, with pressure volume rather than long elapsed time as the main
release signal.

### Planned entrypoint

```text
packages/cli/src/dev/tui-stability-soak.tsx
```

Root script:

```text
tui:soak
tui:stress
```

### Workload modes

#### idle

- real `createCliRenderer()`;
- SessionWorkspace critical surfaces;
- fixed transcript;
- running Activity 1Hz clock in normal mode;
- no busy animation.

#### stream

- synthetic chunks generated at a nominal 1ms interval;
- measured source pressure must remain >=100 updates/sec;
- coalescer proves bounded surface commits;
- ToolUse transitions;
- Activity/Status changes;
- no Provider request.

#### churn

- repeated ToolUse/message group changes at a nominal 2ms source interval;
- component mount/destroy cycles;
- Composer immediate-state churn at 25ms;
- Conversation scroll churn at 10ms;
- overlay/dialog churn at 40ms.

### Automated stress sequence

Default normal-profile Windows release gate:

```text
idle    20 sec
stream  45 sec
churn   45 sec
```

The release command is one `bun run tui:stress`. The stream/churn runs must
assert measured pressure floors and coalescing ratios; process survival alone
is insufficient. Repeat runs are useful for flaky-failure investigation but
are not a mandatory wall-clock multiplier.

### Real application smoke

- [ ] short non-watch `dev:cli` integration smoke is recommended;
- [ ] resize across narrow/medium/wide terminal widths;
- [ ] scroll Conversation;
- [ ] one model/ToolUse path when credentials and a safe target are already
  available;
- [ ] no native panic/crash.

Provider credentials or an external Tool side effect are not manufactured just
to close the renderer gate. Missing real-model coverage is recorded as a
limitation when the synthetic native pressure gate and regressions are Green.

### Watch-mode secondary diagnostic

- [ ] source/script audit proves watch is isolated from the release path;
- [ ] if a watch-specific lifecycle problem is suspected, run a short watch
  smoke after normal passes;
- [ ] trigger at least one intentional source reload;
- [ ] distinguish watcher restart behavior from renderer crash behavior.

### Failure handling

If normal profile crashes:

1. record Bun/OpenTUI versions and crash classification;
2. run safe profile on the same workload;
3. compare 0.5.9/0.5.8 only if the evidence points to renderer-version change;
4. reduce to synthetic soak/minimal repro;
5. keep stage status Blocked;
6. do not proceed to Inspector.

### Checkpoint commit

```text
test(tui-stability): add native renderer stress gate
```

## 9. S7 — Closeout and Delivery

### Tasks

- [ ] Update ADR implementation status.
- [ ] Mark DESIGN/PLAN/TEST Delivered/Satisfied only after real native gate.
- [ ] Fill `docs/UI-OPENTUI-STABILITY-DELIVERY.md` with exact runtime versions,
  matrix results, render counters, test counts and known limitations.
- [ ] Update `tasks/plan.md` and UI roadmap.
- [ ] Update CHANGELOG with delivered renderer stability work.
- [ ] Confirm Inspector stage gate is unblocked only if normal profile passes.
- [ ] Preserve unrelated `AGENTS.md` user modification.

### Final checkpoint commit

```text
docs(tui-stability): close OpenTUI stability delivery
```

## 10. Required Regression Matrix

At final closeout run repository-equivalent commands for:

```text
bun test packages/cli/tests
bun run --filter @more-more-code/harness test
bunx tsc --noEmit -p packages/cli/tsconfig.json
bunx tsc --noEmit -p packages/harness/tsconfig.json
bun run build:cli
git diff --check
```

Also run the single native release matrix:

```text
bun run tui:stress
```

Individual `tui:soak --workload ...` invocations remain available for focused
reproduction and safe-profile comparison.

## 11. Stage Gate

This stage is **not complete** merely because:

- unit tests pass;
- OpenTUI is upgraded;
- safe mode survives;
- a test renderer survives 100 mounts;
- the crash cannot be reproduced in a short local run.

It is complete only when the normal non-watch profile passes the measured real
Windows native-renderer pressure matrix and all repository regression gates are
Green.

UI Slice 2 / Inspector remains blocked until S7 marks the DELIVERY as
`Delivered`.
