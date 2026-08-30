# Pi-Inspired Context Compaction Design

## Status

Accepted design baseline and implemented Stage-C runtime contract. C1–C6 are now wired
and verified: recent raw-tail selection, Model Cycle-aware plans, Checkpoint V2,
Required Context Anchor validation, priority-aware fallback, transactional durable
commit/rehydrate Provider execution, cache-epoch diagnostics and Compaction Runtime
Activity. The temporary Provider-request diagnostic recorder remains installed only
because its explicit C7 investigation-closeout gate has not been requested.

Main architecture: `docs/CONTEXT-CACHE-COMPACTION-RELIABILITY-DESIGN.md`

Delivery contract: `docs/CONTEXT-CACHE-COMPACTION-RELIABILITY-DELIVERY.md`

Reference philosophy: Pi Agent's public compaction design keeps a configurable
recent raw tail, summarizes the older prefix, reuses the previous compaction
summary on later compactions, preserves full session history, and treats branch
summarization as a separate navigation concern. This document adapts those ideas
to MORE-MORE-CODE rather than cloning Pi's implementation literally.

## Goal

Define a reliable Context Compaction architecture for MORE-MORE-CODE by adopting
the useful principles from Pi Agent while preserving this project's stronger
requirements around Session authority, Tool Batch barriers, Provider cache
stability, crash durability, and deterministic diagnostics.

The design must answer four questions:

1. **When do we compact?**
2. **What exact history do we compact and what do we keep raw?**
3. **How do we know the checkpoint is safe enough to become durable state?**
4. **How does compaction intentionally transition Provider cache state?**

---

## 1. Pi Agent concepts worth adopting

Pi's compaction model is intentionally simple:

```text
context grows
   ↓
approach effective limit
   ↓
keep a recent raw tail
   ↓
summarize the older prefix
   ↓
append a compaction entry
   ↓
rebuild future context as:
summary + retained recent messages + new messages
```

The important ideas are not the exact default numbers, but the boundaries.

### 1.1 Preserve recent raw context

Pi does not try to summarize the whole conversation. It walks backwards from
the latest work and keeps approximately a configured recent-token budget raw.
Only the older prefix is summarized.

This is valuable because the newest context contains the highest-density state:

- current implementation details;
- recent Tool observations;
- unresolved errors;
- the exact active user request;
- recent file edits and test results.

### 1.2 Compaction is a context projection, not history deletion

Pi preserves the full session history and appends a `CompactionEntry` describing
the replacement summary and retained boundary.

MORE-MORE-CODE should preserve the same invariant:

```text
Session Tree = complete semantic authority
Compaction   = model-facing context optimization
```

Compaction must never mutate or delete canonical user/model/tool history.

### 1.3 Previous summary is reduced with newly compacted history

Repeated compaction should not repeatedly summarize the complete session from
the beginning. The previous effective checkpoint is fed into the next reduction
along with only newly compacted history.

Conceptually:

```text
Checkpoint N
    +
newly compacted prefix after N
    ↓
Checkpoint N+1
```

The result is a complete replacement snapshot, not a chain of summary deltas.

### 1.4 Cut points respect interaction structure

Pi does not cut blindly at arbitrary token offsets. It searches valid message
boundaries and has explicit handling when a very large Turn must be split.

The key principle for MORE-MORE-CODE is:

> Never split a Tool Call from the Tool Results required to interpret it.

Normal compaction should prefer complete semantic groups. Split-Turn handling is
an escape hatch for exceptionally large Turns, not the default behavior.

### 1.5 Summarizer input is intentionally bounded

Pi serializes the conversation into summarizer-oriented text and truncates very
large Tool Result bodies before sending them to the summarizer. The canonical
session still retains the complete Tool output.

MORE-MORE-CODE should use the same separation:

```text
Canonical Tool Result          complete
Provider working-set result    stable bounded projection
Compaction reducer input       bounded summarizer projection
```

These are three different representations with three different responsibilities.

### 1.6 Structured summary beats chronological recap

Pi's summary format prioritizes:

- Goal;
- Constraints;
- Progress;
- Key Decisions;
- Next Steps;
- Critical Context;
- read/modified files.

The transferable principle is that a coding-agent checkpoint should describe
**current executable state**, not narrate conversation history.

---

## 2. MORE-MORE-CODE adaptation

Pi's philosophy is useful, but MORE-MORE-CODE needs stronger guarantees in four
areas:

1. Tool execution has an explicit complete Batch barrier.
2. Session Tree is local durable authority.
3. Prefix-cache stability is a first-class invariant.
4. A lossy/invalid LLM summary must not silently become trusted durable state.

Therefore the target model is:

