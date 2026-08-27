# Usage, Cost & Context Observability Delivery Contract

**Delivery state:** Delivered — 2026-08-27.

**Target:** Next active local-only Stage 6.5 follow-up after ADR-0026.

**Decision:** ADR-0027.

## 1. User Requirement

The CLI must make the current Session's model resource usage visible without
requiring a separate dashboard. The first required UI is the existing
StatusBar and must show:

```text
Ctx <current context>/<model window>
API <cumulative calculated Session cost>
Cache <cumulative trustworthy cache hit rate>
```

Example:

```text
Build > deepseek/deepseek-v4-flash · Ctx ~42.8k/128k · API ~$0.0187 · Cache 72%
```

## 2. Accepted Product Semantics

### Context

- means current canonical Context occupancy for the selected Session/model;
- is not cumulative API token spend;
- uses the same Context pipeline as Model execution;
- displays `~` while based on heuristic token counting.

### API Cost

- means cumulative cost of completed Provider Model Steps in the Session;
- is calculated from Provider-reported Usage and the pricing snapshot active at
  each Step;
- is not claimed to be a Provider invoice;
- unknown pricing must not be treated as free.

### Cache

- means Provider-reported cache-read input divided by Provider-reported total
  input for the eligible Session scope;
- `0%` means a real reported zero;
- `—` means the metric is unavailable or not trustworthy enough to aggregate.

## 3. Required Deliverables

### D1 — Runtime Usage Contract

Add a strict `usage/model.usage` Runtime Event and normalized Provider Usage
contract correlated to Session/Run/Turn/Step/Provider/Model.

### D2 — Durable Usage Collection

Record one effective Usage fact after each completed Model Step and restore
Usage after Runtime Store restart without using Session message metadata as a
second authority.

### D3 — Usage Projection and Integrity

Provide deterministic Session aggregation with Step-level idempotency,
duplicate conflict detection, partial/unknown coverage semantics, and snapshot
replay parity.

### D4 — Versioned Pricing and Cost Engine

Replace the insufficient flat input/output pricing assumption with versioned
pricing snapshots capable of cache-rate calculation. Persist the pricing basis
used for each completed Step so historical Session cost does not change later.

### D5 — Current Context Observability

Expose current Context Window occupancy through a pure projection sharing the
real canonical Context construction/token-budget path. No Provider call may be
required for UI refresh.

### D6 — StatusBar Integration

Extend the existing StatusBar with compact Context, API Cost, and Cache values.
The component is presentation-only; aggregation/calculation belongs to deep
modules/projections.

### D7 — Failure/Unknown Semantics

Usage persistence failure after Provider completion must not repeat the
Provider side effect. Missing Usage/pricing/cache data must be rendered as
unknown/partial rather than fabricated zero values.

### D8 — TDD and Verification

Implement the complete Red -> Green contract in
`docs/USAGE-COST-CONTEXT-OBSERVABILITY-TEST.md` and run full relevant package
verification before marking this delivery complete.

## 4. Persistence Boundary

Target persistence:

```text
Local Session Store
  -> semantic Session Tree only

Local Runtime Store
  -> execution/security/context/recovery
  -> usage telemetry (new)
```

No new Session Entry kind is authorized.

No SQLite schema migration is expected because Runtime Event type/payload are
stored generically. If implementation discovers a schema migration is actually
necessary, stop and update ADR-0027/design before proceeding.

## 5. Data Quality Contract

Every surfaced metric must retain its quality class:

```text
Provider token Usage   -> provider-reported
Current Context        -> estimated | exact
API Cost               -> calculated | unavailable/partial
Cache hit              -> reported aggregate | unavailable/partial
```

The implementation must not collapse these classes into one ambiguous
"token" value.

## 6. Cost Stability Contract

Historical Session Cost must remain stable across application upgrades and
pricing catalog changes.

Required mechanism:

- versioned/effective pricing revisions;
- resolved pricing snapshot stored with the Usage fact;
- deterministic Cost Engine and rounding policy;
- no silent repricing of already persisted Usage.

## 7. Cache Integrity Contract

The implementation must distinguish:

```text
cacheRead=0       -> known 0%
cacheRead missing -> unknown
```

Cache-write tokens are not cache hits. Output tokens are not part of the cache
hit denominator.

## 8. Context Integrity Contract

`Ctx` must reflect the current active Session branch and selected model. It must
respond to:

- history changes;
- Tool Result pruning/terminal changes;
- Compaction/Branch Summary;
- branch navigation;
- model/mode changes;
- Agent source/ToolSet changes.

It must not be derived from Session cumulative API Usage.

## 9. Required Failure Behavior

- Usage event validation failure -> do not persist malformed telemetry;
- Runtime Usage append failure after Provider completion -> no Provider retry;
- duplicate identical `stepId` Usage -> count once;
- duplicate conflicting `stepId` Usage -> integrity failure, no double charge;
- unknown price bucket -> cost unavailable/partial;
- unsupported cache telemetry -> Cache `—`;
- local Context estimator != Provider Usage -> preserve both values independently;
- old Session message metadata with Usage -> legacy-readable, not canonical
  aggregation input.

## 10. Explicit Non-Deliverables

This Stage does not include:

- `/usage` dashboard/dialog;
- charts or day/week/month statistics;
- project/provider/model ranking pages;
- spend budgets/alerts;
- account subscription quota/balance monitoring;
- Provider billing portal scraping/reconciliation;
- automatic online pricing refresh;
- Cloud Usage synchronization/billing;
- exact tokenizers for all providers;
- per-message Step Usage footer;
- branch-scoped cost views;
- Custom Provider pricing editor;
- Stage 6.6 Cloud Sync/Entitlements;
- Stage 6.7 Windows Sandbox;
- MCP, Subagent, OAuth, or unrelated UI work.

## 11. Definition of Done

Delivery may be marked complete only when:

- normalized Provider Usage is durably recorded per completed Model Step;
- Step duplicates cannot inflate totals;
- Session Usage/Cost/Cache restores after restart;
- pricing revisions keep historical cost stable;
- Context Window status comes from the canonical Context projection;
- StatusBar displays all three required metrics with correct unknown/quality
  semantics;
- Provider completion followed by Usage persistence failure never causes a
  duplicate Provider request;
- legacy Session metadata is not double-counted;
- no Session/Runtime SQLite migration or cloud dependency was introduced;
- focused + full Harness/CLI/Runtime Store tests, typechecks/builds and
  `git diff --check` pass;
- README/CONTEXT/PROJECT_ANALYSIS/CHANGELOG are updated from planned to
  delivered only after all verification is green.

## 12. Rollback Boundary

Because no SQLite schema migration is expected, rollback is code-level:

- older binaries may ignore unknown future `usage` Runtime Event types only if
  their compatibility policy explicitly permits it; implementation must verify
  actual validator/replay behavior before delivery;
- new Usage events remain isolated from Session semantic history;
- rolling back UI/Cost projection must not rewrite Session Entries;
- never delete historical Usage facts merely because a pricing resolver or UI
  version changes.

## 13. Delivered Implementation

The approved V1 observability slice is implemented locally:

- Provider completion normalizes AI SDK Usage into a strict
  `usage/model.usage` Runtime Event correlated by Run/Turn/Step/provider/model;
- Session Usage projection folds exact duplicate Steps once, rejects conflicting
  duplicates as invalid, preserves unknown-vs-zero cache semantics, and is
  included in Runtime snapshot/replay recovery;
- pricing resolution is effective-time/version aware and the resolved pricing
  basis is persisted with each Usage fact so historical cost does not reprice;
- the Cost Engine calculates cache-aware input/output cost without using local
  Context estimates or double charging reasoning output;
- Current Context observability reuses the canonical model-input projection and
  exposes counter quality/budget/window without issuing a Provider request;
- `SessionObservability` supplies presentation-ready Context/Cost/Cache state to
  the existing StatusBar;
- Provider completion followed by Usage persistence failure does not retry the
  external Provider call.

No new Session Entry kind, Session Store schema change, Runtime Store SQLite
migration, Server dependency, or Stage 6.6 cloud behavior was introduced.

## 14. Verification Evidence

Delivered verification on 2026-08-27:

- focused Usage/Cost/Context/StatusBar suite: **38 passed / 0 failed**;
- Harness full suite: **107 passed / 0 failed**;
- CLI full suite: **191 passed / 0 failed**;
- Runtime Store full suite: **9 passed / 0 failed**;
- Shared, Harness, CLI, and Runtime Store TypeScript checks passed;
- CLI production build passed;
- Runtime Store Prisma schema validation passed;
- `git diff --check` passed.

The Session Store has no Prisma schema; its persistence schema was not modified
by this delivery. Existing React test warnings about `act(...)` remain
non-failing and are unrelated to this observability slice.
