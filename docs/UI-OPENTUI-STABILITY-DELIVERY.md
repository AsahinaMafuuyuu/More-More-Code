# UI OpenTUI Framework Stability Delivery Contract

**Delivery state:** Planned — implementation not started.

**Date:** 2026-08-27

**Design:** `docs/UI-OPENTUI-STABILITY-DESIGN.md`

**Plan:** `docs/UI-OPENTUI-STABILITY-PLAN.md`

**Test:** `docs/UI-OPENTUI-STABILITY-TEST.md`

**ADR:** `docs/decisions/0029-opentui-native-renderer-stability-and-render-budget.md`

## 1. Delivery Intent

This document is the mandatory closeout record for the OpenTUI Framework
Stability stage.

It must remain `Planned` until the **normal, non-watch, real Windows native
renderer profile** passes. Unit tests, test-renderer stress, dependency upgrades
or safe-mode success alone are insufficient.

## 2. Known Pre-Stage Failure

Baseline evidence captured before the stage:

```text
Runtime:        Bun 1.3.14 Windows x64
Renderer:       @opentui/core/react 0.4.2
Busy animation: opentui-spinner 0.0.7 / dots 80ms
Renderer config targetFps=60
Launch mode:    --watch
Observed after: ~48 seconds
Failure:        panic(main thread): Segmentation fault
Native frames:  opentui.dll present repeatedly in crash report
RSS:            ~0.32 GB
Peak RSS:       ~0.35 GB
```

Interpretation:

- this is a real process/native failure;
- it is not an OOM-shaped failure from the observed memory values;
- ADR-0028 reduced React fanout but did not claim to eliminate Bun/OpenTUI
  native defects;
- this stage must validate the framework boundary directly.

## 3. Required Deliverables

### D1 — Runtime compatibility baseline

- Bun 1.4.x minimum policy;
- exact delivered Bun version/revision recorded;
- early actionable rejection for Bun <1.4.0.

### D2 — Exact OpenTUI renderer baseline

- core/react upgraded together to one selected 0.5.x version;
- exact versions pinned;
- selected candidate and rejected fallback, if any, documented.

### D3 — Autonomous render-storm removal

- `opentui-spinner` removed from normal runtime;
- static busy indicator;
- no sub-second presentation-only animation loop.

### D4 — Render budget

- normal renderer max/target 30 FPS;
- coalescible presentation commits <=20Hz;
- Activity elapsed <=1Hz;
- safe profile available only as bounded diagnostic mitigation.

### D5 — Session UI commit scheduler

- per-Session latest-state coalescing;
- immediate Approval/Recovery/Composer state;
- terminal flush;
- lifecycle/dispose safety;
- no semantic/durable authority changes.

### D6 — Watch-mode isolation

- default `dev:cli` does not use watcher;
- explicit `dev:cli:watch` remains available.

### D7 — Stability diagnostics

- process-local technical metrics only;
- diagnostics disabled by default;
- no sensitive model/session/tool payload capture;
- no new durable Runtime Event/Session Entry.

### D8 — Real native soak harness

- real `createCliRenderer()`;
- idle/stream/churn workloads;
- same render profile as application;
- no Provider/Tool executor dependency.

### D9 — Windows native evidence

- non-watch synthetic soak passes;
- non-watch real application soak passes;
- watch secondary result recorded;
- safe profile result recorded if used.

## 4. Required Actual Delivery Report

When implementation is complete, replace/extend the sections below with actual
evidence.

### 4.1 Exact runtime matrix

Record:

| Matrix | Bun | OpenTUI | Spinner/render policy | Watch | Result |
| --- | --- | --- | --- | --- | --- |
| M0 | 1.3.14 | 0.4.2 | 80ms spinner / old policy | yes | known native crash |
| M1 | TBD | 0.4.2 | old policy | no | TBD |
| M2 | TBD | selected 0.5.x | old policy | no | TBD |
| M3/M4 | TBD | selected 0.5.x | normal new policy | no | TBD |
| M5 | TBD | selected 0.5.x | normal new policy | yes | TBD |
| M6 | TBD | selected 0.5.x | safe profile | no | optional/TBD |

Do not infer an untested matrix cell.

### 4.2 Dependency changes

Record:

- Bun baseline and revision;
- selected `@opentui/core` version;
- selected `@opentui/react` version;
- whether 0.5.8 fallback was tested;
- removal of `opentui-spinner`;
- lockfile changes.

### 4.3 Render-pressure changes

Record exact before/after values:

```text
busy autonomous ticks/sec
renderer maxFps
renderer targetFps
presentation scheduler Hz
Activity timer Hz
number of production live/continuous render sources
```

### 4.4 Scheduler evidence

Record focused test counts/results proving:

- burst coalescing;
- immediate-state behavior;
- terminal flush;
- Session isolation;
- dispose/no-post-destroy writes.

### 4.5 Authority audit

Explicitly confirm whether the stage changed:

```text
Harness Run/Turn/Step semantics       expected NO
AgentLoop scheduling                  expected NO
Session Entry contracts               expected NO
Runtime Event contracts               expected NO
Session/Runtime SQLite schemas        expected NO
Provider execution/stream semantics   expected NO
Tool/Permission/Approval semantics    expected NO
Context/Compaction                    expected NO
Usage/Cost authority                  expected NO
```

Any `YES` requires separate architecture approval before DELIVERY can close.

### 4.6 Synthetic native soak evidence

For idle/stream/churn record:

- command;
- duration;
- terminal host;
- Windows build;
- runtime versions;
- profile;
- RSS warm-up/final/peak;
- commit/coalescing counters;
- result;
- crash/report identifier if failed.

### 4.7 Real application soak evidence

Record:

- non-watch command used;
- duration >=30 min;
- model interactions completed;
- ToolUse coverage;
- resize/scroll interaction performed;
- runtime/profile versions;
- whether any Bun/OpenTUI panic occurred.

### 4.8 Watch-mode evidence

Record the separate watcher result and whether reload works without being
confused with crash auto-restart.

### 4.9 Test/build evidence

Record exact final counts for:

- stability-focused tests;
- full CLI tests;
- Harness tests;
- CLI typecheck;
- Harness typecheck;
- CLI production build;
- `git diff --check`;
- OpenTUI test-renderer stress;
- native soak durations.

### 4.10 Known limitations

At minimum discuss:

- Bun/OpenTUI remain native dependencies and upstream defects are possible;
- OpenTUI 0.5.x is an actively evolving pre-1.0 line;
- passing a bounded soak is not a mathematical guarantee of infinite-session
  stability;
- safe profile is mitigation, not normal-profile proof;
- any remaining non-failing React/OpenTUI test warnings;
- terminal-host-specific behavior if observed.

## 5. Required Checkpoints

Delivery must identify commits for:

```text
S1 Baseline + Diagnostics Seam
S2 Bun Runtime Baseline
S3 OpenTUI Migration
S4 Render-Storm Removal + Commit Scheduler
S5 Watch Isolation + Stability Profiles
S6 Native Soak Harness / validation fixes
S7 Delivery closeout
```

## 6. Delivery Rejection Conditions

Do not mark Delivered if any of these is true:

- normal non-watch Windows profile still native-crashes;
- only safe mode passes;
- only `testRender()` passes;
- OpenTUI dependencies still float during the stabilization baseline;
- `opentui-spinner` still creates an 80ms normal-path render loop;
- streaming presentation remains unbounded by the commit scheduler;
- final stream state can remain pending/lost;
- watch and non-watch results are conflated;
- diagnostics capture sensitive conversation/tool/provider content;
- Session/Harness semantics were changed without separate approval;
- full regression/typecheck/build gates are not Green;
- exact Bun/OpenTUI versions are missing from the report.

## 7. Explicitly Deferred

- replacing OpenTUI with Ink/Ratatui/custom renderer;
- Inspector implementation;
- terminal UI virtualization beyond what is required for stability evidence;
- new visual animations;
- crash-report upload service;
- unrelated Harness/Provider/Session work.

## 8. Target Delivered State

```text
Bun validated baseline
      |
      v
OpenTUI exact validated version
      |
      v
event-driven renderer, max 30 FPS
      ^
      |
bounded Session UI commits <=20Hz for streaming presentation
      ^
      |
SessionController / UI projections / SessionUiStore
```

The renderer remains OpenTUI, but its workload and runtime versions are no
longer accidental or unmeasured.
