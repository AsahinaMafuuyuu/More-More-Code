# Context Cache & Reliable Compaction Delivery

**Status:** C1–C6 delivered and verified; temporary Provider-context recorder retained
until explicit C7 investigation closeout.

**Date:** 2026-08-29

Design:

- `docs/CONTEXT-CACHE-COMPACTION-RELIABILITY-DESIGN.md`
- `docs/PI-INSPIRED-CONTEXT-COMPACTION-DESIGN.md`

This document records the implemented Stage-C runtime contract and keeps C7 recorder
removal separate because the cache investigation has not yet been explicitly closed.

---

## 1. Approved compaction architecture

The accepted compaction direction adopts Pi Agent's useful model:

```text
complete Session history
        ↓
retain recent raw Context
        ↓
compact only the older contiguous prefix
        ↓
previous checkpoint + newly compacted history
        ↓
new complete replacement checkpoint
```

MORE-MORE-CODE adds stronger execution and durability guarantees:

- Session Tree remains the complete semantic authority;
- compaction never deletes canonical history;
- retained recent context is token-budget-aware rather than message-count-based;
- normal compaction boundaries use complete Model Cycles;
- Tool Call/Result semantics are atomic through the complete Tool Batch barrier;
- compaction never occurs while a Tool Batch is partially running;
- Tool pressure schedules one safe compaction plan and releases only enough old
  history to reach the target instead of compacting every eligible Turn;
- repeated compaction reduces the previous accepted checkpoint together with only
  newly compacted history;
- Checkpoint V2 is structured, provenance-bearing and machine-verifiable;
- Required Context Anchors protect current goal, hard constraints, unresolved
  failures, pending work and critical artifact state;
- invalid semantic output enters deterministic priority-aware fallback;
- if P0 state cannot be preserved at true overflow, execution fails explicitly rather
  than persisting a known-corrupt checkpoint;
- accepted checkpoint is committed, rehydrated and verified before the next Provider
  side effect;
- each accepted compaction creates one explicit Context Cache Epoch transition.

Approved high-level execution order:

```text
Model Loop N
    ↓
Assistant output
    ↓
Tool Batch N
    ↓
all Tool calls terminal + durable
    ↓
optional CompactionPlan
    ↓
reduce -> validate -> commit -> rehydrate
    ↓
Context Epoch transition
    ↓
Model Loop N+1
```

---

## 2. Approved cache behavior

Inside one Context Epoch, Provider-visible history is append-only.

```text
Epoch 7
  Model output
  + Tool Batch A
  + Tool Batch B
  + Tool Batch C
  = append-only Provider prefix growth

Compaction
  = intentional prefix rebase

Epoch 8
  checkpoint + retained raw tail
  + later append-only cycles
```

The permanent observability model is expected to expose three different identities:

```text
CacheFamilyId
ContextEpochId
RenderedPrefixDigest
```

This is required so a low Provider cache hit can be classified as one of:

- expected cold start;
- expected compaction epoch rebase;
- Tool definition/cache-family change;
- Provider setting change;
- TTL/routing/cold-cache behavior;
- unexpected same-epoch rendered-history mutation.

---

## 3. Approved Compaction UI contract

Compaction is runtime work and must be visible while it is happening. It must **not**
be represented as a fake assistant/user message.

Approved lifecycle:

```text
compaction.planned
compaction.reducing
compaction.validating
compaction.fallback       optional
compaction.committing
compaction.rebased
compaction.completed

terminal alternatives:
compaction.aborted
compaction.failed
```

Recommended live row progression:

```text
Context compaction starting…
  ↓
Summarizing older context…
  ↓
Validating checkpoint…
  ↓
Applying checkpoint…
  ↓
Context compacted · 101.9k → 72.4k · epoch 4 → 5
```

Fallback:

```text
Semantic compaction incomplete · validating deterministic fallback…
```

Rejected candidate:

```text
Context compaction aborted · required state could not be preserved
```

UI constraints:

- one transient Activity/runtime row is updated by lifecycle phase;
- lifecycle changes, not token/timer ticks, drive rendering;
- no global animation loop is introduced;
- success text is emitted only after accepted durable checkpoint commit;
- the Context bar displays the real post-compaction effective usage rather than
  resetting to zero;
- automatic compaction between Tool Batch completion and next Provider request remains
  visibly distinct from Tool and model-thinking activity.

This UI contract is now delivered. Compaction uses the existing single Active Runtime
row and progresses through starting/reducing/validating/fallback/applying/rebased or
abort/failure states without creating chat messages. Once Provider streaming begins,
the terminal compaction state yields back to Thinking/Responding activity.

---

## 4. Temporary exact Provider-context recorder — delivered now

To diagnose cache invalidation with exact evidence, a temporary opt-in capture path is
now wired immediately before every logical Provider network side effect.

Delivered files:

```text
scripts/dev-cli-record-provider-context.ts
packages/cli/src/lib/provider-request-recorder.ts
packages/cli/src/lib/native-provider-executor.ts
package.json
```

### 4.1 Start the CLI with recording enabled

