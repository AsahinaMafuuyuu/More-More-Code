# Context Cache Stability & Reliable Compaction Design

**Status:** APPROVED DESIGN + C1–C6 IMPLEMENTED/VERIFIED — 2026-08-29; C7 recorder cleanup deferred

**Date:** 2026-08-29

**Scope:** MORE-MORE-CODE local-first CLI/Harness context pipeline, Provider request
compilation, Tool continuation, prompt-cache observability, and durable compaction
checkpoint semantics.

**Companion compaction design:** `docs/PI-INSPIRED-CONTEXT-COMPACTION-DESIGN.md`

**Delivery contract:** `docs/CONTEXT-CACHE-COMPACTION-RELIABILITY-DELIVERY.md`

**Implementation note:** the problem statements below describe the pre-Stage-C baseline
that motivated this design. C1–C6 now implement the cache identities, Provider policy,
Checkpoint V2, validator/fallback, transactional commit/rehydrate cutover and Runtime
Activity UI. The temporary full-context recorder remains intentionally installed until
the user explicitly closes the cache investigation (C7).

**Supersedes:** nothing yet. If approved, this proposal should become a new ADR that
refines ADR-0010, ADR-0012, ADR-0013 and ADR-0030 without changing Session authority.

---

## 1. Problem Statement

The current implementation has already fixed one important cache-destroying behavior:
an oversized Tool Result now receives one deterministic model-facing projection on its
first exposure and is no longer rewritten merely because it becomes warm/cold
(ADR-0030).

Two larger problems remain.

### 1.1 Tool-heavy conversations still have avoidable cache resets

Prompt caches reuse a rendered prefix, not a logical conversation identity. A stable
`prompt_cache_key`/fingerprint can improve routing and identify a cache family, but it
cannot make different rendered bytes equivalent.

In the current runtime:

- `PromptPrefixIdentity` fingerprints system/instruction/skill/tool-set identity, but
  does not describe the actual rendered conversation prefix.
- PLAN/BUILD or other Tool Set changes change the actual tool definitions and therefore
  the Provider prefix.
- Tool-pressure can force Context Compaction. A compaction replaces earlier history,
  intentionally rebasing the Provider prefix.
- Cache telemetry can report a miss, but cannot reliably distinguish a Tool schema
  change, history rewrite, compaction rebase, cache TTL/routing miss, or Provider
  setting change.
- OpenAI GPT-5.6+ now supports explicit prompt-cache breakpoints and append-only tool
  management, but the current native adapter only supplies `prompt_cache_key`; it does
  not model cache breakpoints as a first-class Provider capability.

### 1.2 Current semantic compaction can commit a syntactically valid but semantically
weak checkpoint

The current semantic reducer is validated mainly by:

- non-empty output;
- output fitting the summary-token budget;
- `kind === "summary"`.

That is insufficient to prove that critical state survived.

More importantly, the current deterministic fallback serializes source records into a
text snapshot and then token-fits that snapshot. In the worst case this can become a
plain truncated text prefix with `[summary truncated]`. That preserves availability,
but it is not a sufficiently strong reliability contract for a durable replacement
checkpoint: important decisions, unresolved failures, constraints, or pending work can
be located after the truncation point.

The current compaction path also computes a candidate in memory, persists it, and then
continues with the already-built projection. Persistence is correctly awaited before
the next Provider side effect, but there is no explicit content-addressed compaction
transaction proving that the Provider request is based on exactly the accepted durable
checkpoint.

---

## 2. Design Goals

1. **Append-only cache epochs.** Between two committed compaction checkpoints, already
   Provider-visible history must never be rewritten.
2. **Tool calls should normally extend cacheable history, not destroy it.** Tool Calls
   and Tool Results remain deterministic and append-only inside a Tool Batch.
3. **Compaction is an explicit cache epoch transition.** A cache reset caused by a real
   compaction is acceptable; accidental or repeated resets are not.
4. **A durable checkpoint must be verifiable.** "Fits in N tokens" is not enough.
5. **Compaction failure must never silently claim high-quality state preservation.**
6. **Session Tree remains canonical.** Provider caches, cache breakpoints, Provider-local
   continuation IDs, and opaque Provider compaction items must not become Session
   authority.
7. **Provider-independent semantics, Provider-specific optimization.** Harness owns
   Context/Compaction semantics; adapters own cache controls.
8. **Diagnostics must explain cache misses.** The UI/runtime should be able to answer
   *why* an expected hit did not occur.

---

## 3. Non-Goals

- Do not adopt OpenAI `previous_response_id` as MORE-MORE-CODE Session authority.
- Do not adopt OpenAI/Anthropic opaque Provider compaction as the canonical checkpoint.
- Do not persist raw Provider KV-cache state.
- Do not mutate or delete canonical Tool Results.
- Do not allow cache optimization to weaken PLAN/BUILD capability boundaries,
  Permission Policy, Approval Broker, or Tool Runtime safety.
