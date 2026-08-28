# UI OpenTUI Framework Stability Design

**Status:** Approved for next-stage implementation — planning only.

**Date:** 2026-08-27

**ADR:** `docs/decisions/0029-opentui-native-renderer-stability-and-render-budget.md`

## 1. Problem Statement

The UI Architecture Foundation is complete, but the real Windows CLI can still
terminate inside Bun/OpenTUI native code. The observed failure is a process
segmentation fault rather than a recoverable application exception.

The current architecture has already removed the largest React-level fanout,
so this stage targets the remaining framework-level instability surface:

```text
Bun runtime
  <-> OpenTUI TypeScript bindings
  <-> native opentui.dll
  <-> OpenTUI renderer scheduler
  <-> React surface commits
```

The stage must distinguish three different concepts:

1. **application render isolation** — already delivered by ADR-0028;
2. **render pressure** — how frequently the application asks OpenTUI to render;
3. **native correctness** — whether Bun/OpenTUI survives the resulting workload.

Passing item 1 does not prove item 3.

## 2. Baseline Evidence

Repository/current runtime inspection on 2026-08-27:

```text
Bun:                         1.3.14
@opentui/core:               0.4.2
@opentui/react:              0.4.2
opentui-spinner:             0.0.7
dots interval:               80 ms
createCliRenderer targetFps: 60
default dev:cli:             --watch
```

Observed real failure:

```text
Platform: Windows 11 x64
Failure:  panic(main thread): Segmentation fault
Stack/report family: repeated opentui.dll frames
Elapsed:  ~48 s
RSS:      ~0.32 GB
Peak RSS: ~0.35 GB
```

The memory values do not indicate an obvious OOM condition.

## 3. External Runtime Baseline

The implementation stage must record the final exact versions it validates.
Planning assumptions as of 2026-08-27 are:

- Bun 1.4.0 is the current stable runtime and contains Windows crash-handler
  fixes not present in Bun 1.3.14.
- OpenTUI 0.5.9 is the newest published 0.5.x package; 0.5.8 is the immediate
  fallback candidate if 0.5.9 has a project-reproducible regression.
- OpenTUI's public renderer documentation supports automatic/on-demand
  rendering, `maxFps`, `targetFps`, `idle()` and scheduler diagnostics in the
  current 0.5 line.
- OpenTUI issue #1344 documents full-tree work per render request and identifies
  autonomous spinner rendering as a material idle-cost pattern.

These upstream facts determine the test matrix; they do not establish that any
specific dependency version fixes MORE-MORE-CODE until the local Windows gate
passes.

## 4. Goals

### G1 — Keep OpenTUI

Do not replace the renderer in this stage.

### G2 — Remove avoidable render pressure

The normal Session must have no sub-second autonomous animation loop.

### G3 — Bound streaming presentation work

Provider/model streaming remains unthrottled semantically, but React/OpenTUI
presentation commits are coalesced to a terminal-appropriate rate.

### G4 — Make runtime versions reproducible

Do not diagnose native crashes against an accidental global Bun/OpenTUI version.

### G5 — Validate with the real native renderer

The stage cannot close from `testRender()` alone.

### G6 — Preserve the application architecture

No UI stability workaround may reintroduce a Session-root god component or move
runtime authority into React.

## 5. Non-Goals

- no Harness redesign;
- no Session schema change;
- no Runtime Store schema change;
- no Provider protocol change;
- no new Inspector content;
- no move to Ink/Ratatui/custom TUI;
- no automatic upstream crash-report upload;
- no arbitrary terminal animation framework;
- no broad UI visual redesign.

## 6. Target Architecture

```text
Harness / Session / Runtime authority
            |
            v
     SessionController
            |
            v
    UI projection producers
            |
            v
  SessionUiCommitScheduler  <---- render profile (normal/safe)
       |             |
       |             +---- coalesce presentation-only high-frequency patches
       v
   SessionUiStore
       |
       v
 selector React adapters
       |
       v
 SessionWorkspace surfaces
       |
       v
 OpenTUI React reconciler
       |
       v
 OpenTUI CliRenderer ---- TuiStabilityProbe (opt-in, technical counters only)
       |
       v
 native opentui.dll / terminal
```

The scheduler and diagnostics are process-local UI infrastructure. Neither is a
source of semantic truth.

## 7. Runtime Compatibility Boundary