```text
bun run dev:cli:record-context
```

This launcher sets:

```text
MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT=1
```

Normal `bun run dev:cli` does not enable the recorder.

Optional custom local destination:

```text
MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR=<absolute local directory>
```

Default destination:

```text
~/.more-more-code/diagnostics/provider-context/<timestamp>-pid-<pid>/
```

### 4.2 Files written per logical Provider request

```text
000001-<protocol>-<model>.request.json
000001-<protocol>-<model>.meta.json
manifest.jsonl
```

`*.request.json` contains the **exact JSON string passed to `fetchProvider()`**. It is
not reserialized for presentation, so request-order/serialization differences remain
observable.

`*.meta.json` / `manifest.jsonl` contain:

- request sequence and timestamp;
- Provider/provider kind/protocol/model;
- primary cache-identified vs auxiliary request classification;
- `PromptPrefixIdentity` when available;
- cache retention mode;
- exact wire body SHA-256 and byte count;
- system-prompt SHA-256;
- complete native message-array SHA-256;
- complete Tool-definition-array SHA-256.

The request body therefore provides the complete Provider-visible context, while the
metadata makes adjacent requests inexpensive to compare before opening multi-megabyte
payloads.

### 4.3 What it captures

The hook is placed in the native Provider executors after Provider-specific request
body construction and before `fetchProvider()`.

Therefore it records requests for:

- OpenAI Responses;
- Anthropic Messages;
- OpenAI-compatible / DeepSeek Chat Completions;
- Google Generative AI;
- auxiliary Provider calls routed through the same native executor, including
  compaction reducer calls.

It records one snapshot per **logical Provider invocation**. Internal HTTP retry
attempts are not duplicated because they reuse the same serialized payload; cache
analysis should compare logical context transitions rather than identical transport
retries.

### 4.4 Safety / privacy behavior

The recorder intentionally contains complete model context and can therefore include:

- private source code;
- user prompts;
- Tool inputs and outputs;
- project/global instructions;
- compaction reducer source context.

For that reason:

- recording is opt-in;
- files are outside the repository by default;
- request authorization headers are never recorded;
- API keys/Credential Store values are never intentionally serialized into the
  diagnostic record;
- when recorder mode is enabled, capture is fail-closed: failure to persist the local
  request body blocks the corresponding Provider call, ensuring the investigation has
  no invisible/unrecorded request;
- the ordinary runtime stays capture-free.

---

## 5. How the recorder should be used for cache diagnosis

Recommended workflow:

```text
Request N meta
  ↓
compare systemSha256
compare toolsSha256
compare messagesSha256
compare prefix identity
compare wire sha256
  ↓
only if changed unexpectedly
  ↓
diff N.request.json vs N+1.request.json
```

Expected Tool continuation:

```text
old prefix unchanged
+ new Tool Result suffix
+ next Model input suffix
```

Expected compaction:

```text
old Epoch wire prefix
        ↓
intentional checkpoint rebase
        ↓
new Epoch wire prefix
```

Unexpected defect:

```text
same CacheFamily
same ContextEpoch
no intended historical rewrite
but old request prefix differs
```

The exact request captures are specifically intended to identify which message, Tool
Result, reasoning payload, Tool schema or serialization boundary caused that change.

---

## 6. Stage-C implementation status

C1–C6 were implemented in staged order so cache identity, Provider request semantics
and durable compaction authority were never cut over as one unverified change.

### C1 — Diagnostics — **delivered**

- permanent `CacheFamilyId`, `ContextEpochId`, `RenderedPrefixDigest`;
- cache-hit / family-change / epoch-rebase / same-epoch-prefix-mutation /
  Provider-miss / insufficient-telemetry classification;
- append-only Tool-continuation fixtures;
- temporary exact request recorder remains available for C7 investigation evidence.

### C2 — Provider cache controls — **delivered**

- capability-aware OpenAI cache controls/breakpoints;
- Anthropic cache policy cleanup;
- Provider-gated Tool availability optimizations only where safety is enforced.

### C3 — Pi-inspired Compaction Plan + Checkpoint V2 — **delivered**

- recent raw suffix selection;
- old contiguous prefix selection;
- Model Cycle / Tool Batch aware cut points;
- split-group escape hatch;
- structured checkpoint/provenance/anchors;
- V1 read compatibility.

### C4 — Validator + reliable deterministic fallback — **delivered**

- strict structured reducer output parsing;
- known-source provenance validation;
- Required Context Anchor coverage validation;
- priority-aware deterministic fallback;
- no arbitrary durable `[summary truncated]` tail-truncation path;
- P0 preservation or explicit abort/failure;
- repeated checkpoint chaining regression coverage.

### C5 — Transactional V2 cutover + Runtime Activity — **delivered**

```text
plan -> reduce -> validate -> commit -> rehydrate -> Provider
```

- remove arbitrary tail truncation as a durable fallback;
- durable authority must return the accepted checkpoint after commit;
- source digest, plan identity and compacted/retained membership are revalidated;
- Provider request is compiled from rehydrated durable state;
- corrupted rehydration fails closed before Provider execution;
- real SQLite close/reopen fixture verifies checkpoint continuation after restart;
- Compaction Runtime Activity lifecycle is wired without Session-message pollution.