- Do not make every Provider expose identical cache controls where the Provider has no
  equivalent feature.

---

## 4. Proposed Architecture

```text
                    Canonical Session Tree
                           │
                           ▼
                 Context Projection Compiler
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
     Compaction Checkpoint V2      Active append-only tail
              │                         │
              └────────────┬────────────┘
                           ▼
                    Cache Epoch View
                           │
                           ▼
                Provider Request Compiler
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       OpenAI          Anthropic        Google/Other
   breakpoints/key    cache_control      implicit/native
```

The key change is to stop treating "cache identity" as one fingerprint. The runtime
needs three different identities because they answer three different questions.

### 4.1 `CacheFamilyId`

Stable across turns that share Provider/model/static agent contract.

```ts
type CacheFamilyId = string;

type CacheFamilyIdentity = {
  providerId: string;
  modelId: string;
  protocol: string;
  systemPromptVersion: string;
  globalInstructionsHash: string;
  projectInstructionsHash: string;
  skillCatalogHash: string;
  toolDefinitionFamilyHash: string;
  providerCachePolicyVersion: string;
};
```

This is the successor to the current `PromptPrefixIdentity` role.

It is suitable for Provider routing/grouping keys, but **not** proof of an actual cache
hit.

### 4.2 `ContextEpochId`

A Session-branch-local generation that changes only when the historical prefix is
intentionally rebased.

```ts
type ContextEpochId = {
  branchId: string;
  checkpointId: string | "genesis";
  checkpointDigest: string | null;
  policyVersion: string;
};
```

Within one epoch:

- prior message bytes are immutable;
- prior Tool Call/Result projections are immutable;
- new model/tool/user records only append;
- a later Tool Batch cannot retroactively change an earlier Tool Result projection.

### 4.3 `RenderedPrefixDigest`

Provider-adapter diagnostic identity over the *actual cacheable rendered prefix* up to
the chosen breakpoint.

```ts
type RenderedPrefixDigest = {
  digest: string;
  breakpointKind: "stable-prefix" | "tool-batch" | "conversation";
  breakpointRecordId?: string;
  estimatedPrefixTokens: number;
};
```

This is the missing diagnostic seam. If `CacheFamilyId` is unchanged but
`RenderedPrefixDigest` changes, the runtime knows the miss was caused by rendered input
mutation rather than routing/TTL uncertainty.

---

## 5. Cache-Stable Tool Protocol

### 5.1 Tool Result representation remains intrinsic and immutable

Keep ADR-0030's rule:

```text
Tool Result R
   │
   ├─ small      -> full(R)
   └─ oversized  -> deterministicBounded(R, profile)

The chosen representation never changes later inside the same Context profile.
```

No age-based re-projection and no aggregate-pressure redistribution are reintroduced.

### 5.2 One Tool Batch is one cache-extension unit

ADR-0032 already defines a complete Tool Batch barrier. Cache behavior should use the
same boundary.

```text
Model output
  -> Tool Call A
  -> Tool Call B
  -> Tool Call C
  -> execute serial/parallel internally
  -> canonical terminal results reordered to model-emitted order
  -> Batch Barrier
  -> Provider-visible Tool Results append in A/B/C order
  -> optional cache breakpoint after final result
  -> next primary Model Loop
```

Never create a cache breakpoint based on wall-clock Tool completion order.

This means parallel Tool execution does not make Provider history nondeterministic.

### 5.3 Tool availability and Tool definitions must be separated

Changing Tool definitions invalidates Provider cache prefixes on providers whose tool
definitions are part of the cached prompt. Therefore the runtime should distinguish:

```ts
ToolDefinitionCatalog  // stable definitions/schema/order
ToolAvailabilityMask   // callable in this request/mode
```

However, safety has priority over caching:

- If a Provider has a native "allowed tools" / capability-mask mechanism that truly
  prevents invocation, keep a stable ToolDefinitionCatalog and change only the mask.
- If a Provider does not have a sufficiently strong capability mask, retain separate
  PLAN/BUILD cache families rather than exposing forbidden tools for cache reuse.
- Never rely on prompt text such as "do not call write tools" as a security boundary.

### 5.4 Provider cache strategies

#### OpenAI GPT-5.6+

Preferred strategy:

- stable `prompt_cache_key` per reusable agent/user/workspace cache family;
- use GPT-5.6+ cache options instead of the legacy retention-only path;
- preserve a stable tools list when `allowed_tools` can safely restrict availability;
- add an explicit cache breakpoint after the stable reusable developer prefix when the
  request representation supports it;
- add an explicit breakpoint after the **last Tool Result of a completed Tool Batch**
  when useful for multi-turn/fork reuse;
- changing dynamic suffixes should not force a cache write when explicit-only caching
  is more economical.

