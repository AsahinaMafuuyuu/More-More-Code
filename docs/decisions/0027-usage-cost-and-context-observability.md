# ADR-0027: Usage, Cost, and Context Observability

## Status

Accepted

## Date

2026-08-27

## Implementation Status

Delivered — 2026-08-27. Runtime Usage persistence/projection, versioned pricing
and Cost Engine, canonical Current Context observability, and StatusBar
Context/API Cost/Cache metrics are implemented and verified. No Session Entry
kind or SQLite schema migration was introduced.

## Context

MORE-MORE-CODE already has most of the raw signals required for useful local
Usage observability:

- Vercel AI SDK exposes normalized provider `LanguageModelUsage` after a Model
  Step completes, including total/non-cached/cache-read/cache-write input and
  total/text/reasoning output fields when the Provider reports them;
- `LocalModelTransport` already receives `event.totalUsage` and produces
  Provider cache telemetry;
- Context construction already knows the selected model's Context Window,
  reserved output budget, safety margin, estimated input tokens, Tool Result
  pruning, and Compaction state;
- Runtime Store already persists versioned strict-allowlist runtime facts in a
  generic SQLite `RuntimeEvent(type, payloadJson)` table.

The product does not yet turn those signals into one durable, user-facing
Usage model. The desired first UI surface is the current Session status line:

```text
Build > deepseek/deepseek-v4-flash · Ctx ~42.8k/128k · API ~$0.0187 · Cache 72%
```

These three values have different semantics and must not be conflated:

- **Context** is an estimated projection of what the current Session/model
  state would place into the next model Context Window;
- **Usage** is Provider-reported token accounting for completed API calls;
- **Cost** is a calculated amount derived from Provider-reported Usage and an
  explicit pricing snapshot, not an invoice returned by the Provider;
- **Cache hit** is a ratio over Provider-reported input/cache-read tokens, not
  a ratio over Context estimates or output tokens.

ADR-0010 already classifies Provider cache usage as Runtime telemetry rather
than Session semantic history. Current AI SDK UI message metadata may still
carry `usage` for runtime/UI transport and legacy persistence, but it must not
become a second Usage authority or be counted together with Runtime Usage
events.

## Decision

### 1. Runtime Store is the durable Usage authority

Add a new strict Runtime Event type:

```text
type = usage
kind = model.usage
```

One completed AgentLoop Model Step produces at most one effective Usage fact.
The fact is correlated by:

```text
sessionId
runId
turnId
stepId
providerId
providerKind
modelId
```

The existing Runtime Store SQLite schema does not require a migration because
`RuntimeEvent.type` and `payloadJson` are already generic persisted fields.
Only Harness runtime-event contracts, validators, reducers/projections, and
CLI producers need extension.

Session Entry Tree remains semantic conversation authority. No new Session
Entry kind is introduced for token usage, cache metrics, pricing, or cost.

### 2. Persist normalized Provider-reported Usage, not local estimates

The normalized Usage fact mirrors the AI SDK semantic buckets when present:

```ts
type NormalizedModelUsage = {
  input: {
    total?: number;
    noCache?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  output: {
    total?: number;
    text?: number;
    reasoning?: number;
  };
};
```

Missing Provider fields remain missing. They must not be silently converted to
zero merely to make a percentage or cost calculable.

The raw Provider usage object is not persisted by default. The durable payload
contains only the normalized numeric allowlist needed for local observability.
This avoids vendor-specific payload growth and prevents unknown provider data
from bypassing Runtime Event redaction policy.

### 3. Model Step identity controls Usage idempotency

`stepId` is the semantic identity for one Model Step Usage fact, matching the
assistant finalization boundary established by ADR-0026.

Projection behavior is:

- one Usage event for one `stepId` -> count once;
- exact duplicate Usage events for one `stepId` -> idempotently fold to one
  effective fact;
- incompatible duplicate Usage events for one `stepId` -> integrity anomaly;
  do not add both costs or token counts.

This protects aggregation from process/store retry ambiguity without adding a
new SQLite unique column in V1.

### 4. Context Window observability is a pure current-state projection

The StatusBar `Ctx` value must not be taken from cumulative API input Usage or
blindly reuse the previous request's Provider token count.

Instead, add a pure Context observability projection that reuses the same
canonical Context record construction, Tool Result Working Set, Compaction,
selected model profile, and token counter used by the real Model Step path.

The projected shape includes at minimum:

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

The current repository uses heuristic Provider-family counters, so the UI must
display an approximation marker such as `~42.8k`. If an exact tokenizer adapter
is later available, the projection can expose `exact` without changing UI
aggregation contracts.

This projection is recomputed from current local state after meaningful
Session/model/mode/Context-affecting changes and after restart. It does not
need a new durable Session or Runtime fact merely to keep the StatusBar fresh.
Historical `context.projection` Runtime Events remain execution diagnostics.

### 5. Pricing becomes versioned and time-aware

The current two-field `ModelPricing` metadata is insufficient for accurate
cost calculation because it lacks cache pricing and historical revisions.

Introduce a Pricing Resolver with immutable revisions. A resolved pricing
snapshot contains at minimum:

```ts
type ModelPricingSnapshot = {
  revisionId: string;
  providerId: string;
  modelId: string;
  currency: "USD";
  effectiveFrom: number;
  inputNoCacheUsdPerMillionTokens: number;
  cacheReadUsdPerMillionTokens?: number;
  cacheWriteUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens: number;
};
```

Reasoning tokens are diagnostic output sub-tokens and must not be charged a
second time when the Provider's normal output price already covers them. A
future provider-specific separate reasoning price requires an explicit pricing
rule rather than implicit double counting.

