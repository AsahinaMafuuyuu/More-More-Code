# ADR-0029: OpenTUI Native Renderer Stability and Render Budget

## Status

Accepted — implemented and validated.

## Date

2026-08-27

## Context

UI Slice 1.5 / ADR-0028 removed the previous Session-root UI orchestration and
render fanout. The resulting application architecture is intentionally
renderer-independent above the OpenTUI surface:

```text
Harness / Session / Runtime authority
  -> SessionController
  -> CLI UI projections
  -> per-Session SessionUiStore
  -> selector-subscribed surfaces
  -> OpenTUI React renderer
```

That refactor is complete, but a real Windows 11 interactive run still produced
a native process crash after roughly 48 seconds:

```text
Bun v1.3.14 Windows x64
panic(main thread): Segmentation fault
...
opentui.dll
```

The crash is not a JavaScript exception and cannot be caught by React error
boundaries or Session/runtime recovery. The process terminates inside the
Bun/OpenTUI native boundary.

The current runtime baseline is also materially behind the available upstream
stack:

```text
current project runtime observed: Bun 1.3.14
current @opentui/core:             0.4.2
current @opentui/react:            0.4.2
current busy spinner:              opentui-spinner 0.0.7
spinner dots interval:             80 ms (~12.5 ticks/sec)
renderer targetFps:                60
dev:cli:                           bun run --watch ...
```

As of 2026-08-27:

- Bun 1.4.0 is the current stable Bun release. It includes Windows crash-handler
  fixes absent from 1.3.14, but open Windows Bun segmentation-fault reports mean
  an upgrade is risk reduction, not proof that all native crashes are fixed.
- OpenTUI 0.5.9 is the newest published package. The 0.5 line is still an active
  stabilization line, so MORE-MORE-CODE must validate and exact-pin the selected
  0.5.x version rather than follow a floating range.
- OpenTUI issue #1344 documents that a render request can walk the whole
  renderable tree; a spinner that calls `requestRender()` repeatedly therefore
  creates a disproportionate full-tree render workload even when the terminal
  appears visually idle.
- OpenTUI's renderer documentation distinguishes automatic/dirty-driven
  rendering from continuous rendering. `targetFps` alone is not evidence of a
  permanent 60 FPS loop; autonomous `requestRender()` sources and high-frequency
  application updates are the primary pressure to remove or coalesce.

The architecture must therefore treat render frequency and native-renderer
validation as explicit correctness/stability constraints.

## Decision

### 1. Keep OpenTUI and preserve ADR-0028

OpenTUI remains the terminal renderer for the next stage. The SessionController,
SessionUiStore, UI projections, Command Router, Interaction Router and
SessionWorkspace introduced by ADR-0028 are retained.

This stage is a renderer/runtime stability stage, not another Harness or
application-state redesign.

### 2. Establish a validated runtime baseline

The stage will move the executable baseline from Bun 1.3.14 to Bun 1.4.x, with
1.4.0 as the initial validated target.

Rules:

- Bun `< 1.4.0` is rejected before OpenTUI renderer creation with an actionable
  diagnostic.
- the repository records the validated Bun baseline explicitly;
- a newer Bun may be tested, but the DELIVERY must state the exact version and
  revision used for the stability gate;
- upgrading Bun is not recorded as the root-cause fix unless A/B evidence proves
  it.

### 3. Exact-pin one validated OpenTUI 0.5.x pair

`@opentui/core` and `@opentui/react` must use the same exact version.

Candidate order for this stage:

1. 0.5.9;
2. 0.5.8 only if 0.5.9 has a reproducible compatibility/native regression.

The final selected version is exact-pinned in `packages/cli/package.json` and
`bun.lock`; no caret range is retained for the validated renderer pair.

### 4. Remove autonomous high-frequency spinner rendering

`opentui-spinner` is removed from the normal Session runtime path.

The running/busy indication becomes a static semantic indicator. The existing
Activity elapsed display may refresh at one-second granularity; there must be no
default 80 ms animation that exists only to make a glyph move.

Future animation may return only when it uses an explicitly budgeted renderer
contract and has separate stability evidence.

### 5. Introduce an explicit render budget

Normal profile:

```text
OpenTUI max native frame rate:        30 FPS
coalescible projection commit rate:   20 Hz maximum
autonomous Activity elapsed refresh:   1 Hz maximum
busy indicator autonomous refresh:     0 Hz
```

The renderer remains in OpenTUI automatic/on-demand mode. Production code must
not call `renderer.start()` merely to keep the screen live.

If the selected OpenTUI version exposes `maxFps`, configure it to 30 in addition
to a 30 FPS target. `maxFps` is the relevant cap for repeated immediate render
requests; `targetFps` is retained as the continuous/live-mode cadence should a
future bounded animation explicitly request live rendering.

### 6. Coalesce presentation-only streaming updates

Add a per-Session presentation commit scheduler between projection production
and `SessionUiStore` writes:

```text
SessionRuntimeBridge
  -> presentation projections
  -> SessionUiCommitScheduler
  -> SessionUiStore
```

The scheduler is not semantic authority. It only keeps the latest pending UI
patch and bounds how frequently coalescible presentation slices notify React.

Coalescible slices:

- Conversation streaming text;
- Activity progress;
- Status telemetry.

Latency-sensitive slices stay immediate:

- Composer runtime availability;
- Approval state;
- Recovery state;
- interaction-critical mode/model transitions where the current UI contract
  requires immediate feedback.

When an immediate commit arrives, pending coalesced presentation state must be
flushed first if ordering matters. When a model stream becomes terminal, the
latest pending Conversation projection must be flushed so the final UI frame is
never lost.

Destroy cancels pending work and must never write after `SessionUiStore.destroy()`.

### 7. Separate normal execution from file watching

The default development command becomes a normal one-process CLI run:

```text
npm run dev:cli
  -> bun run packages/cli/src/index.tsx
```

Watch mode remains available explicitly:

```text
npm run dev:cli:watch
  -> bun run --watch packages/cli/src/index.tsx
```

Native stability acceptance is performed without `--watch` first. Watch-mode
stability is tested only after the non-watch runtime passes.

This does not claim the watcher is the crash cause; it removes one independent
process-lifecycle variable from renderer validation.

### 8. Add renderer diagnostics without new durable authority

An opt-in process-local stability probe may collect only technical counters:

- Bun version/revision;
- selected OpenTUI version;
- renderer profile;
- UI-store commit counts by slice;
- coalesced commit counts;
- Activity tick count;
- OpenTUI scheduler state when the selected public API supports it;
- process RSS/heap/native-memory observations at low frequency;
- elapsed runtime and terminal dimensions.

It must not capture prompts, messages, Tool inputs/outputs, file contents,
credentials or provider payloads.

No crash report is uploaded automatically.

### 9. Real Windows native stress is a release gate

`testRender()` remains useful but is insufficient to close this stage.

The final gate requires actual `createCliRenderer()` execution on Windows 11 in
a real terminal. The primary proof is a short measured pressure matrix that
drives source updates, component replacement, immediate UI state, scrolling and
dialog lifecycle substantially faster than normal human/model interaction while
the renderer remains on the normal production profile.

Wall-clock survival by itself is insufficient: the harness must prove that a
minimum pressure volume was actually delivered and that presentation commits
still obey the designed coalescing budget. A short real-application smoke is
secondary integration confidence; a long external-model session is not a
release prerequisite for a renderer/native-boundary change.

A native `panic`, `SIGSEGV`, `opentui.dll` crash or abnormal process termination
fails the stage even if every unit/integration test is Green.

### 10. Provide a bounded safe profile only as mitigation

If the normal profile still reproduces a native crash after the validated Bun
and OpenTUI upgrades, a diagnostic safe profile may cap native rendering at 15
FPS, coalescible commits at 10 Hz and disable presentation-only elapsed timers.

Safe mode is a mitigation and diagnostic discriminator, not evidence that the
normal profile is fixed. The stage remains blocked if the documented normal
acceptance profile still crashes.

## Authority Boundaries Preserved

This decision does not change:

- Harness Run / Turn / Step semantics;
- AgentLoop scheduling;
- Session Entry kinds or topology;
- Runtime Event contracts;
- Session Store or Runtime Store schema;
- Provider request/stream semantics;
- Tool Runtime / Permission / Approval semantics;
- Context policy/compaction;
- Usage/Cost authority.

Presentation coalescing may delay a visual update by tens of milliseconds; it
must never delay or reorder durable writes or external side effects.

## Rejected Alternatives

### Replace OpenTUI immediately

Rejected for this stage. ADR-0028 now provides enough separation to change the
renderer later if required, but the user has chosen to retain OpenTUI and first
stabilize the current framework.

### Treat Bun 1.4.0 as a guaranteed fix

Rejected. Upstream evidence shows important fixes relative to 1.3.14, but
Windows native crash reports also exist on 1.4.0. Only local A/B and measured
native-stress evidence can close this project issue.

### Keep the 80 ms spinner and only lower `targetFps`

Rejected. OpenTUI automatic rendering is request-driven; an autonomous spinner
still creates repeated render requests and can continue walking the render tree.

### Move rendering state into Harness

Rejected. Renderer stability is a CLI/UI concern and must not contaminate
provider-independent runtime semantics.

## Consequences

- Terminal animation becomes deliberately calmer.
- Streaming display may be visually coalesced to at most 20 updates/sec while
  semantic/provider processing remains unthrottled.
- Dependency upgrades require a dedicated compatibility checkpoint and cannot be
  mixed with unrelated UI features.
- Inspector implementation is blocked until this stability stage is Delivered.
- If native crashes remain after the normal-profile gate, the project gains a
  minimal reproducible stability harness and evidence for upstream reporting
  instead of continuing speculative Session/Harness refactors.