OpenAI-specific request controls remain in `OpenAIResponsesAdapter` /
`native-provider-executor.ts` and never enter canonical Context records.

#### Anthropic

- Keep `tools -> system -> messages` ordering deterministic.
- Use automatic caching for the moving conversation endpoint.
- Keep an explicit stable-prefix breakpoint where useful.
- Use at most one Tool-Batch-end breakpoint rather than one per concurrently completed
  Tool.
- Do not rely on beta mid-conversation Tool changes as the canonical design; expose it
  through a provider capability flag only after targeted compatibility tests.

#### Google Gemini

- Preserve stable common content at the front and append conversation state.
- Treat implicit cache hits as Provider telemetry, not a guaranteed application state.
- Explicit CachedContent may be considered later for stable repository/reference
  corpora, but not as Session history authority.

#### DeepSeek / generic OpenAI-compatible providers

- Preserve deterministic system/tool/message ordering and append-only Tool
  continuations.
- Use Provider-reported cache hit/miss telemetry when available.
- Do not emit unsupported OpenAI-specific breakpoint fields to nominally compatible
  endpoints.

---

## 6. Compaction Checkpoint V2

The existing Markdown-only summary is too weak as the sole durable replacement state.
The proposed checkpoint is a versioned structured envelope with a derived Provider
rendering.

```ts
type CompactionCheckpointV2 = {
  schemaVersion: 2;
  checkpointId: string;
  baseCheckpointId: string | null;
  policyVersion: string;

  source: {
    recordIds: string[];
    firstRecordId: string;
    lastRecordId: string;
    sourceDigest: string;
  };

  state: {
    currentGoal: CheckpointFact[];
    currentState: CheckpointFact[];
    decisions: CheckpointFact[];
    constraints: CheckpointFact[];
    artifacts: CheckpointArtifact[];
    failuresAndLessons: CheckpointFact[];
    pendingWork: CheckpointFact[];
  };

  validation: {
    quality: "verified" | "deterministic-degraded";
    requiredAnchorIds: string[];
    coveredAnchorIds: string[];
    sourceDigestVerified: true;
  };

  renderedSummary: string;
};

type CheckpointFact = {
  id: string;
  text: string;
  sourceRecordIds: string[];
};
```

`renderedSummary` is a deterministic rendering of `state`; it is not independently
authored text.

### Why structured state matters

- malformed/missing sections become machine-detectable;
- every semantic fact can carry source provenance;
- duplicate/superseded facts can be normalized deterministically;
- restore can validate checkpoint integrity before using it;
- the UI/Inspector can explain what was compacted without parsing free-form Markdown;
- a future schema migration is explicit.

---

## 7. Compaction Plan: Prepare Before Reduce

Before any semantic reducer call, Harness creates an immutable `CompactionPlan`.

```ts
type CompactionPlan = {
  planId: string;
  branchHeadEntryId: string;
  baseCheckpointId: string | null;
  trigger: ContextCompactionTrigger;
  policyVersion: string;

  sourceRecordIds: string[];
  sourceDigest: string;
  retainedRecordIds: string[];

  inputTokensBefore: number;
  targetInputTokens: number;
  maxCheckpointTokens: number;

  requiredAnchors: RequiredContextAnchor[];
};
```

`planId` should be content-addressed/idempotent, for example:

```text
sha256(sessionId + branchHead + baseCheckpointId + sourceDigest + policyVersion)
```

The same source cannot accidentally create two semantically different durable
compactions during retry/recovery.

---

## 8. Required Context Anchors

Semantic summarization can remain model-assisted, but critical state must have an
independent preservation contract.

Before reduction, deterministic/runtime-aware extractors build bounded anchors from
facts that MORE-MORE-CODE can know without semantic guessing:

```text
user requirement records selected by Context policy
active goal / active plan markers
mode/model/tool policy invariants
artifact/file paths touched by known Tools
Tool terminal status / exit code
test/build failure signatures
unresolved errors
unconsumed pending work represented by durable state
previous checkpoint facts that remain explicitly required
```

Anchors are not another Session authority. They are compaction-validation inputs that
reference canonical Session records.

The reducer must return every `requiredAnchorId` either:

1. represented by a checkpoint fact; or
2. explicitly marked superseded with evidence pointing to a later source record.

A candidate with missing required anchors is invalid even if it fits the token budget.

For unstructured user requirements that cannot be deterministically classified, the
policy should remain conservative: retain recent complete user Turns outside the
checkpoint, and require semantic facts to include source record IDs rather than trying
to infer arbitrary "must keep" rules from text alone.

---

## 9. Reliable Compaction State Machine

