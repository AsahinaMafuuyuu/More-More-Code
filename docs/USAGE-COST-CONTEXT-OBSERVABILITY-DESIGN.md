# Usage, Cost & Context Observability Design

**Status:** Delivered — 2026-08-27. Implemented without changing Session Store
semantics, Runtime Store schema, Provider request authority, or cloud behavior.

**Target:** Next active local-only Stage 6.5 follow-up after ADR-0026. Stage 6.6
Cloud Sync remains paused and Stage 6.7 Windows Native Sandbox remains separate.

**Decision:** ADR-0027.

## 1. Goal

Expose three trustworthy current-Session metrics in the CLI StatusBar:

```text
Ctx ~42.8k/128k · API ~$0.0187 · Cache 72%
```

The implementation must establish durable, reusable observability contracts
before adding UI. It is not a dashboard-first feature.

## 2. Required Semantic Separation

The stage has three independent truth classes:

| Metric | Source | Meaning | Quality |
| --- | --- | --- | --- |
| Current Context | canonical Context projection + model profile | estimated tokens that current state would place into the model window | estimated/exact local counter |
| API Usage | Provider/AI SDK `totalUsage` | tokens reported for completed Model Steps | provider-reported |
| API Cost | Usage + pricing snapshot | calculated USD amount for completed Model Steps | calculated |
| Cache hit | Provider-reported input/cache-read buckets | share of reported input served from cache | provider-reported when complete |

Never derive one class from another merely because a field is missing.

## 3. Existing Seams to Reuse

### Provider completion

`LocalModelTransport` already receives:

```text
streamText(...)
  -> onFinish(event.totalUsage)
  -> createProviderCacheTelemetry(...)
```

The Usage collector belongs at this Provider completion seam. It must not move
Provider execution into React or Server code.

### Context

Existing context code already owns:

- `ModelContextProfile.contextWindowTokens`;
- `reservedOutputTokens`;
- `safetyMarginTokens`;
- canonical Context Records;
- Tool Result Working Set pruning;
- Compaction checkpoints;
- estimated/exact TokenCounter identity.

Current Context observability must reuse this pipeline rather than implement a
second approximation in `StatusBar`.

### Runtime persistence

`packages/runtime-store` persists generic Runtime Events:

```text
offset / id / sessionId / type / payloadJson / createdAt
```

Therefore `type="usage"` requires contract/validator/reducer work but no SQLite
column/table migration.

## 4. Runtime Usage Event Contract

Add `usage` to `RUNTIME_EVENT_TYPES` and define a strict schema-v1 payload.

Conceptual contract:

```ts
type RuntimeUsageEventPayload = {
  schemaVersion: 1;
  kind: "model.usage";

  runId: string;
  turnId: string;
  stepId: string;

  providerId: string;
  providerKind: "openai" | "anthropic" | "google" | "deepseek" | "custom";
  modelId: string;

  inputTokens?: {
    total?: number;
    noCache?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };

  outputTokens?: {
    total?: number;
    text?: number;
    reasoning?: number;
  };

  pricing?: ResolvedPricingSnapshot;
  cost?: CalculatedModelStepCost;
};
```

Implementation may flatten nested numeric fields if that better matches the
strict Runtime Event validator, but the semantics above are mandatory.

### Validation

- token values are optional non-negative safe numbers;
- identifiers are non-empty strings;
- unknown keys fail validation;
- raw Provider usage payload is excluded;
- prompts/messages/Tool input/output/secrets remain excluded;
- cost cannot exist without a pricing snapshot and sufficient Usage buckets;
- no field uses `undefined` after crossing the durable JSON boundary.

## 5. Usage Collection Lifecycle

Per Model Step:

```text
AgentLoop starts Model Step
  -> Context projection
  -> Provider request
  -> Provider finishes
  -> AI SDK totalUsage available
  -> normalize Usage
  -> resolve Pricing revision
  -> calculate Cost if possible
  -> append Runtime usage event
  -> update in-memory Session Usage projection
```

### Ordering

Usage persistence is post-side-effect by definition. The Provider call has
already happened before token accounting exists.

If Usage append fails:

```text
do not retry Provider
do not invent Usage
do not count unpersisted Cost as durable history
surface incomplete observability state
preserve the already-received assistant result
```

## 6. Step Idempotency and Integrity

Effective Usage identity is `(sessionId, stepId)`.

`projectSessionUsage()` keeps one effective fact per Step:

```text
same step + identical payload      -> fold once
same step + incompatible payload   -> integrity error / aggregate unavailable
different steps                    -> aggregate normally
```

