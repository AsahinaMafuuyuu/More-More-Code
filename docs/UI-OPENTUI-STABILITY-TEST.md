# UI OpenTUI Framework Stability Test Contract

**Status:** Approved test contract — implementation not started.

**Date:** 2026-08-27

**Design:** `docs/UI-OPENTUI-STABILITY-DESIGN.md`

**Plan:** `docs/UI-OPENTUI-STABILITY-PLAN.md`

**ADR:** `docs/decisions/0029-opentui-native-renderer-stability-and-render-budget.md`

## 1. Test Purpose

This contract validates two layers separately:

1. MORE-MORE-CODE does not create avoidable OpenTUI render pressure;
2. the selected Bun/OpenTUI native stack survives the defined Windows workload.

The second requirement cannot be inferred from the first.

## 2. Baseline Failure Contract

Known pre-stage environment:

```text
Bun 1.3.14
OpenTUI 0.4.2
80ms spinner
Windows 11 x64
native segmentation fault with opentui.dll frames
```

The existing user crash is the accepted Red native baseline. Repeatedly
crashing the old version is not required.

## 3. Runtime Compatibility Unit Tests

Test pure version policy:

```text
1.3.14   -> rejected
1.3.99   -> rejected
1.4.0    -> accepted validated family
1.4.x    -> accepted family
newer    -> accepted but identified as outside exact delivered baseline
invalid  -> fail closed with actionable error
```

The test must not instantiate OpenTUI.

## 4. Render Profile Unit Tests

Normal profile must resolve to:

```text
targetFps             30
maxFps                30
projectionCommitHz    20
activityElapsedMs     1000
animateBusyIndicator  false
```

Safe profile must resolve to:

```text
targetFps             15
maxFps                15
projectionCommitHz    10
activityElapsedMs     disabled
animateBusyIndicator  false
```

Unknown profile configuration must fail closed instead of silently selecting a
more aggressive renderer profile.

## 5. Busy Indicator Tests

Prove the normal busy indicator:

- contains no timer;
- contains no direct renderer reference;
- contains no `requestRender()`/`requestLive()`;
- reacts only to passed presentation state;
- preserves mode/theme semantics.

Architecture source audit must show `opentui-spinner` is absent from the final
normal dependency graph.

## 6. Session UI Commit Scheduler Unit Tests

Use a deterministic fake clock.

### 6.1 Coalescing

Given 100 Conversation patches inside one 50ms window:

- no more than one store notification is emitted for that window;
- the committed value equals patch 100;
- no intermediate semantic authority is created.

### 6.2 Multi-slice merge

Conversation + Activity + Status changes in one period produce one combined
store update with the latest value of each slice.

### 6.3 Immediate state

Approval/Recovery/Composer-runtime commits are not delayed behind the 50ms
presentation timer.

### 6.4 Ordering

When an immediate state must follow pending visible data, verify:

```text
pending presentation flush
-> immediate state commit
```

### 6.5 Terminal flush

Simulate a stream whose last text chunk arrives just before completion. The final
Conversation text must be in the store before/with the terminal presentation;
no final chunk may remain pending.

### 6.6 Lifecycle

- one timer maximum;
- dispose clears timer;
- dispose is idempotent;
- post-dispose enqueue is a no-op/fail-safe per API contract;
- store destroy is never followed by a write;
- two Session schedulers are isolated.

## 7. React/Selector Integration Tests

Extend existing render-isolation probes.

### Streaming burst

Feed projection updates faster than the scheduler limit.

Expected:

```text
controller/runtime semantic updates: unchanged/unbounded by UI scheduler
Conversation store/render updates:    <= configured UI commit rate
Activity unrelated renders:           +0 unless Activity data changes
Status unrelated renders:             +0 unless Status data changes
```

### Editor typing

Editor input remains immediate/local and does not wait for the streaming
presentation scheduler.

### Approval

Approval UI becomes visible without waiting for a coalescing frame.

## 8. Renderer Configuration Audit

Final production path must prove:

- `createCliRenderer` receives normal profile FPS limits;
- `renderer.start()` is not called on normal startup;
- no default `requestLive()` is used by busy/status UI;
- renderer destruction still occurs only through existing safe lifecycle paths;
- any live-render request introduced by dependencies/components is documented.

## 9. OpenTUI Upgrade Compatibility Tests

After selecting the 0.5.x pair, rerun all tests touching:

- renderer creation;
- React test renderer;
- ScrollBox/manual scroll;
- terminal dimensions;
- textarea/input;
- keyboard layers;
- dialogs;
- ToolUse;
- Activity;
- SessionWorkspace;
- renderer destroy.

Any changed behavior must be classified as:

```text
intentional upstream-compatible migration
project regression
upstream regression
```