```text
                  ┌──────────────┐
                  │   PLANNED    │
                  └──────┬───────┘
                         │ source ids/digest frozen
                         ▼
                  ┌──────────────┐
                  │   REDUCING   │
                  └──────┬───────┘
                         │
                  candidate checkpoint
                         │
                         ▼
                  ┌──────────────┐
                  │  VALIDATING  │
                  └───┬──────┬───┘
                      │pass  │fail
                      ▼      ▼
                ┌─────────┐  deterministic
                │ COMMIT  │  extractive fallback
                └────┬────┘       │
                     │             ▼
                     │        validate again
                     │             │
                     │        pass │ fail
                     │             ▼
                     │          ABORT
                     ▼
              durable checkpoint
                     │
                     ▼
             rehydrate/verify digest
                     │
                     ▼
              new Context Epoch
                     │
                     ▼
              Provider request
```

Only `COMMIT` appends a semantic Session `compaction` Entry.

Runtime Events may record content-free `planned / reducing / validating / committed /
aborted` diagnostics, but they do not become semantic history.

---

## 10. Semantic Reducer Contract

The reducer should no longer return arbitrary Markdown. It returns a strict structured
object matching `CompactionCheckpointV2.state` plus provenance IDs.

Recommended contract:

```text
input:
  previous verified checkpoint state
  newly compacted complete Context groups
  required anchors
  source record IDs

output:
  structured replacement state
  each fact -> sourceRecordIds[]
  each required anchor -> covered | superseded(by record id)
```

Validation is deterministic:

- schema is valid;
- all referenced record IDs belong to the plan source/base checkpoint;
- all required anchors are covered or validly superseded;
- no duplicate fact IDs;
- source digest still matches the CompactionPlan;
- rendered summary fits the target budget;
- retained groups remain untouched;
- the checkpoint does not claim a Tool success when the canonical terminal is failure,
  cancellation, timeout, or denial.

An optional semantic verifier model may later be added for high-risk checkpoints, but
V1 must not require a second LLM call for correctness.

---

## 11. Deterministic Fallback V2

The current "serialize everything then truncate to fit" fallback should not be used as
a durable verified checkpoint.

Replace it with a priority-aware extractive fallback:

```text
P0  explicit required anchors / active constraints
P0  unresolved failures / denied or failed Tool terminals
P0  current goal / pending work
P1  artifact state and test/build outcomes
P1  latest decisions and supersession relations
P2  bounded exact excerpts from important user/assistant records
P3  source references for omitted low-value chronology
```

The fallback builds the same structured schema and is validated by the same validator.

If it cannot fit all P0 anchors:

- at soft/hard threshold: **abort compaction** and continue with the un-compacted
  projection if it still fits;
- at true overflow: fail with a typed `context-compaction-unrecoverable` error rather
  than silently persist a checkpoint known to have lost required state.

This deliberately prefers an explicit failure over invisible semantic corruption.

---

## 12. Compaction Timing & Cache-Economics Policy

### 12.1 Compaction only at safe primary Model Loop boundaries

Do not run semantic compaction while a Tool Batch is partially complete.

Safe boundary:

```text
all prior Tool Results durable
AND no approval result still unresolved
AND Provider-visible Tool order finalized
AND next primary model request has not started
```

### 12.2 Tool pressure schedules compaction; it does not automatically compact all
history

Current tool-pressure behavior intentionally compacts all compactable history. The new
policy should instead treat Tool pressure as a **reason to plan one epoch transition**,
then select only enough oldest complete groups to reach the post-compaction target.

This reduces semantic loss and reducer input size while still accepting the single
cache reset that any real compaction requires.

### 12.3 Hysteresis / minimum epoch progress

Except for true overflow, do not create a new checkpoint until meaningful progress has
occurred since the previous epoch transition.

Policy inputs should include:

- minimum new complete Turns;
- minimum new post-checkpoint tokens;
- minimum estimated token savings;
- optional estimated cache-reset cost.

This prevents a tool-heavy loop from compacting on several adjacent Model Steps.

### 12.4 Cache reset is explicit telemetry

Every committed checkpoint starts a new `ContextEpochId`. The first Provider request in
that epoch is tagged:

```text
expectedCacheEffect = "epoch-rebase"
```

so a low cache hit is not misdiagnosed as a Provider/cache failure.

### 12.5 Accepted Pi-inspired source-selection policy

The approved source-selection policy follows Pi Agent's useful compaction
principle without copying its implementation literally:

```text
complete durable history
        ↓
retain a recent raw suffix
        ↓
compact only the older contiguous prefix
        ↓
previous checkpoint + newly compacted prefix
        ↓
new complete replacement checkpoint
```

MORE-MORE-CODE strengthens that model with Tool Batch and Model Cycle semantics:

- the recent raw tail is budget-aware rather than a fixed message count;
- retention uses both a minimum token floor and a ratio of the effective input
  budget so the policy scales from small windows to 1M-token-class models;
- normal cut points are complete Model Cycle boundaries, not merely user-turn
  boundaries;
- a Model Cycle containing Tool Calls is atomic through the complete Tool Batch
  terminal barrier;