Every persisted Usage fact that can be priced stores the resolved pricing
snapshot used for that call plus a calculated cost breakdown. Historical cost
therefore remains stable when the built-in pricing catalog changes later.

For models/providers whose pricing cannot be resolved safely, Usage is still
persisted but cost is `unavailable`; V1 must not guess that unknown cache rates
equal uncached rates or that unknown Custom Provider traffic is free.

### 6. Cost is calculated telemetry, not Provider invoice truth

The Cost Engine computes a breakdown from the Provider-reported buckets and the
resolved pricing snapshot:

```ts
type ModelStepCost = {
  inputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  totalUsd: number;
  quality: "calculated";
};
```

Calculations use one deterministic rounding policy with sufficient precision
for small per-step values; display rounding is separate from stored precision.

Because the Provider normally reports tokens rather than an invoice amount,
the UI labels the Session aggregate as calculated, for example:

```text
API ~$0.0187
```

### 7. Cache hit rate has strict availability semantics

For one eligible scope:

```text
cacheHitRate = sum(cacheReadInputTokens) / sum(inputTotalTokens)
```

Output tokens and cache-write tokens are not added to the numerator.

Availability rules:

- Provider reports `cacheRead = 0` -> valid 0% hit rate;
- Provider omits cache-read telemetry -> unknown, not 0%;
- no eligible completed input Usage -> unavailable;
- mixed Session data with incomplete cache telemetry -> V1 aggregate is marked
  partial/unavailable rather than silently presenting a fully trusted ratio.

The StatusBar displays `Cache —` when a trustworthy aggregate cannot be
constructed.

### 8. Session Usage Projection is pure and reusable

Add one projection over effective Runtime Usage facts:

```ts
type SessionUsageSummary = {
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    completedStepCount: number;
  };
  cache: {
    hitRate?: number;
    coverage: "complete" | "partial" | "none";
  };
  cost: {
    totalUsd?: number;
    coverage: "complete" | "partial" | "none";
  };
};
```

The projection is deterministic, non-mutating, and restart-safe. It can later
serve `/usage`, dashboards, project/time aggregations, or export features
without changing the first StatusBar integration.

### 9. Usage persistence failure must never repeat a Provider side effect

Usage is observed only after the Provider has completed the Model Step. If
Runtime Usage persistence fails at that point:

- do not repeat the Provider request;
- do not discard an already received assistant result solely to manufacture a
  clean Usage history;
- mark current Usage/Cost coverage incomplete in process and surface a visible
  diagnostic;
- never fabricate the missing Usage fact from Context estimates.

This differs from pre-side-effect Runtime facts that can fail closed before an
external operation starts. Post-completion telemetry cannot be made
write-ahead without changing what it measures.

### 10. UI V1 is intentionally small

The first permanent surface is the existing StatusBar:

```text
Build > provider/model · Ctx ~42.8k/128k · API ~$0.0187 · Cache 72%
```

Formatting requirements:

- Context uses a `~` marker while the counter is estimated;
- API cost is a Session cumulative calculated amount;
- Cache is Session cumulative only when coverage is trustworthy;
- unavailable data renders `—`, not `0`;
- compact token formatting must not change the underlying values.

Per-message Model Step Usage, `/usage`, charts, budgets, alerts, and historical
time dashboards are future projections over the same durable facts, not part
of V1.

## Alternatives Considered

### Store Usage inside `assistant_message` Session Entries

Rejected. Usage/cost/cache are execution telemetry, not semantic conversation
history. They would also be duplicated by legacy/current UI message metadata
and complicate branch semantics.

### Calculate Session Usage by scanning AI SDK message metadata

Rejected. Message metadata is a UI transport/legacy compatibility surface and
does not provide an independent durable Runtime authority. It also risks
double-counting after ADR-0026 step segmentation.

### Treat Context estimates as API Usage when Provider usage is missing

Rejected. Local Context counters and Provider tokenizers intentionally have
different accuracy/semantics. The UI must prefer `unknown` over fabricated
actual Usage.

### Calculate all historical cost from today's pricing table

Rejected. Provider pricing changes over time. Repricing old Sessions silently
would make historical totals unstable.

### Add a dedicated Usage SQLite database immediately

Rejected for V1. The existing Runtime Event Store is already the correct local
execution/telemetry boundary and its generic schema can persist a new strict
Usage event without a database migration.

## Consequences

- Runtime Store becomes the only new durable authority for Usage telemetry.
- Session Tree remains free of new billing/telemetry Entry kinds.
- Provider-reported Usage, local Context estimates, and calculated Cost expose
  explicit quality semantics instead of one ambiguous token number.
- Cost history remains stable across pricing updates because each priced Usage
  event records the pricing basis used at completion.
- Cache hit reporting distinguishes unsupported/unknown from real 0%.
- The first UI stays compact while the underlying projection contracts support
  future `/usage` and historical analytics.
- No SQLite schema migration is expected for this stage.

## Explicit Non-Goals

- Provider account balance or subscription quota scraping;
- OpenAI/Anthropic/Google/DeepSeek web-account quota monitoring;
- cloud billing or MORE-MORE-CODE subscription charging;
- day/week/month charts or project leaderboards;
- automatic online pricing updates;
- budget alerts or spending limits;
- exact tokenizer implementation for every model family;
- Usage synchronization to Stage 6.6 Cloud;
- arbitrary invoice reconciliation with Provider billing portals;
- unrelated Session Tree, MCP, Subagent, Sandbox, or Provider-auth work.
