# ADR-0030: Cache-Stable Tool Result Context Projection

## Status

Accepted

## Date

2026-08-28

## Context

ADR-0010 established deterministic stable-prefix ordering and provider-specific
cache configuration. ADR-0013 then added a Tool Result Working Set that changes
model-facing Tool Results according to `fresh -> warm -> cold` age and aggregate
working-set pressure.

That policy is token-efficient but cache-hostile. The same already-sent Tool
Result can be full on one Model Step, summarized on the next, and reduced again
later as newer Tool Results arrive. Provider prompt caching only reuses the
longest identical request prefix, so rewriting an older Tool Result invalidates
the conversation prefix after that point. A stable `promptCacheKey` can select
a cache family but cannot make different prompt bytes/tokens match.

Vercel AI SDK is the transport/serialization boundary here; it cannot preserve
a Provider cache hit when MORE-MORE-CODE changes the historical model input
before calling `streamText`.

## Decision

### Tool Result projection is intrinsic and monotonic

For a fixed model Context profile, the model-facing representation of a Tool
Result is a deterministic function of that Tool Result itself, not of its
relative age or of later Tool Results.

```text
small result
  -> full on first exposure
  -> full on later requests

individually oversized result
  -> deterministic bounded projection on first exposure
  -> byte-stable same projection on later requests
```

The per-result full threshold remains derived from the effective model input
budget. Oversized results are reduced immediately, including the newest Tool
continuation result, so a later turn does not rewrite an already-cached prefix.

### Aggregate pressure does not rewrite earlier Tool Results

The Tool Working Set aggregate budget remains an observability/backpressure
signal. It no longer dynamically redistributes target tokens across warm/cold
results, because that makes a result's representation depend on future
neighbors.

If many individually-small/stably-projected results exceed the aggregate Tool
budget, `overBudget` is reported and normal Context Compaction/whole-turn
selection handles historical pressure. Cache stability is preferred over
repeated in-place mutation of old Tool payloads.

### Model-facing projection references are stable

Bounded projection envelopes identify their source by `tool-call:<toolCallId>`.
An optional Session Entry lookup may remain internal metadata, but its later
availability must not change text already sent to a Provider.

### Session authority remains unchanged

The complete Tool Result remains the canonical durable Session fact. This ADR
changes only the bounded model-facing Context Projection. No Session schema,
Runtime Event schema, or Provider-owned conversation authority is introduced.

## Alternatives Considered

### Keep fresh results full, then summarize when warm

Rejected. It guarantees at least one historical prefix rewrite for every
oversized Tool Result.

### Persist the chosen model projection in Session history

Rejected. It would mix model/profile-specific cache optimization into semantic
Session authority and require persistence migration/state ownership that is not
needed for a deterministic projection.

### Use OpenAI `previous_response_id` as the fix

Rejected as the general solution. It is provider-specific, does not solve
DeepSeek/Anthropic/other prefix caching, complicates branch/provider switching,
and does not remove the underlying unstable Context projection.

## Consequences

- Longest-common-prefix cache reuse becomes predictable between adjacent Model
  Steps for unchanged history.
- Very large fresh Tool Results may be summarized/truncated on their first
  continuation step instead of being sent once in full.
- Aggregate Tool Working Set pressure is handled by stable per-result bounding
  plus existing Context Compaction rather than age-based payload rewriting.
- AI SDK and Provider Runtime contracts remain unchanged.