- `Tool Call -> Tool Result` pairs are never separated by normal compaction;
- a split-group escape hatch is allowed only for pathological oversized groups,
  preserves the suffix raw, and still cannot split an active Tool Batch;
- repeated compaction reduces the previous accepted checkpoint together with only
  newly compacted history instead of re-summarizing the whole Session;
- the complete Session Tree remains durable and inspectable. Compaction changes
  only the Provider-facing Context projection.

The detailed selection/checkpoint contract is maintained in
`docs/PI-INSPIRED-CONTEXT-COMPACTION-DESIGN.md` and is normative for this design.

---

## 13. Provider Request Compilation After Compaction

The next Provider request must be compiled from the **committed** checkpoint state, not
merely from the in-memory candidate that was intended to be committed.

Required sequence:

```text
build CompactionPlan
  -> produce candidate
  -> validate
  -> append compaction entry with idempotency key
  -> Session authority returns accepted entry/revision
  -> reconstruct effective checkpoint from accepted Session state
  -> verify checkpoint/source digest
  -> compile Provider request
  -> external Provider side effect
```

If rehydration/digest verification fails, do not call the Provider.

This makes the crash/retry boundary auditable and prevents "persisted A, sent B" class
errors.

---

## 14. Cache Miss Classification & Observability

Extend Provider cache telemetry with application-side expectations:

```ts
type CacheExpectation = {
  cacheFamilyId: string;
  contextEpochId: string;
  renderedPrefixDigest: string;
  previousRenderedPrefixDigest?: string;
  breakpointKind: string;
  expectedReusableTokens: number;
  missReasonHint?:
    | "cold-start"
    | "epoch-rebase"
    | "tool-definition-change"
    | "provider-setting-change"
    | "rendered-history-change"
    | "below-minimum-cacheable-prefix"
    | "ttl-or-routing"
    | "provider-unreported";
};
```

Classification rules should be conservative. For example:

```text
same family + same rendered digest + provider reports 0 cached tokens
  -> likely TTL/routing/cold provider cache, not local prompt mutation

same family + different rendered digest + same epoch
  -> local rendered-prefix instability bug

different epoch
  -> intentional compaction rebase

different tool-definition family
  -> expected Tool schema/cache-family change
```

The Inspector can later expose:

```text
Cache family     stable
Context epoch    checkpoint:7
Prefix digest    unchanged
Expected reuse   84k
Provider read    81k
Provider write   3k
Classification  normal append-only continuation
```

---

## 14.4 Temporary Full Provider-Request Context Recorder

Cache diagnosis requires evidence from the **actual Provider request body**, not
only Session Entries or an application-side cache fingerprint. During the cache
investigation stage, MORE-MORE-CODE therefore carries a temporary opt-in recorder.

Current temporary implementation:

```text
scripts/dev-cli-record-provider-context.ts
packages/cli/src/lib/provider-request-recorder.ts
packages/cli/src/lib/native-provider-executor.ts   # capture call sites
```

Activation:

```text
bun run dev:cli:record-context
```

Equivalent environment switch:

```text
MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT=1
```

Optional output override:

```text
MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR=<absolute local directory>
```

Default output location:

```text
~/.more-more-code/diagnostics/provider-context/<timestamp>-pid-<pid>/
```

For each logical Provider invocation, the recorder writes:

```text
000001-<protocol>-<model>.request.json   exact JSON bytes passed to fetchProvider()
000001-<protocol>-<model>.meta.json      request/cache/digest metadata
manifest.jsonl                           one compact metadata row per request
```

The `.request.json` file is intentionally the exact serialized request body used
for the network side effect. It is not parsed and pretty-printed again, because
serialization/order differences are exactly what this diagnostic is intended to
detect.

Metadata includes at least:

- Provider / model / protocol;
- request sequence and timestamp;
- primary cache-identified request vs auxiliary Provider request classification;
- `PromptPrefixIdentity` when present;
- cache retention mode;
- full-wire-body SHA-256 and byte size;
- independent hashes for native system prompt, message array and Tool definitions.

This makes adjacent requests directly diffable:

```text
same Context Epoch
  + same system/tools hashes
  + different messages hash / wire hash
  -> inspect exact request files to locate unexpected history mutation

new Context Epoch
  + changed wire hash
  -> expected compaction rebase, then verify later append-only stability
```

Security and lifecycle rules are strict because the recorder intentionally captures
**complete model context**, including potentially private source code, Tool outputs,
user text and internal instructions:

- output is local-only and outside the repository by default;
- authorization headers, API keys and credential-store values are never written;
- when diagnostic mode is enabled, capture is fail-closed: if the local request
  body cannot be written, the Provider side effect is blocked so an unrecorded
  request cannot corrupt the investigation;
- ordinary CLI execution keeps the recorder disabled and has no capture I/O;
- low-level HTTP retries are not duplicated as separate context snapshots because
  they reuse the same logical Provider payload;
