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

### D8 — Real native stress harness

- real `createCliRenderer()`;
- short idle smoke plus high-volume stream/churn workloads;
- measured pressure floors and coalescing ratios;
- same render profile as application;
- no Provider/Tool executor dependency.

### D9 — Windows native evidence

- non-watch synthetic native stress matrix passes;
- short real application smoke is recorded when practical;
- watch secondary diagnostic is recorded only when exercised;
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
| M3/M4 | 1.4.0 | 0.5.9 | normal new policy | no | native stress PASS |
| M5 | TBD | selected 0.5.x | normal new policy | yes | TBD |
| M6 | TBD | selected 0.5.x | safe profile | no | optional/TBD |

Do not infer an untested matrix cell.

### 4.1.1 S6 native stress execution — 2026-08-28

Release command:

```text
bun run tui:stress
```

Environment:

```text
Windows              10.0.26200.9168
Bun                  1.4.0
Bun revision         34cbb9a40b4bd1bd767d134a7065e66c2432a676
OpenTUI              0.5.9
render profile       normal
renderer             real createCliRenderer()
Provider/Tool calls  none (synthetic renderer pressure only)
```

The complete 20s + 45s + 45s matrix finished in `115119ms` with exit code 0.
No Bun panic, Windows access violation or `opentui.dll` crash was observed.

Measured release evidence:

| Workload | Duration | Pressure/result |
| --- | ---: | --- |
| idle | 20s | PASS; final state/commit budget/pressure validity true; RSS 70.5MB -> 79.3MB |
| stream | 45s | PASS; enforced >=100 source updates/sec and >=80% coalescing; final state and commit budget true |
| churn | 45s | PASS; 13,390 source updates, 3,453 store commits, 1,726 immediate commits, 3,943 scroll ops, 1,091 dialog ops |

Churn pressure rates were approximately:

```text
source updates       297.56/sec
immediate commits     38.36/sec
scroll operations     87.62/sec
dialog operations     24.24/sec
coalescing ratio       87.10%
RSS start/final/peak   69.3MB / 135.4MB / 159.2MB
```

All measured churn floors passed. A focused 5-second stream diagnostic also
measured `609.2 source updates/sec` with `96.9%` coalescing, confirming that the
new stress harness can drive the renderer materially faster than normal
application presentation traffic.

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

### 4.6 Synthetic native stress evidence

For idle/stream/churn record:

- command;
- duration;
- terminal host;
- Windows build;
- runtime versions;
- profile;
- RSS warm-up/final/peak;
- source updates/sec;
- commit/coalescing counters and ratio;
- scroll/dialog/immediate-state operation counts where applicable;
- pressure-floor validity;
- result;
- crash/report identifier if failed.

### 4.7 Real application smoke evidence

Record:

- non-watch command used;
- duration actually exercised;
- model/ToolUse coverage when already available;
- resize/scroll interaction performed;
- runtime/profile versions;
- whether any Bun/OpenTUI panic occurred.

If this secondary smoke is omitted because credentials/external side effects are
not appropriate, record that explicitly. It does not invalidate a Green native
pressure matrix.

Executed 2026-08-28:

```text
command            bun run dev:cli
mode               normal / non-watch
observed duration  ~41s
terminal resize    100x30 -> 72x24 -> 120x32
scroll input       PageUp sent after resize cycle
model/tool calls   not exercised; no external side effect manufactured
termination        intentional Ctrl-C
native panic       none observed
```

The final process exit code was 1 because the smoke was intentionally
interrupted with Ctrl-C; there was no preceding Bun panic, Windows access
violation or `opentui.dll` crash signature.

### 4.8 Watch-mode diagnostic evidence

If exercised, record the separate watcher result and whether reload works
without being confused with crash auto-restart. This is not a normal-profile
release gate.

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
- native stress durations and measured pressure volumes.

### 4.10 Known limitations

At minimum discuss:

- Bun/OpenTUI remain native dependencies and upstream defects are possible;
- OpenTUI 0.5.x is an actively evolving pre-1.0 line;
- passing a bounded stress matrix is not a mathematical guarantee of infinite-session
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

- normal non-watch Windows native stress profile still native-crashes;
- only safe mode passes;
- only `testRender()` passes;
- OpenTUI dependencies still float during the stabilization baseline;
- `opentui-spinner` still creates an 80ms normal-path render loop;
- streaming presentation remains unbounded by the commit scheduler;
- final stream state can remain pending/lost;
- an exercised watch diagnostic is conflated with the non-watch release result;
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
