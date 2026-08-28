# UI OpenTUI Framework Stability Delivery Contract

**Delivery state:** Delivered — normal Windows native pressure and all S7 regression gates are Green.

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

Delivered baseline:

```text
Bun minimum / validated baseline  1.4.0
Bun revision                      34cbb9a40b4bd1bd767d134a7065e66c2432a676
@opentui/core                     0.5.9 exact pin
@opentui/react                    0.5.9 exact pin
0.5.8 fallback                    not exercised; no reproducible 0.5.9 regression
opentui-spinner                   removed from normal runtime dependency graph
bun.lock                          updated with the dependency migration
```

### 4.3 Render-pressure changes

```text
busy autonomous ticks/sec       ~12.5 -> 0
renderer maxFps                 no explicit hard cap -> 30
renderer targetFps              60 -> 30
presentation scheduler          raw/unbounded -> <=20Hz normal
Activity elapsed timer          localized/bounded -> 1Hz normal
application-owned busy loop     spinner loop -> none
safe diagnostic profile         15 FPS / 10Hz / no presentation elapsed timer
```

### 4.4 Scheduler evidence

`session-ui-commit-scheduler.test.ts` is Green and proves all five required
behaviors: burst coalescing, merged latest presentation state, flush-before-
immediate ordering, terminal stream flush, and per-Session dispose/isolation.
The full CLI suite includes these checks and completed with 279/279 tests Green.

### 4.5 Authority audit

The stage diff from the delivered UI architecture foundation contains no
`packages/harness`, Server/database schema, Provider, Usage/Cost, Context/
Compaction, Permission or Approval authority implementation changes. Audit:

```text
Harness Run/Turn/Step semantics       NO
AgentLoop scheduling                  NO
Session Entry contracts               NO
Runtime Event contracts               NO
Session/Runtime SQLite schemas        NO
Provider execution/stream semantics   NO
Tool/Permission/Approval semantics    NO
Context/Compaction                    NO
Usage/Cost authority                  NO
```

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

S7 closeout executed 2026-08-28:

```text
full CLI tests              279 pass / 0 fail / 65 files / 924 expects
full Harness tests          107 pass / 0 fail / 15 files / 364 expects
CLI TypeScript typecheck    PASS
Harness TypeScript check    PASS
CLI production build        PASS; 679 modules; index.js ~8.1 MB
git diff --check            PASS
OpenTUI test-render stress  PASS within the full CLI suite
native pressure suite       PASS; 20s idle + 45s stream + 45s churn
```

The independent S7 native rerun completed with exit code 0 in `110766ms`:

```text
idle    PASS; 20s; RSS 71.7MB -> 79.6MB
stream  PASS; 45s; 27,666 updates; 614.8 updates/sec; 96.91% coalescing
churn   PASS; 45s; 13,549 updates; 301.09 updates/sec; 87.20% coalescing
churn   1,733 immediate commits; 3,964 scroll ops; 1,095 dialog ops
churn   RSS start/final/peak 70.7MB / 129.6MB / 145.2MB
```

Final state, commit budget, stress-volume and interaction-pressure assertions
were true for every applicable workload. No Bun panic, Windows access
violation or `opentui.dll` crash occurred.

### 4.10 Known limitations

- Bun/OpenTUI remain native dependencies, so upstream native defects remain
  possible; OpenTUI 0.5.x is still pre-1.0.
- A bounded pressure matrix is strong regression evidence, not a mathematical
  guarantee for an infinitely long process.
- Safe profile remains mitigation/diagnostic only; delivery is based on the
  normal profile.
- Several React/OpenTUI tests emit non-failing `act(...)` warnings. They do not
  represent native crashes and remain test-harness cleanup debt.
- Native validation was performed through the Windows PTY/terminal host used by
  DevCodex plus the real non-watch CLI smoke. Terminal-host-specific upstream
  behavior can still exist.
- Real Provider/Tool calls were intentionally not manufactured solely for a
  renderer stability test, avoiding external side effects.

## 5. Required Checkpoints

Delivery must identify commits for:

```text
S1 Baseline + Diagnostics Seam                 db0f5e9
S2 Bun Runtime Baseline                       9edaf3e
S3 OpenTUI Migration                          d9cfd3a
S4 Render-Storm Removal + Commit Scheduler    7d441ee
S5 Watch Isolation + Stability Profiles       0424909
S6 Native pressure harness / validation       ba9fa81
S7 Delivery closeout                          recorded by the closeout commit
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