- this recorder is temporary and must be removed after cache investigation closes.

Required removal scope after diagnosis:

```text
delete scripts/dev-cli-record-provider-context.ts
delete packages/cli/src/lib/provider-request-recorder.ts
remove native-provider-executor capture hooks
remove dev:cli:record-context from package.json
remove temporary recorder tests/docs or convert only aggregate-safe diagnostics
delete local diagnostic captures when no longer needed
```

The permanent observability system should retain only bounded fingerprints,
token/cache telemetry and classification—not complete prompts.

---

## 14.5 Compaction Runtime UX and Dynamic Activity

Compaction must be visible while it is happening. A long semantic reduction can
otherwise look like a frozen model step, especially when the transcript is
collapsed or the Provider request has not started yet.

These indicators are **runtime/UI projection state**, not synthetic user or
assistant messages and not a second Session authority. The durable `compaction`
Session Entry remains the semantic record after a successful commit.

Recommended lifecycle:

```text
compaction.planned
  -> compaction.reducing
  -> compaction.validating
  -> compaction.committing
  -> compaction.rebased
  -> compaction.completed

failure branches:
  compaction.fallback
  compaction.aborted
  compaction.failed
```

The Activity surface should keep one transient runtime row while compaction is
active instead of appending each phase as conversation content. That row updates
only when the lifecycle phase changes and becomes one bounded terminal status on
completion.

Recommended progression:

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

Fallback reuses the same activity row:

```text
Semantic compaction incomplete · validating deterministic fallback…
```

Rejected candidate:

```text
Context compaction aborted · required state could not be preserved
```

Suggested visible copy:

```text
Context compacting…
Summarizing older context…
Validating checkpoint…
Applying checkpoint…
Context compacted · 98.9k → 71.2k · cache epoch 7 → 8
```

When the semantic reducer falls back:

```text
Context compaction fallback · validating extractive checkpoint…
```

When validation rejects the candidate:

```text
Context compaction aborted · required state could not be preserved
```

UX invariants:

- only show `Context compacting…` after a real `CompactionPlan` exists; normal
  Context projection must not flash a compaction indicator;
- update only on lifecycle transitions, not per token/timer tick, so this does
  not reintroduce the OpenTUI render storm removed by the UI stability work;
- the active row may use the existing narrow active indicator, but no global
  animation loop;
- the terminal completion row is projected from the accepted compaction event
  and may show before/after tokens, trigger and Context Epoch transition;
- a failed/aborted candidate must never render the success copy;
- the context utilization bar is recomputed from the accepted post-compaction
  projection. It **does not reset to zero** because compaction replaces history
  with a checkpoint plus retained tail rather than starting a new Session;
- automatic compaction occurring between Tool Batch completion and the next
  Provider request remains visible as Context work, separate from Tool activity
  and model-thinking activity.

Recommended UI ownership:

```text
Harness CompactionPlan / reducer lifecycle
        ↓
CLI Context lifecycle adapter
        ↓
SessionUiStore activity projection
        ↓
Conversation/Activity surface
```

If durable diagnostics are desired, store only bounded technical lifecycle
metadata in Runtime Events (`operationId`, phase, trigger, token counts,
epoch ids). Never persist prompt text, summary source text or Tool output in a
runtime diagnostic event.

---

## 15. Recommended Code Boundaries

### Harness

`packages/harness/src/context.ts`

- split compaction planning from compaction execution;
- create `CompactionPlan`;
- select safe source groups;
- implement epoch-progress/hysteresis policy;
- remove the special "tool-pressure => compact all compactable history" behavior.

New suggested modules:

```text
packages/harness/src/compaction-plan.ts
packages/harness/src/compaction-checkpoint.ts
packages/harness/src/context-anchors.ts
```

### CLI semantic reducer

`packages/cli/src/lib/context-compactor.ts`

- replace free-form Markdown reducer output with strict structured output;
- replace raw token-fit fallback with priority-aware extractive fallback;
- deterministic render from structured checkpoint -> Provider summary text.

### CLI transport / durability

`packages/cli/src/lib/local-model-transport.ts`

- implement prepare -> validate -> commit -> rehydrate -> Provider sequence;
- add idempotent compaction commit identity;
- start a new Context Epoch only after durable acceptance.

### Cache identity

`packages/cli/src/lib/cache-identity.ts`

- replace one overloaded prefix identity with `CacheFamilyIdentity`;
- add `ContextEpochId` and actual rendered-prefix diagnostics.

### Provider protocol/adapters

```text
packages/cli/src/lib/provider-native-protocol.ts
packages/cli/src/lib/native-provider-executor.ts
packages/cli/src/lib/provider-runtime.ts
```

- provider capability table for cache mode/breakpoints/allowed-tools;
- OpenAI GPT-5.6+ explicit/implicit cache controls;
- Tool-Batch-end breakpoint compilation;
- Anthropic automatic/explicit cache policy;
- no unsupported fields for generic OpenAI-compatible endpoints.