```text
Model Loop N
   ↓
Assistant output
   ↓
Tool Batch N
   ↓
ALL Tool calls terminal + durable
   ↓
Compaction eligibility check
   ↓
optional Compaction transaction
   ↓
Model Loop N+1
```

Compaction is forbidden while any Tool call from the current model output is
still running.

---

## 3. Trigger policy

### 3.1 Use the effective input budget, not the nominal model window

Define:

```text
effectiveInputBudget
  = contextWindow
  - reservedOutputTokens
  - safetyMarginTokens
  - fixed system/instruction overhead
```

All compaction ratios are evaluated against this effective budget.

The UI must display this same denominator when communicating pressure.

### 3.2 Automatic triggers

Recommended triggers:

```text
soft-limit
hard-limit
tool-pressure
overflow
```

Recommended semantics:

- `soft-limit`: compact only when projected gain is meaningful;
- `hard-limit`: compact aggressively enough to restore safe headroom;
- `tool-pressure`: only after the current Tool Batch barrier; compact enough
  historical context to relieve pressure, not all compactable history;
- `overflow`: mandatory recovery path when a safe checkpoint can be produced.

### 3.3 Manual `/compact`

Manual compaction reuses the same plan/reducer/validator/commit pipeline.

It may bypass utilization thresholds but must not bypass:

- minimum compactable-history gates;
- complete-group rules;
- retained-current-context rules;
- checkpoint validation;
- branch isolation;
- durable commit ordering.

### 3.4 Hysteresis

Do not compact repeatedly around one threshold.

After compaction, target a substantially lower utilization, for example:

```text
soft trigger      ~80%
hard trigger      ~92%
target after compaction ~65-72%
```

Exact ratios remain profile policy and should be tuned from telemetry.

---

## 4. Source-selection policy

### 4.1 Keep a recent raw tail

Borrow Pi's `keepRecentTokens` philosophy, but adapt it to semantic groups.

Selection algorithm:

1. start at newest Context group;
2. walk backwards;
3. retain complete groups until the retained-tail target is satisfied;
4. summarize only the older contiguous prefix.

The retained target should be bounded by both:

```text
minimum recent token target
and
effective budget ratio
```

This prevents a fixed 20k-style tail from being too small on a 1M-token model or
too large on a small-context model.

### 4.2 Semantic group hierarchy

Preferred atomic groups:

```text
Interaction Round
  └─ Model Cycle
      ├─ Assistant output
      ├─ Tool Batch
      │   ├─ Tool Call A -> Tool Result A
      │   ├─ Tool Call B -> Tool Result B
      │   └─ Tool Call C -> Tool Result C
      └─ continuation boundary
```

Normal cut points should prefer Model Cycle boundaries rather than only user-turn
boundaries. This fixes the current problem where one very long user Turn can make
almost all useful history "required" and therefore non-compactable.

### 4.3 Split-Turn escape hatch

Pi allows a cut inside a Turn when necessary. MORE-MORE-CODE should support a
stricter version only when one semantic Turn itself is too large to leave usable
headroom.

Rules:

- never cut between a Tool Call and its terminal Tool Result;
- never cut inside an active Tool Batch;
- preserve the suffix raw;
- summarize only the prefix;
- explicitly mark the checkpoint as `splitGroup=true`;
- preserve a source boundary ID so the retained suffix is auditable.

---

## 5. Compaction reducer input

The semantic reducer should not consume canonical Tool payloads without bounds.

Reducer-source projection:

```text
User text                      full unless individually pathological
Assistant text/reasoning       bounded but semantics-preserving
Tool Call                      name + relevant input
Tool Result                    strategy-aware bounded projection
Previous checkpoint            full effective checkpoint
Branch summary                 explicit tagged state
```

For Tool Results, preserve high-value regions by Tool type:

- file read: path + selected head/tail/relevant ranges;
- grep/search: file + line + bounded matches;
- test/build: failures/errors/warnings + exit status;
- shell: exit status + error-bearing lines + useful head/tail;
- generic: deterministic bounded serialization.

This is analogous to Pi truncating large Tool outputs before summarization, but
uses MORE-MORE-CODE's existing strategy-aware Tool projection rather than one
universal character slice.

---

## 6. Checkpoint format

Pi's structured summary philosophy should be retained, but the canonical
checkpoint should be machine-verifiable rather than free-form Markdown only.

Recommended V2 shape:

```ts
type CompactionCheckpointV2 = {
  version: 2;
  sourceDigest: string;
  trigger: ContextCompactionTrigger;
  compactedThroughRecordId: string;
  retainedFromRecordId: string | null;
  splitGroup: boolean;

  state: {
    currentGoal: CheckpointFact[];
    currentState: CheckpointFact[];
    constraints: CheckpointFact[];
    decisions: CheckpointFact[];
    artifacts: CheckpointFact[];
    failuresAndLessons: CheckpointFact[];
    pendingWork: CheckpointFact[];
  };

  requiredAnchorIds: string[];
  coveredAnchorIds: string[];
  renderedSummary: string;
};

type CheckpointFact = {
  text: string;
  sourceRecordIds: string[];
};
```