Do not silently rewrite behavior simply to satisfy the new version.

## 10. Watch Script Tests

Audit root scripts:

```text
dev:cli        -> no --watch
dev:cli:watch  -> explicit --watch
```

The normal soak must never invoke the watch script.

## 11. Stability Probe Privacy Tests

Probe snapshots may contain technical values only.

Explicitly reject/avoid fields such as:

```text
prompt
messages
toolInput
toolOutput
providerPayload
credential
apiKey
fileContent
commandText
```

Diagnostics must be off by default and create no Session Entry or Runtime Event.

## 12. Test Renderer Stress

Keep and strengthen the existing OpenTUI test-renderer stress coverage.

At minimum cover:

- repeated SessionWorkspace mount/destroy;
- Conversation update bursts;
- ToolUse state transitions;
- Activity updates;
- normal/safe profile configuration;
- widths 60/72/100/120/160;
- heights 20/24/30/40;
- manual scroll preservation.

This remains a deterministic regression test, not the native release gate.

## 13. Real Native Soak Test

The soak entrypoint must use real `createCliRenderer()` and the selected native
OpenTUI package.

### 13.1 idle

Duration: 10 minutes.

Pass:

- process remains alive;
- no Bun panic;
- no native access violation;
- Activity elapsed remains functional in normal profile;
- no autonomous busy animation counter exists.

### 13.2 stream

Duration: 15 minutes.

Synthetic source produces data faster than 20Hz.

Pass:

- visible final content is correct;
- scheduler reports coalescing;
- no native panic;
- no lost final stream state;
- user-interaction surfaces remain responsive.

### 13.3 churn

Duration: 15 minutes.

Pass:

- repeated renderable/component replacement survives;
- no deterministic destroy/use-after-destroy symptom;
- no native panic;
- scroll/focus behavior remains valid.

## 14. Real Application Soak

Mandatory on Windows 11 using normal non-watch `dev:cli`.

Minimum:

- 30 minutes;
- 3 completed model interactions;
- one ToolUse flow when feasible;
- terminal resize through narrow/medium/wide;
- manual Conversation scroll while runtime updates;
- at least one interrupt or command interaction if safe;
- no native process crash.

Record:

- Windows build;
- terminal host;
- Bun version/revision;
- OpenTUI exact versions;
- renderer profile;
- elapsed duration;
- RSS/Peak observations;
- whether watch was disabled;
- any warning/panic/crash report identifier.

## 15. Watch-Mode Secondary Test

Only after the non-watch normal profile passes:

- run `dev:cli:watch` for >=10 minutes;
- trigger one intentional reload;
- ensure a normal reload is distinguishable from an auto-restart caused by
  native crash;
- a watch-only crash is recorded separately and does not get mislabeled as a
  non-watch renderer failure.

## 16. Safe Profile Diagnostic Test

Safe profile is run only if normal still fails or as an additional confidence
check.

Pass of safe mode does **not** satisfy the stage if normal mode still crashes.

It is used to answer:

```text
Does materially reducing native frame/commit rate change the failure rate?
```

## 17. Memory/Resource Evidence

The known failure was not OOM, so memory is diagnostic rather than the primary
gate.

For each native soak record:

- warm-up RSS;
- final RSS;
- peak RSS;
- heap used where available;
- abnormal monotonic growth observations.

Do not invent a universal production-memory ceiling from one machine. A clearly
unbounded fixed-workload growth pattern is a blocker requiring investigation.

## 18. Failure Classification

Native test output must classify the first failure as:

- application-error;
- bun-panic;
- opentui-native-crash;
- watch-lifecycle-crash;
- terminal-specific.

If the process produces `Segmentation fault`, Windows access violation, or
`opentui.dll` native frames, do not downgrade it to a test warning.

## 19. Required Final Commands

```text
bun test packages/cli/tests
bun run --filter @more-more-code/harness test
bunx tsc --noEmit -p packages/cli/tsconfig.json
bunx tsc --noEmit -p packages/harness/tsconfig.json
bun run build:cli
git diff --check
```

Plus the real native soak commands documented by the implementation.

## 20. Definition of Done

The TEST contract is satisfied only when:

- Bun minimum/baseline policy passes;
- exact OpenTUI 0.5.x version is recorded;
- spinner/autonomous render storm is removed;
- streaming presentation commit rate is bounded;
- immediate UI semantics remain immediate;
- final stream state flush is proven;
- full CLI/Harness regression gates pass;
- OpenTUI test-renderer stress passes;
- real Windows idle/stream/churn native soak passes;
- real non-watch interactive application soak passes;
- warnings/limitations are recorded explicitly;
- DELIVERY contains exact evidence.