### Session schema

`packages/harness/src/session-tree.ts` and shared schema files:

- version the compaction payload;
- keep backwards read compatibility with V1 Markdown checkpoints;
- new writes use V2 only after migration gate passes.

---

## 16. Migration Strategy

### Phase C1 — Diagnostics first, no semantic change

Implement:

- `CacheFamilyId`;
- `ContextEpochId`;
- `RenderedPrefixDigest`;
- cache miss classification;
- temporary full Provider-request context recorder for exact request diffing;
- tests proving current Tool continuations are byte-stable.

This phase lets us measure the real causes before changing cache policy.

**Gate:** no Context/Session behavior changes.

### Phase C2 — Provider cache controls

Implement Provider capability-based cache policies:

- OpenAI GPT-5.6+ breakpoints and modern cache options;
- Tool-Batch-end breakpoints;
- safe tool-definition/catalog vs availability separation where Provider-native
  restrictions exist;
- Anthropic cache policy cleanup.

**Gate:** Provider request golden tests + live cache telemetry validation.

### Phase C3 — Compaction Plan + Checkpoint V2

Introduce:

- structured checkpoint schema;
- source digests;
- provenance-bearing facts;
- required anchors;
- deterministic validator;
- backwards-compatible V1 reader.

Do not yet remove the old path until shadow comparison passes.

### Phase C4 — Shadow compaction evaluation

For synthetic/replay fixtures, compute V1 and V2 checkpoints side by side without
using V2 for Provider execution.

Measure:

- required-anchor coverage;
- checkpoint token size;
- semantic regression fixtures;
- repeated-compaction drift;
- cache epoch frequency.

### Phase C5 — Transactional V2 cutover

Switch normal compaction to:

```text
plan -> reduce -> validate -> durable commit -> rehydrate -> request
```

Remove arbitrary truncation as a durable fallback.

### Phase C6 — Tune cache economics

Only after telemetry exists, tune:

- soft/hard thresholds;
- minimum epoch progress;
- breakpoint placement;
- OpenAI explicit vs implicit mode;
- cache TTL/retention policy.

Do not guess these values before measuring real session distributions.

### Phase C7 — Remove temporary full-context recorder

After the cache investigation has enough evidence and permanent digest telemetry can
explain expected/actual cache behavior:

- archive only diagnostic conclusions that are safe to retain;
- remove the full request recorder module, launcher and Provider hooks;
- remove `dev:cli:record-context`;
- delete local full-context captures unless the user explicitly needs them longer;
- keep only privacy-bounded hashes, token/cache telemetry and miss classification.

**Gate:** production/default runtime must not retain complete Provider prompt logging.

---

## 17. Test Contract

### 17.1 Cache invariants

- 1,000 sequential Tool-heavy Model Loops do not mutate prior rendered Tool Results.
- serial and parallel Tool execution produce byte-identical Provider Tool Result order.
- same Session epoch + same history produces identical `RenderedPrefixDigest`.
- adding a new Tool Batch changes only the suffix after the previous breakpoint.
- changing Tool availability via a native safe mask does not change definitions.
- changing actual Tool schema creates a new cache family.
- compaction creates exactly one new Context Epoch.

### 17.2 Compaction reliability

- every V2 checkpoint has a valid source digest and provenance references;
- every required anchor is covered or validly superseded;
- failed/cancelled/timed-out/denied Tool terminals cannot become successful facts;
- repeated checkpoint chaining preserves active constraints and pending work;
- 20+ sequential compactions over a replay fixture do not lose required anchors;
- corrupted checkpoint/source digest fails restore before Provider execution;
- duplicate/retried compaction plan is idempotent;
- crash after commit but before Provider call reuses the exact committed checkpoint;
- reducer timeout/empty/malformed/hallucinated references enter deterministic fallback;
- fallback that cannot preserve P0 anchors aborts rather than silently committing.

### 17.3 Cache/compaction interaction

- Tool-pressure does not compact inside an incomplete Tool Batch;
- adjacent Tool-heavy steps respect epoch hysteresis;
- first request after compaction is classified `epoch-rebase`;
- second append-only request in the new epoch is eligible for normal cache reuse;
- V2 checkpoint rendering is byte-stable across restart.

### 17.4 Provider golden requests

Maintain request-body snapshots for:

- OpenAI Responses GPT-5.6+;
- earlier OpenAI models if still supported;
- Anthropic Messages;
- Google Generative AI;
- DeepSeek/OpenAI-compatible.

Golden tests must prove Provider-specific cache fields never leak into canonical Context
or Session schemas.

### 17.5 Temporary request-recorder diagnostics

- disabled mode performs no diagnostic file writes;
- enabled mode writes the exact wire JSON body before Provider side effect;
- metadata digest equals the written request bytes;
- sequence files and `manifest.jsonl` remain ordered for one CLI process;
- authorization headers/API keys are absent from captures;
- capture failure blocks Provider execution only when recorder mode is explicitly
  enabled;