The Provider sees deterministic Markdown rendered from `state`. The Session
stores the structured state plus source provenance.

---

## 7. Validation before durability

Pi explicitly acknowledges compaction as lossy. MORE-MORE-CODE should accept
that lossiness but prevent silent loss of mandatory continuation state.

Before reducer invocation, derive `Required Context Anchors` for facts that must
survive:

```text
P0
├─ current user goal
├─ explicit constraints
├─ architecture invariants
├─ unresolved failures
├─ pending requested work
├─ critical current artifact/file state
└─ Tool failures/denials/timeouts still relevant to continuation
```

After reduction, validation requires:

```text
source digest matches plan
checkpoint fits target budget
all P0 anchors covered or explicitly superseded
no orphan Tool semantics
no unknown source IDs
required sections structurally valid
```

Only then may the checkpoint become durable.

---

## 8. Fallback policy

Do not use arbitrary "serialize everything then truncate the end" as a durable
fallback.

Fallback should be deterministic and priority-aware:

```text
P0 required anchors
   ↓
P1 decisions / artifacts / failures / pending work
   ↓
P2 recent important excerpts
   ↓
P3 source references only
```

If a valid P0-preserving checkpoint cannot fit:

- soft/hard/tool-pressure: abort compaction and keep original context when still
  safe enough to continue;
- overflow: fail explicitly with `context-compaction-unrecoverable` rather than
  silently continue with corrupted state.

---

## 9. Transaction and durability

Compaction should be a transaction with an immutable plan.

```text
1. prepare CompactionPlan
2. freeze sourceRecordIds + sourceDigest
3. reduce
4. validate
5. fallback + validate if required
6. append durable compaction entry
7. rehydrate checkpoint from Session authority
8. verify digest/version/boundary
9. create new Context Epoch
10. compile Provider request
11. Provider side effect
```

The key invariant is:

```text
Provider-visible checkpoint
    ==
checkpoint accepted by Session authority
```

A crash between reduction and commit cannot cause a Provider request based on a
checkpoint that the local durable Session never accepted.

---

## 10. Cache Epoch model

Compaction necessarily changes the historical Provider prefix. Treat that as an
explicit cache transition, not an accidental cache miss.

```text
CacheFamilyId
  = provider/model/system/instructions/skills/tool definitions/mode

ContextEpochId
  = genesis | checkpoint:<compaction-entry-id>

RenderedPrefixDigest
  = digest of actual Provider-visible stable+historical prefix
```

Within one epoch:

```text
old Provider-visible history is immutable
new Model/Tool cycles append only
```

At compaction:

```text
Epoch 7
  ↓ intentional rebase
Checkpoint 8 + retained raw tail
  ↓
Epoch 8
```

The first request after compaction may be a cache cold miss. Subsequent requests
should again reuse the new checkpoint prefix.

This makes cache-loss attribution explicit instead of treating every miss as a
Provider mystery.

---

## 11. Interaction with Tool Batches

The current Harness model is already the desired base:

```text
Model N
  ↓
Tool Calls A/B/C
  ↓
execute serially or bounded-parallel
  ↓
wait for every call in the emitted batch to become terminal
  ↓
persist all terminal facts
  ↓
optional compaction
  ↓
Model N+1
```

Compaction must never run in this invalid state:

```text
Tool A complete
Tool B running
Tool C pending
    ↓
compact now          ← forbidden
```

This preserves Tool Call/Result atomicity and prevents an unstable prompt prefix.

---

## 12. UI runtime states

Compaction is an internal runtime operation but must be visible to the user.

Do not render it as a fake assistant message. Render it as Activity/runtime
status associated with the active Model Loop boundary.

Recommended lifecycle:

```text
compaction.planned
compaction.reducing
compaction.validating
compaction.fallback       optional
compaction.committing
compaction.rebased
compaction.completed
compaction.aborted
compaction.failed
```

Suggested compact UI text:

```text
Context compaction starting…
Summarizing older context…
Validating checkpoint…
Applying checkpoint…
Context compacted · 101.9k → 72.4k · epoch 4 → 5
```

Fallback:

```text
Semantic compaction incomplete · validating deterministic fallback…
```

Abort/failure:

```text
Context compaction aborted · required state could not be preserved
```

The status bar should show actual effective usage before and after. It must not
reset the context meter to zero.

UI updates occur only on lifecycle-phase changes; no token-level animation loop
should be introduced.