### C6 — Policy wiring + closeout verification — **delivered**

- soft/hard thresholds;
- recent raw-tail token target;
- minimum epoch progress;
- checkpoint budget;
- Provider-specific cache breakpoint/retention policy.

The final policy remains Harness/profile-owned rather than Provider-owned. Tool pressure
uses its measured excess to compact only enough oldest complete history to restore
target headroom.

### C7 — Remove temporary full-context recorder

The recorder is not intended to become a permanent feature.

Removal requires:

```text
delete scripts/dev-cli-record-provider-context.ts
delete packages/cli/src/lib/provider-request-recorder.ts
remove recordProviderRequestContext calls from native-provider-executor.ts
remove dev:cli:record-context from package.json
remove/retire temporary recorder tests and docs
delete local full-context capture directories when no longer needed
```

Permanent diagnostics retain only bounded hashes, token/cache usage and miss
classification.

---

## 7. Delivery / verification gates

C1–C6 cache+compaction runtime delivery is complete because:

- Tool-heavy Provider history remains append-only inside one Context Epoch;
- serial/parallel Tool batches produce deterministic Provider ordering;
- Compaction never runs inside an incomplete Tool Batch;
- Pi-inspired source selection retains recent raw context and compacts only an older
  contiguous prefix under normal conditions;
- Tool Call/Result pairs are never split by normal compaction;
- Required Context Anchor tests preserve P0 state through repeated compactions;
- candidate -> durable commit -> rehydrate -> Provider equivalence is verified;
- first request after compaction is classified as expected `epoch-rebase`;
- subsequent same-epoch requests return to append-only cache behavior;
- Compaction UI lifecycle is stable under native OpenTUI stress;
- temporary full-context diagnostics can explain any same-epoch request mutation;
- CLI/Harness tests, typechecks and production build pass;
- `git diff --check` passes;
- the temporary recorder remains explicitly isolated behind C7 and has **not** been
  removed prematurely.

Full investigation closeout is a later C7 action and additionally requires removing
the recorder/code/scripts and deleting any local sensitive capture directories.

---

## 7.5 Final C1–C6 verification — 2026-08-29

The completed runtime stage passed the following gates:

```text
focused Stage-C cache/context/compaction/provider/durability/UI tests
  74 pass, 0 fail

full Harness test suite
  130 pass, 0 fail, 566 expect calls, 17 files

full CLI test suite
  343 pass, 0 fail, 1167 expect calls, 75 files

bunx tsc -p packages/cli/tsconfig.json --noEmit
  pass

bun run build:cli
  pass; bundled 646 modules, output ~6.86 MB

bun run tui:stress
  pass; native OpenTUI 0.5.9 matrix:
    idle 20s
    stream 45s
    churn 45s
  churn: ~305 source updates/s, 87.4% coalescing,
         4021 scroll operations, 1097 dialog operations
  final state / commit budget / stress volume / interaction pressure: pass

git diff --check
  pass
```

The full test run still prints the project's existing React `act(...)` warnings in
several renderer tests; they are warnings only and the affected tests pass.

Recorder-specific tests verify:

- disabled mode writes nothing;
- enabled mode preserves exact request bytes;
- metadata/manifest files are created;
- credential material from the model auth object is not serialized.

Additional reliability regressions verify:

- P0 constraint and pending-work anchors survive 20 consecutive checkpoint
  replacements;
- automatic compaction lifecycle ordering is
  `started -> starting -> reducing -> validating -> applying -> rebased -> completed`;
- lifecycle events contain bounded diagnostics rather than raw compaction context;
- rejected Session commit, corrupted persisted source digest and altered durable
  compacted/retained membership all fail closed with zero primary Provider calls;
- a real SQLite restart rehydrates Checkpoint V2 and can continue into a second
  checkpoint generation.

---

## 8. Current delivery statement

As of 2026-08-29:

**Delivered (C1–C6):**

- permanent cache family / epoch / rendered-prefix diagnostics and miss classification;
- capability-aware Provider cache-control compilation;
- Pi-inspired Model Cycle-aware source selection and token-aware recent raw tail;
- content-addressed Compaction Plan + structured Checkpoint V2;
- Required Context Anchors, strict validation and priority-aware deterministic fallback;
- transactional `plan -> reduce -> validate -> commit -> rehydrate -> Provider` cutover;
- durable checkpoint digest/plan/membership verification and restart continuation;
- Compaction Runtime Activity UI in the single transient active row;
- policy wiring, focused/full regressions, typechecks, production build and native
  OpenTUI stress verification;
- temporary exact Provider-request recorder and diagnostic launcher retained for the
  still-open investigation.

**Deferred only:**

- C7 final removal of the temporary full-context recorder, its launcher/tests/docs and
  locally captured sensitive context, after the user explicitly closes the cache
  investigation.

No C1–C6 item remains intentionally unimplemented at this delivery checkpoint.
