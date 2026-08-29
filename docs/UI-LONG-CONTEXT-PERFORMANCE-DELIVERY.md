# UI Long-Context Performance Delivery

**Status:** Delivered — 2026-08-29

Design: `docs/UI-LONG-CONTEXT-PERFORMANCE-DESIGN.md`

Test contract: `docs/UI-LONG-CONTEXT-PERFORMANCE-TEST.md`

## 1. Delivered architecture

The Session UI long-context hot path now follows stable-history + mutable-tail
semantics:

- `LocalChatRuntime` stores indexed message references and exposes only lightweight
  `messageRevision`/count/status metadata through its reactive snapshot.
- Streaming text/reasoning/tool chunks replace only the active assistant message by
  copy-on-write. They no longer deep-clone the complete history on each chunk.
- Main Conversation materialization is bounded to the latest 160 messages, with up
  to 32 additional messages used only to recover the nearest user-round boundary.
- Omitted older messages remain canonical Session history and are represented in the
  live transcript by one lightweight hidden-history marker.
- Canonical Tool Call/Result indexing is memoized from `sessionTree`; stream-only
  revisions overlay only visible/live Tool state instead of rescanning the whole
  Session path.
- Collapsed reasoning, ToolUse details and unusually large text messages avoid
  materializing hidden payloads in OpenTUI.
- Conversation `ScrollBox` enables OpenTUI viewport culling.

Primary implementation files:

```text
packages/cli/src/lib/local-chat-runtime.ts
packages/cli/src/lib/transcript-window.ts
packages/cli/src/lib/tool-use-projection.ts
packages/cli/src/lib/tool-use-view-model.ts
packages/cli/src/ui/session/runtime/session-runtime-bridge.tsx
packages/cli/src/ui/session/surfaces/conversation-surface.tsx
packages/cli/src/ui/session/workspace/conversation-pane.tsx
packages/cli/src/components/messages/bot-message.tsx
packages/cli/src/components/messages/message-text-disclosure.tsx
packages/cli/src/components/messages/tool-use.tsx
```

## 2. Deterministic long-context evidence

`packages/cli/tests/long-context-ui.test.ts` uses a 10,000-message synthetic
transcript containing roughly 3.8M ASCII characters, which is approximately a
one-million-token-class code/text history for common tokenizers.

Verified invariants:

- 400 streaming deltas preserve finalized historical object identity and mutate only
  the active assistant message path.
- Main transcript materialization remains <= `160 + 32` messages independent of the
  10,000-message source depth.
- Recent user-round boundary and latest message remain present.
- Collapsed ToolUse does not serialize hidden output.
- Collapsed reasoning never sends the full large reasoning string to OpenTUI.
- A one-million-character message is represented by a renderer preview below 20K
  characters until explicitly expanded.

Supporting local timing from the final full CLI regression run was approximately
8.7 ms for the 10K-message/400-delta structural-sharing case and 3.1 ms for bounded window
projection. These timings are supporting evidence only; correctness is gated by the
bounded-work invariants rather than wall-clock thresholds.

## 3. Verification

All required gates passed on Windows with Bun 1.4.0 / OpenTUI 0.5.9:

```text
bun test packages/cli/tests
  330 pass, 0 fail, 1116 expect calls, 73 files

bunx tsc -p packages/cli/tsconfig.json --noEmit
  pass

bun run build:cli
  pass; packages/cli/dist/index.js ~6.81 MB

bun test packages/cli/tests/long-context-ui.test.ts
  6 pass, 0 fail, 21 expect calls

bun run tui:stress
  pass; native-stress matrix elapsed 110,763 ms
```

Native renderer stress detail:

| workload | duration | source updates/s | coalescing | notable pressure | result |
| --- | ---: | ---: | ---: | --- | --- |
| idle | 20 s | 0.05 | 0% | baseline | pass |
| stream | 45 s | 569.42 | 96.64% | 25,624 source updates / 860 commits | pass |
| churn | 45 s | 293.78 | 86.97% | 3,964 scroll ops / 1,093 dialog ops | pass |

All three workloads reported `finalStateCorrect`, `commitBudgetCorrect`,
`stressVolumeCorrect` and `interactionPressureCorrect` as true. No Bun panic,
Windows access violation or OpenTUI native crash occurred in the clean run.

## 4. Scope boundary / remaining work

This stage fixes the high-frequency render/projection path. It intentionally does not
claim that opening an already enormous Session is constant-time: durable Session
hydration and some authority-level message projection still materialize the complete
Session at lower-frequency synchronization boundaries.

If true million-token Session startup/switch latency becomes measurable, the next
isolated stage should paginate/lazily hydrate `LocalSessionEntry` by `sequence` and
provide an explicit older-history browser. That work is separate from the now-bounded
streaming/render hot path and must not change Provider Context semantics.