### 12.5 Temporary full Provider-context capture during rollout

Before tuning cache and compaction policy, the project needs exact evidence for every
logical Provider invocation. A temporary opt-in recorder is therefore part of the
diagnostic rollout:

```text
bun run dev:cli:record-context
```

It writes the exact Provider JSON body before the network side effect under:

```text
~/.more-more-code/diagnostics/provider-context/<timestamp>-pid-<pid>/
```

Each invocation produces an exact `.request.json`, a `.meta.json` containing request
identity/cache hashes, and one `manifest.jsonl` row. The recorder captures both normal
cache-identified model requests and auxiliary Provider requests such as compaction
reduction calls.

This is intentionally temporary because the payload contains complete model-visible
context. It never records auth headers/API keys, is disabled during normal CLI runs,
and must be removed once request diffs plus permanent `CacheFamilyId` /
`ContextEpochId` / `RenderedPrefixDigest` telemetry are sufficient for diagnosis.

---

## 13. Proposed configuration

Example profile-level defaults:

```json
{
  "context": {
    "compaction": {
      "enabled": true,
      "softLimitRatio": 0.80,
      "hardLimitRatio": 0.92,
      "targetRatio": 0.70,
      "retainRecentRatio": 0.18,
      "retainRecentMinTokens": 12000,
      "maxSummaryRatio": 0.02,
      "allowSplitGroup": true
    }
  }
}
```

The ratios are policy examples, not fixed architecture constants.

---

## 14. Implementation phases

### Phase P1 — Observable planning

- introduce `CompactionPlan`;
- expose selected/retained token counts;
- expose trigger and predicted gain;
- add UI `compaction.planned` / `completed` lifecycle;
- use the temporary exact Provider-request recorder to establish before-change cache
  evidence and identify same-epoch history mutations;
- no checkpoint semantic change yet.

### Phase P2 — Better source boundaries

- replace coarse user-turn-only grouping with Model Cycle / Tool Batch aware groups;
- add strict split-group escape hatch;
- remove `tool-pressure => compact all compactable history`.

### Phase P3 — Checkpoint V2

- structured state;
- provenance;
- Required Context Anchors;
- deterministic renderer;
- V1 read compatibility.

### Phase P4 — Validation + reliable fallback

- source-digest validation;
- anchor coverage;
- priority-aware extractive fallback;
- explicit unrecoverable overflow error.

### Phase P5 — Transactional cutover

- prepare -> reduce -> validate -> commit -> rehydrate -> Provider;
- idempotent compaction identity;
- crash/restart tests.

### Phase P6 — Cache Epoch diagnostics

- `CacheFamilyId`;
- `ContextEpochId`;
- `RenderedPrefixDigest`;
- classify expected compaction rebases vs unexpected prompt mutation.

### Phase P7 — Remove full-context recorder

- remove the temporary launcher/module/native Provider hooks;
- remove `dev:cli:record-context`;
- delete retained local full-context capture files unless still explicitly needed;
- keep only bounded hashes/cache telemetry as the permanent observability surface.

---

## 15. Required tests

### Selection

- recent raw tail stays above configured minimum when possible;
- compacted source is an old contiguous prefix;
- complete Tool Call/Result groups are never split;
- one huge Turn can use split-group mode safely;
- `tool-pressure` releases only the amount of context required to reach target.

### Reliability

- semantic reducer empty output -> fallback;
- oversized reducer output -> fallback;
- missing required anchor -> fallback/reject;
- fallback cannot preserve P0 -> explicit failure;
- persisted checkpoint digest mismatch -> Provider request blocked.

### Cache

- repeated Tool continuations do not rewrite earlier Provider-visible history;
- compaction creates exactly one epoch transition;
- request after checkpoint uses the durable rehydrated checkpoint;
- next append-only request preserves the new epoch prefix.

### UI

- lifecycle states appear in order;
- compaction status does not become Session conversation content;
- aborted/fallback states are visible;
- context meter displays effective-budget before/after values;
- no high-frequency render loop is introduced.

---

## 16. Decision summary

The recommended MORE-MORE-CODE compaction model is:

```text
Borrow from Pi:
  keep recent raw context
  + summarize only old prefix
  + iterative checkpoint replacement
  + structured current-state summary
  + preserve full durable history
  + bounded summarizer Tool payloads
  + split-Turn escape hatch

Strengthen for MORE-MORE-CODE:
  Tool Batch barrier
  + semantic Model Cycle boundaries
  + checkpoint provenance
  + required-anchor validation
  + deterministic safe fallback
  + commit/rehydrate transaction
  + explicit Context Cache Epoch
  + runtime UI lifecycle
```

The core invariant is:

> **Compaction may reduce model-visible history, but it must not reduce the
> reliability of the agent's current executable state.**