Add a small pure/runtime module, for example:

```text
packages/cli/src/tui/runtime-compatibility.ts
```

Responsibilities:

- parse `Bun.version`;
- reject Bun versions lower than 1.4.0 before renderer creation;
- expose version/revision metadata to diagnostics;
- keep policy testable without importing OpenTUI/native code.

Expected policy:

```text
< 1.4.0    -> hard fail with upgrade instruction
1.4.x      -> validated family for this stage
> 1.4.x    -> allowed but reported as outside the exact delivered baseline
```

The final DELIVERY must state the exact Bun version/revision used for the
passing native stress matrix.

Repository metadata should record `bun@1.4.0` as the expected development
baseline, while runtime logic remains based on the explicit minimum/diagnostic
policy above.

## 8. OpenTUI Version Migration

Upgrade `@opentui/core` and `@opentui/react` together.

Candidate sequence:

```text
0.5.9
  -> focused compatibility tests
  -> full CLI tests/typecheck/build
  -> native smoke

if and only if a reproducible 0.5.9 regression exists:
0.5.8
  -> repeat the same gates
```

The selected version must be exact-pinned, for example:

```json
"@opentui/core": "0.5.9",
"@opentui/react": "0.5.9"
```

Do not leave `^0.5.x` in the final package manifest because native renderer
patches must not silently change between installs during stabilization.

## 9. Render Profile

Create an explicit pure policy module, for example:

```text
packages/cli/src/tui/render-profile.ts
```

### Normal

```ts
{
  targetFps: 30,
  maxFps: 30,
  projectionCommitHz: 20,
  activityElapsedMs: 1000,
  animateBusyIndicator: false,
}
```

### Safe diagnostic profile

```ts
{
  targetFps: 15,
  maxFps: 15,
  projectionCommitHz: 10,
  activityElapsedMs: null,
  animateBusyIndicator: false,
}
```

The safe profile may be selected through a process-local CLI/env setting, but
normal remains the delivery target.

## 10. Busy Indicator

Delete `opentui-spinner` from the normal application dependency graph.

Replace the animated spinner with a static semantic component, e.g.:

```text
● Model · running · 1.6s
```

or the existing status glyph vocabulary.

Requirements:

- no internal `setInterval`;
- no `requestRender()` loop;
- no `requestLive()`;
- visibility driven by existing Composer/Activity runtime projection;
- Theme colors remain semantic.

The Activity elapsed clock may update once per second in the normal profile.

## 11. Session UI Commit Scheduler

Create a dedicated module, for example:

```text
packages/cli/src/ui/session/runtime/session-ui-commit-scheduler.ts
```

### 11.1 Input

Accept partial `SessionUiState` presentation patches.

### 11.2 Coalescing

For Conversation/Activity/Status:

- keep only the latest pending value per slice;
- emit at most one combined store update every 50 ms in normal profile;
- never reorder within the final merged patch;
- never drop the latest state.

### 11.3 Immediate state

Approval/Recovery/Composer-runtime state is committed immediately.

If an immediate transition semantically follows pending visible data, flush the
pending coalesced patch first, then commit the immediate patch.

### 11.4 Terminal stream state

When the chat/model step reaches terminal status:

1. flush latest pending Conversation/Activity/Status projection;
2. publish terminal Composer/runtime state;
3. leave durable/model semantics untouched.

### 11.5 Lifecycle

- one scheduler per mounted SessionUiStore;
- one pending timer maximum;
- dispose cancels pending timer;
- dispose is idempotent;
- no store write after destroy;
- no global scheduler shared across Sessions.

## 12. Renderer Configuration

After the OpenTUI migration, renderer construction should use the selected
profile:

```ts
const renderer = await createCliRenderer({
  targetFps: profile.targetFps,
  maxFps: profile.maxFps,
  exitOnCtrlC: false,
});
```

Use the exact API supported by the selected 0.5.x release.

Rules:

- do not call `renderer.start()` on normal startup;
- do not request live mode for static status UI;
- if a future component calls `requestLive()`, it must own a balanced
  `dropLive()` and have focused tests;
- renderer destroy remains behind the existing safe shutdown/quiescence path.

## 13. Watch-Mode Isolation

Change root scripts to separate concerns:

```text
dev:cli       = normal runtime, no watcher
dev:cli:watch = explicit watcher
```