- primary cache-identified requests and auxiliary reducer requests are distinguishable
  in metadata;
- recorder removal is a required closeout item rather than optional cleanup.

---

## 18. Release Gates

Implementation is not considered delivered until all of the following hold:

- focused Context/cache/compaction tests pass;
- full Harness tests pass;
- full CLI tests pass;
- CLI/Harness typechecks pass;
- CLI production build passes;
- native OpenTUI stress remains green;
- replay fixture with repeated compactions preserves all P0 anchors;
- cache telemetry demonstrates no unexplained same-epoch rendered-prefix changes;
- temporary exact-request captures are available during the investigation and remain
  opt-in/local-only;
- no Provider side effect can occur before accepted checkpoint rehydration;
- `git diff --check` passes;
- ADR/DESIGN/TEST/DELIVERY/CHANGELOG are updated consistently.

---

## 19. Trade-offs

### Advantages

- Cache misses become explainable rather than inferred from one hit-rate number.
- Tool-heavy workflows become naturally append-only between real compactions.
- Compaction becomes an auditable transaction instead of an opaque best-effort text
  replacement.
- A bad reducer output cannot silently become a "verified" durable checkpoint.
- Provider-native cache features can be used aggressively without contaminating
  canonical Session semantics.
- Crash/restart behavior has an explicit content-addressed boundary.

### Costs

- Compaction payload/schema becomes more complex.
- Provider request compiler gains capability-specific paths.
- Structured checkpoint validation adds implementation and test surface.
- Strict overflow failure is less available than silently accepting a lossy fallback,
  but it is more correct for a coding-agent harness where hidden state corruption is
  expensive.
- Cache optimization cannot completely avoid the first cache reduction after a true
  compaction; compaction necessarily changes historical context.

---

## 20. Explicitly Rejected Alternatives

### Keep only `prompt_cache_key` and tune its hash

Rejected. A routing/grouping key cannot make changed rendered prefix bytes cache-hit.

### Persist every Tool Result twice: full + summarized

Rejected. The canonical Tool Result already exists. Deterministic model-facing
projection is sufficient and avoids mixing model-profile state into Session authority.

### Let Tool pressure continuously re-truncate old Tool Results

Rejected. This recreates ADR-0030's cache-hostile historical mutation.

### Use OpenAI server-side compaction as the canonical solution

Rejected. It is Provider-specific and opaque, and would make branch/provider-switch
semantics depend on OpenAI-owned state.

### Keep the current arbitrary text truncation as a "safe" fallback

Rejected for durable V2 checkpoints. It is bounded, but bounded is not equivalent to
semantically safe.

### Run a second verifier LLM for every compaction

Rejected for V1. It doubles Provider dependence and cost. Deterministic provenance and
anchor validation should be the correctness floor; a verifier can be added later as an
optional quality layer.

---

## 21. Approved Decisions and Conditional Provider Boundaries

The compaction architecture is approved with the following decisions:

1. **Checkpoint V2:** use structured checkpoint state plus deterministic Markdown
   rendering; free-form Markdown alone is not the canonical V2 checkpoint.
2. **Failure policy:** fail closed at true overflow when P0 anchors cannot be
   preserved instead of silently committing a known-lossy checkpoint.
3. **Tool availability strategy:** Provider-native `allowed_tools`/equivalent may be
   used only where it is a real enforcement boundary; otherwise PLAN/BUILD retain
   distinct Tool-definition cache families. This remains capability-conditional.
4. **Compaction timing:** Tool pressure schedules one safe epoch transition and
   compacts only enough oldest complete semantic groups to reach target; it does not
   automatically compact all eligible history.
5. **Provider cache rollout:** Provider-specific breakpoint/cache controls are allowed
   behind adapters when the Provider actually supports them. Canonical Context stays
   Provider-independent.
6. **Migration:** retain V1 checkpoint read compatibility; new writes switch to V2
   only after shadow/replay/transaction gates pass.
7. **Diagnostics:** keep the full Provider-request recorder only for the active cache
   investigation, then remove it and retain bounded permanent telemetry only.

Implementation should follow the staged C1-C7 rollout so cache evidence is captured
before changing compaction semantics.

---

## 22. External Design References

The proposal follows current Provider-documented cache mechanics rather than assuming
that a cache key alone controls reuse:

- OpenAI Prompt Caching:
  `https://developers.openai.com/api/docs/guides/prompt-caching`
- OpenAI Compaction:
  `https://developers.openai.com/api/docs/guides/compaction`
- Anthropic Prompt Caching:
  `https://platform.claude.com/docs/en/build-with-claude/prompt-caching`
- Google Gemini Context Caching:
  `https://ai.google.dev/gemini-api/docs/caching`