The first implementation does not add a new SQLite uniqueness constraint.

## 7. Message Metadata Compatibility

Current `ChatMessageMetadata` can carry AI SDK `usage`. That field may still be
needed transiently by UI transport while the stage is implemented.

New aggregation rules:

- Runtime `model.usage` is authoritative;
- legacy Session message metadata containing usage is not counted;
- new durable assistant persistence should stop treating `usage` as semantic
  Session history once Runtime Usage authority is wired;
- historical Sessions are not destructively rewritten;
- no fallback from legacy message metadata to canonical Usage is allowed by
  default, because doing so can mix incompatible Provider/version semantics.

## 8. Pricing Catalog Redesign

The current `ModelPricing` only has uncached input/output prices. V1 needs a
versioned catalog capable of pricing cache buckets.

Recommended model:

```ts
type PricingRevision = {
  revisionId: string;
  providerId: string;
  modelId: string;
  effectiveFrom: number;
  effectiveUntil?: number;
  currency: "USD";
  rates: {
    inputNoCacheUsdPerMillionTokens: number;
    cacheReadUsdPerMillionTokens?: number;
    cacheWriteUsdPerMillionTokens?: number;
    outputUsdPerMillionTokens: number;
  };
};
```

### Resolver rules

1. resolve by Provider/model/request time;
2. select the newest revision whose effective interval includes the Usage
   event time;
3. never delete historical revisions required by persisted Usage facts;
4. if a required bucket has no trustworthy rate, Cost is unavailable;
5. Custom Provider pricing is unavailable in V1 unless an explicitly approved
   local pricing configuration is added; do not inherit a built-in price merely
   because a Custom endpoint speaks OpenAI-compatible protocol.

### Persisted pricing basis

The Usage event stores the resolved pricing snapshot/rates used for that call.
This prevents later catalog edits from changing old Session totals.

## 9. Cost Engine

Cost computation is a pure function:

```text
Provider Usage + Pricing Snapshot -> ModelStepCost
```

Conceptual formula:

```text
inputCost = noCacheInput * inputNoCacheRate / 1,000,000
cacheReadCost = cacheRead * cacheReadRate / 1,000,000
cacheWriteCost = cacheWrite * cacheWriteRate / 1,000,000
outputCost = outputTotal * outputRate / 1,000,000

total = inputCost + cacheReadCost + cacheWriteCost + outputCost
```

If Provider Usage only provides `input.total` but the pricing model requires
separate cache buckets, Cost fails unavailable rather than charging all tokens
at one guessed rate.

Reasoning tokens are a subset of output and are not added again unless a future
Pricing Revision explicitly defines a distinct mutually-exclusive billing
bucket.

Use one deterministic USD rounding helper. Store more precision than the
StatusBar displays.

## 10. Session Usage Projection

Add a pure projection over Runtime Usage events:

```ts
type SessionUsageSummary = {
  completedStepCount: number;

  tokens: {
    inputTotal?: number;
    inputNoCache?: number;
    cacheRead?: number;
    cacheWrite?: number;
    outputTotal?: number;
    reasoning?: number;
  };

  cache: {
    hitRate?: number;
    coverage: "complete" | "partial" | "none";
  };

  cost: {
    totalUsd?: number;
    coverage: "complete" | "partial" | "none";
  };

  integrity: "valid" | "invalid";
};
```

### Aggregation

Token totals sum only Provider-reported fields that exist.

Cost coverage:

- `complete`: every completed Usage fact with billable token data has resolved
  cost;
- `partial`: at least one cost is known and at least one relevant fact cannot
  be priced;
- `none`: no cost can be priced.

Cache coverage:

- `complete`: all relevant input Usage facts provide both input total and
  cache-read semantics;
- `partial`: only part of the relevant Session does;
- `none`: no trustworthy cache ratio is available.

V1 StatusBar shows a percentage only for complete cache coverage.

## 11. Runtime Snapshot / Restart Strategy

Usage history can grow much larger than the existing open-run recovery state.
The Runtime projection should therefore gain an optional backward-compatible
Usage aggregate in its snapshot state rather than requiring an unbounded scan
from event offset zero on every Session open.

Target behavior:

```text
latest Runtime snapshot
  contains cumulative Usage projection state
      + replay usage events after snapshot offset
      -> exact same SessionUsageSummary as full replay
```

Existing snapshots without Usage fields remain valid and recover by replay.
No Runtime Store SQLite schema migration is required.

## 12. Current Context Observability Projection

Add a pure CLI/Harness seam that shares canonical Context source construction
with the actual Model Step path.

Inputs include:

- active Session branch;
- current model/mode;
- Agent instructions / Skill catalog / ToolSet snapshot;
- current effective compaction checkpoint;
- Tool Result Working Set policy;
- model Context profile and TokenCounter.

Output:

```ts
type CurrentContextUsage = {
  estimatedInputTokens: number;
  contextWindowTokens: number;
  inputBudgetTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  utilizationRatio: number;
  tokenCounterId: string;
  tokenCountQuality: "estimated" | "exact";
};
```

### Recompute triggers

- Session opens/restarts;
- active branch changes;
- finalized user/assistant semantic history changes;
- Tool Result terminal state changes;
- Compaction/Branch Summary changes effective Context;
- model or mode changes;
- effective Agent instructions/Skills/Tool definitions are reloaded.

The projection performs no Provider request and no persistence mutation.

## 13. StatusBar Projection

The existing StatusBar becomes a presentation-only consumer:

```text
Build > deepseek/deepseek-v4-flash · Ctx ~42.8k/128k · API ~$0.0187 · Cache 72%
```

Formatting rules:

### Context

```text
Ctx ~42.8k/128k
```

- numerator from `CurrentContextUsage`;
- denominator is full model Context Window, not effective input budget;
- `~` when the counter quality is estimated;
- compact `k` formatting only affects display.

### Cost

```text
API ~$0.0187
```

- Session cumulative calculated cost;
- complete coverage -> normal display;
- partial coverage -> compact lower-bound/partial indicator chosen during UI
  implementation, but never presented as complete;
- none -> `API —`.

### Cache

```text
Cache 72%
```

- ratio `cacheRead / inputTotal`;
- valid zero is `Cache 0%`;
- partial/none coverage -> `Cache —` in V1.

## 14. UI State Ownership

Do not place aggregation logic in `status-bar.tsx`.

Recommended flow:

```text
RuntimeSession / Usage projector ------┐
                                      ├-> Session observability state -> StatusBar
Current Context projector -------------┘
```

React/OpenTUI receives immutable summary values and formatting helpers only.

## 15. Performance Boundaries

- no Provider call for StatusBar refresh;
- no full Runtime event scan on every render;
- Usage aggregation updates incrementally per completed Step;
- current Context projection is recomputed only on Context-affecting state
  changes, not animation/render ticks;
- StatusBar must not trigger Session Store or Runtime Store writes;
- pricing resolution is local and deterministic.

## 16. Failure and Unknown-State Semantics

| Situation | Required UI/behavior |
| --- | --- |
| Provider omits usage entirely | no fabricated tokens/cost/cache |
| Provider reports cacheRead=0 | Cache 0% if coverage otherwise complete |
| Provider has no cache telemetry | Cache — |
| Pricing missing | Usage remains valid; API cost unavailable/partial |
| Usage Runtime append fails | do not retry Provider; surface incomplete observability |
| duplicate identical step Usage | count once |
| duplicate conflicting step Usage | integrity invalid; do not double count |
| Context counter heuristic | prefix numerator with `~` |
| model changes | Context denominator/profile recompute immediately |
| branch changes | Context recomputes for selected branch; Session cost remains Session-wide V1 |

Session-wide cost intentionally does not shrink when navigating to an older
branch because it represents API spend already incurred in the Session, not
the active branch's semantic Context. Future branch-scoped cost is a separate
projection.

## 17. Expected Files During Implementation

Likely areas:

```text
packages/harness/src/event-store.ts
packages/harness/src/runtime-session.ts
packages/harness/tests/*runtime* / *usage*

packages/shared/src/models.ts

packages/cli/src/lib/provider-runtime.ts
packages/cli/src/lib/local-model-transport.ts
packages/cli/src/lib/model-context-profile.ts
packages/cli/src/lib/*usage* / *cost* / *context-observability*
packages/cli/src/components/status-bar.tsx
packages/cli/src/hooks/use-chat.ts or a narrower session-observability provider
packages/cli/tests/*usage* / *cost* / *status-bar*
```

The Local Session Store and Runtime Store Prisma schemas are not expected to
change.

## 18. Explicitly Deferred

- `/usage` dashboard/dialog;
- per-message Step Usage footer;
- day/week/month/project aggregation;
- spend budgets/alerts;
- account quota/balance retrieval;
- Provider billing portal reconciliation;
- automatic web pricing refresh;
- exact tokenizer rollout;
- cloud Usage sync;
- branch-scoped spend views;
- Custom Provider pricing UI unless separately approved;
- unrelated Provider capability, MCP, Subagent, Sandbox, or Session work.