The real native stability suite always begins with `dev:cli`/direct Bun
execution. Only after it passes is the watch variant tested.

## 14. Stability Diagnostics

Add an opt-in `TuiStabilityProbe`, preferably under:

```text
packages/cli/src/tui/stability-probe.ts
```

It may expose a snapshot like:

```ts
type TuiStabilitySnapshot = {
  bunVersion: string;
  bunRevision?: string;
  opentuiVersion: string;
  profile: "normal" | "safe";
  elapsedMs: number;
  storeCommits: Record<string, number>;
  coalescedCommits: number;
  activityTicks: number;
  rssBytes: number;
  heapUsedBytes: number;
  terminalWidth: number;
  terminalHeight: number;
  rendererScheduler?: unknown;
};
```

Use OpenTUI public scheduler/stat APIs only. Do not monkey-patch undocumented
native methods to count frames.

Sampling must itself be low-frequency and disabled by default.

## 15. Native Stress Harness

Add a production-renderer stability entrypoint, for example:

```text
packages/cli/src/dev/tui-stability-soak.tsx
```

It must call the same `createCliRenderer()` boundary as the real CLI and mount
the real SessionWorkspace/critical surfaces with synthetic non-sensitive data.

Profiles:

### idle

- fixed Conversation tree;
- running status visible;
- no animated spinner;
- Activity normal 1 Hz elapsed refresh.

### stream pressure

- deterministic text chunks produced at a nominal 1ms interval;
- measured source pressure must remain >=100 updates/sec;
- scheduler must coalesce commits;
- ToolUse state transitions;
- Activity progress updates.

### lifecycle/churn pressure

- repeated mount/unmount or replacement of ToolUse/message groups;
- nominal source replacement interval 2ms;
- immediate Composer state churn at 25ms;
- scroll operations at 10ms;
- dialog/overlay open-close cycles at 40ms.

The harness must assert pressure floors and coalescing ratios so a timer loop
that stalls under load cannot accidentally pass only because the process stayed
alive. The harness must not call a Provider or Tool executor.

## 16. Windows Acceptance Matrix

The implementation must record evidence in this order:

```text
M0  Bun 1.3.14 + OpenTUI 0.4.2 + 80ms spinner
    known failing baseline; do not spend time forcing a new crash if existing
    user evidence is sufficient.

M1  Bun 1.4.0 + OpenTUI 0.4.2
    runtime-only discriminator.

M2  Bun 1.4.0 + selected OpenTUI 0.5.x
    dependency-only discriminator.

M3  M2 + static busy indicator + render profile + UI commit scheduler
    intended normal delivery profile.

M4  M3 without --watch
    mandatory measured native-stress release gate.

M5  M3 with --watch
    development-mode secondary diagnostic; not a release gate.

M6  safe profile
    only if normal still crashes; diagnostic mitigation, not normal success.
```

Where practical, do not mix multiple matrix transitions in one commit before
the previous checkpoint has a focused smoke result.

## 17. Failure Classification

Record failures as one of:

```text
application-error
  catchable JS/React/application failure

bun-panic
  Bun process panic without clear OpenTUI native frames

opentui-native-crash
  segmentation/access violation with opentui native frames

watch-lifecycle-crash
  only reproducible under --watch/restart

terminal-specific
  reproducible only in one host terminal
```

Do not label a native fault as an application exception merely because UI work
triggered the workload.

## 18. Escalation Rule

If M4 still crashes after the selected Bun/OpenTUI versions and render-pressure
fixes:

1. reproduce with the synthetic native stress harness if possible;
2. try the safe profile;
3. compare OpenTUI 0.5.9 vs 0.5.8 if not already isolated;
4. capture a redacted Bun crash report and minimal workload characteristics;
5. keep the stage open/blocked;
6. do not redesign Harness/Session to chase a native crash;
7. renderer replacement requires a separate ADR and user approval.

## 19. Expected Outcome

The target is not “OpenTUI can never crash.” The stage succeeds when:

- the project runs on a deliberate supported Bun/OpenTUI baseline;
- avoidable render storms are removed;
- streaming UI work is bounded;
- normal startup is watcher-independent;
- native stability has a reproducible real-renderer test surface;
- the documented Windows normal-profile native stress matrix completes without
  native panic while reaching its measured pressure floors;
- future regressions can be attributed to runtime version/render profile rather
  than an opaque monolithic UI tree.
