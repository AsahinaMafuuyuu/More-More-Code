# Usage, Cost & Context Observability Test Plan

**Status:** Approved test contract — implementation not started.

**Design:** `docs/USAGE-COST-CONTEXT-OBSERVABILITY-DESIGN.md`

**Decision:** ADR-0027.

## 1. Objective

Prove that the CLI can display current Context occupancy, cumulative Session API
cost, and cache hit rate without confusing estimated Context with Provider
Usage, without double-counting Model Steps, and without moving telemetry into
Session semantic history.

Tests must cover pure contracts, durable Runtime replay, restart behavior, and
the StatusBar. UI-only snapshot tests are insufficient.

## 2. Required Test Order

Use Red -> Green slices. Each behavior-changing implementation task begins with
a focused failing regression before production code changes.

## 3. Slice 1 — Provider Usage Normalization

Construct AI SDK-style Usage objects with:

- input total/no-cache/cache-read/cache-write;
- output total/text/reasoning;
- missing optional buckets;
- explicit zero cache reads.

Acceptance:

- normalized values preserve exact reported integers;
- zero remains zero;
- missing remains absent/unknown;
- raw provider-specific payload is not copied into durable normalized Usage;
- source input is not mutated.

Negative tests:

- negative/non-finite tokens rejected;
- unexpected fields rejected at Runtime Event boundary;
- secrets/text blobs cannot enter Usage payload.

## 4. Slice 2 — Runtime Usage Event Contract

Red: `usage` is not currently an accepted Runtime Event type.

Green acceptance:

- `RUNTIME_EVENT_TYPES` accepts `usage`;
- only `kind=model.usage` schema-v1 payload passes;
- `runId`, `turnId`, `stepId`, Provider/model identity are validated;
- existing execution/tool/security/context/system payloads remain backward
  compatible;
- Runtime Store SQLite schema remains unchanged.

## 5. Slice 3 — One Effective Usage Fact per Model Step

Create Runtime history with:

```text
step-1 usage A
step-1 usage A duplicate
step-2 usage B
```

Acceptance:

- projection counts Step 1 once;
- Step 2 is added normally;
- totals equal A+B, not A+A+B.

Then create:

```text
step-1 usage A
step-1 usage incompatible-A2
```

Acceptance:

- projection reports integrity failure;
- incompatible facts are not both charged;
- UI summary cannot claim a complete trusted total.

## 6. Slice 4 — Real Runtime Store Persistence and Restart

Use disposable SQLite Runtime Store:

1. append completed Usage facts for multiple Model Steps;
2. close the Store;
3. reopen/recover the Session;
4. rebuild Session Usage projection.

Acceptance:

- token/cost/cache totals survive restart;
- replay after a Runtime snapshot produces the same result as full replay;
- old snapshots without Usage aggregate fields remain readable;
- no Server/API URL is used.

## 7. Slice 5 — Pricing Revision Resolution

Fixtures:

```text
revision A effective at T1
revision B effective at T2
```

Usage at T1 must select A; Usage at T2 must select B.

Acceptance:

- historical Usage retains the pricing snapshot/revision selected at completion;
- changing the current catalog does not reprice persisted old Usage;
- unknown model/Provider pricing produces unavailable cost, not zero;
- Custom OpenAI-compatible protocol does not inherit OpenAI pricing implicitly.

## 8. Slice 6 — Cost Engine Arithmetic

Table tests must cover:

- uncached input only;
- cache-read input with cheaper cache rate;
- cache-write bucket;
- output tokens;
- reasoning tokens as output subset without double charging;
- zero-token buckets;
- mixed bucket totals;
- deterministic rounding for tiny costs and large Sessions.

Acceptance:

```text
totalUsd == inputUsd + cacheReadUsd + cacheWriteUsd + outputUsd
```

within the documented deterministic rounding rule.

If a required price bucket is unknown, cost must be unavailable rather than
using a guessed substitute rate.

## 9. Slice 7 — Session Cost Coverage

Scenarios:

1. all Step costs known -> `coverage=complete` and exact calculated sum;
2. one known + one unknown -> `coverage=partial`;
3. all unknown -> `coverage=none`;
4. duplicate identical Step -> no extra cost;
5. conflicting duplicate Step -> integrity invalid.

StatusBar must never display a partial/none aggregate as a complete dollar
amount.

## 10. Slice 8 — Cache Hit Semantics

Cases:

```text
input=100, cacheRead=75 -> 75%
input=100, cacheRead=0  -> 0%
input=undefined         -> unavailable
cacheRead=undefined     -> unavailable
```

Multiple Steps aggregate with:

```text
sum(cacheRead) / sum(inputTotal)
```

Acceptance:

- output tokens never affect ratio;
- cacheWrite never enters numerator;
- explicit zero differs from missing;
- incomplete mixed telemetry produces partial/none coverage and V1 StatusBar
  renders `Cache —`.

## 11. Slice 9 — Current Context Projection Matches Canonical Pipeline

Build current Session state containing:

- instructions/skills/tools;
- ordinary history;
- Tool Results large enough to prune;
- a Compaction checkpoint;
- current model profile.

Compare the new Context observability seam with the same canonical Context
pipeline used by a real Model Step.

Acceptance:

- same selected Context records after projection;
- same estimated input token count;
- same input budget, Context Window, reserved output, and safety margin;
- no Provider request is executed;
- source Session/Context records are not mutated.

## 12. Slice 10 — Context Recompute Triggers

Verify Context summary changes appropriately after:

- user/assistant durable append;
- Tool terminal result;
- manual/automatic Compaction;
- Branch Summary carry;
- `/tree` branch selection;
- model change;
- mode/ToolSet change;
- Agent source reload.

Acceptance:

- branch switch changes Context numerator to selected branch;
- model switch changes Context Window/profile;
- Session cumulative API cost does **not** decrease merely because navigation
  selected an older branch;
- no StatusBar recompute creates a Session Entry or Runtime Event.

## 13. Slice 11 — Estimated vs Provider-reported Token Separation

Fixture:

```text
local Context estimate = 42,800
Provider input usage    = 43,271
```

Acceptance:

- `Ctx` uses 42,800 and marks estimated;
- API Usage uses 43,271 as Provider-reported;
- no reconciliation code forces the values equal;
- Cost uses Provider usage, never local Context estimate.

## 14. Slice 12 — Legacy Message Metadata Does Not Double Count

Create a Session containing historical assistant message metadata with Usage and
also create canonical Runtime Usage facts for the same/new Steps.

Acceptance:

- Session Usage projection counts Runtime Usage facts only;
- historical message metadata remains readable for legacy UI compatibility;
- no destructive Session migration occurs;
- new durable assistant writes no longer establish Usage authority in Session
  semantic history once the new producer is wired.

## 15. Slice 13 — Provider Completion Integration

Use a fake Provider through `LocalModelTransport`:

1. Provider completes with known `totalUsage`;
2. collector normalizes Usage;
3. pricing resolves;
4. Runtime Usage event commits;
5. Session Usage summary updates.

Acceptance:

- correlation uses the active run/turn/step IDs;
- exactly one effective Usage fact exists for the Model Step;
- Provider telemetry and durable Usage contain consistent normalized values;
- no prompt/message/body leaks to Runtime Event.

## 16. Slice 14 — Usage Persistence Failure After Provider Completion

Force Runtime Usage append to reject after fake Provider completion.

Acceptance:

- Provider is called exactly once;
- assistant result is not discarded merely to retry accounting;
- no second Model Step is invented;
- current process marks Usage/Cost coverage incomplete;
- missing Usage is not reconstructed from Context estimates;
- failure is visible to the user/log diagnostic boundary approved by design.

## 17. Slice 15 — StatusBar UI

Test the existing `StatusBar` with immutable observability summaries.

Cases:

```text
complete:
Build > deepseek/deepseek-v4-flash · Ctx ~42.8k/128k · API ~$0.0187 · Cache 72%

zero cache:
... · Cache 0%

unknown cache:
... · Cache —

unknown cost:
... · API —
```

Acceptance:

- `~` depends on Context counter quality;
- cost is Session cumulative, not current Step-only;
- unavailable never renders as zero;
- component performs no token/cost calculation itself;
- formatting handles large token/cost values deterministically.

## 18. Slice 16 — Mixed Provider / Model Session

Create one Session that switches models/providers across completed Steps.

Acceptance:

- each Usage fact retains its own Provider/model/pricing basis;
- Session tokens aggregate all effective facts;
- cost sums per-Step calculated cost without repricing through the currently
  selected model;
- cache aggregate follows coverage semantics across the mixed history;
- current Context uses only the currently selected model profile.

## 19. Slice 17 — No Persistence Boundary Regression

Acceptance:

- Session Store Prisma/schema unchanged;
- Runtime Store Prisma/schema unchanged;
- Runtime Event strict validation remains fail-closed;
- existing recovery/security/tool/context tests remain green;
- Stage 6.6 Cloud remains unused;
- no new Server dependency enters CLI startup or Model Step path.

## 20. Suggested Focused Verification Commands

Exact new filenames may evolve, but expected implementation verification is:

```text
bun test packages/harness/tests/runtime-usage.test.ts
bun test packages/harness/tests/runtime-session.test.ts
bun test packages/cli/tests/provider-usage.test.ts
bun test packages/cli/tests/cost-engine.test.ts
bun test packages/cli/tests/context-observability.test.ts
bun test packages/cli/tests/status-bar.test.tsx
bun test packages/cli/tests/local-model-transport-durability.test.ts
```

Then run full relevant Harness/CLI/Runtime Store suites, package typechecks,
CLI build, Prisma validation if persistence contracts changed, and
`git diff --check`.

## 21. Definition of Done

- one effective Runtime Usage fact per completed Model Step;
- Provider-reported Usage survives restart;
- exact duplicate Step Usage cannot double count;
- incompatible duplicate Step Usage fails integrity checks;
- historical pricing remains stable;
- Cost never uses Context estimates;
- Cache distinguishes 0 from unavailable;
- current Context reuses canonical Context projection and exposes quality;
- StatusBar shows Context, API Cost, and Cache using projection values only;
- Runtime append failure after Provider completion never repeats the Provider;
- no Session/Runtime SQLite schema migration is introduced unless a new design
  review explicitly supersedes this plan;
- all full regression/documentation gates pass before delivered-state claims.
