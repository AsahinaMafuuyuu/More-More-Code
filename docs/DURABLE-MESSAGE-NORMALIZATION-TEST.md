# Durable Message Normalization Test Plan

**Status:** Verified — 2026-08-26. The implementation and regression suite satisfy this plan.

**Design under test:** `docs/DURABLE-MESSAGE-NORMALIZATION-DESIGN.md`

## 1. Test Objective

Prove that the CLI converts AI SDK runtime messages into canonical JSON-safe Session messages before semantic persistence, while preserving strict failure behavior for genuinely unsupported values.

The test suite must demonstrate both sides of the contract:

- expected AI SDK optional-state artifacts such as `providerMetadata: undefined` persist successfully after normalization;
- unsupported JavaScript values are not silently coerced, deleted, or stringified.

## 2. Pre-Agreed Test Seams

Tests must target observable module boundaries rather than private recursion details.

### Seam A — Durable Message Adapter

Public behavior:

```ts
normalizeDurableMessage(message)
normalizeDurableMessages(messages)
```

Purpose: specify canonicalization independently from SQLite and React.

Likely test file:

```text
packages/cli/tests/durable-session-message.test.ts
```

### Seam B — Local Session Semantic Commit

Public behavior: a message synchronized through the local Session authority can be committed and loaded through `LocalSessionStore` without a JSON-safe error.

Purpose: prove the adapter is actually connected to the persistence path rather than only unit-tested in isolation.

Likely existing test files to extend:

```text
packages/cli/tests/local-session-durable-turn.test.ts
packages/cli/tests/local-session-tool-durability.test.ts
packages/cli/tests/local-session-authority.test.ts
```

### Seam C — Message Synchronization / Restart

Public behavior: assistant messages containing AI SDK-style optional `undefined` fields become durable once, survive restart, restore correctly, and do not produce duplicate `message_update` Entries on semantically unchanged re-sync.

Purpose: cover the exact production failure class and equality/idempotency behavior.

The implementation agent should prefer existing CLI/session integration seams over testing private `useChat` callbacks directly.

## 3. TDD Order

Implementation must follow red -> green one vertical slice at a time.

### Slice 1 — Object Optional Field

**Red:** a durable text message with `providerMetadata: undefined` cannot currently cross strict Session persistence.

Input:

```ts
{
  id: "assistant-1",
  role: "assistant",
  parts: [{
    type: "text",
    text: "hello",
    providerMetadata: undefined,
    state: "done",
  }],
}
```

Expected durable representation:

```ts
{
  id: "assistant-1",
  role: "assistant",
  parts: [{
    type: "text",
    text: "hello",
    state: "done",
  }],
}
```

Acceptance:

- no `providerMetadata` own property remains on that part;
- the original runtime message is not mutated;
- Local Session commit succeeds.

### Slice 2 — Nested Objects and Arrays

Verify recursively:

```ts
{
  metadata: {
    keep: 1,
    omit: undefined,
    nested: { omitToo: undefined, keepToo: true },
  },
  values: ["a", undefined, "b"],
}
```

Expected:

```ts
{
  metadata: {
    keep: 1,
    nested: { keepToo: true },
  },
  values: ["a", null, "b"],
}
```

Also include a sparse array fixture and assert its length and element positions are preserved with explicit `null`.

### Slice 3 — Valid Provider Metadata Preservation

Input contains nested, JSON-safe Provider metadata.

Acceptance:

- metadata content survives normalization and Store round-trip;
- key order is not used as an assertion of semantic correctness unless testing Store canonicalization itself;
- no Provider-specific interpretation is introduced.

### Slice 4 — Unsupported Values Stay Fail-Closed

Table-driven negative coverage should include:

| Value | Required behavior |
|---|---|
| `NaN` | reject; never convert to `null` |
| `Infinity` / `-Infinity` | reject |
| `1n` | reject |
| function | reject |
| symbol value | reject |
| symbol-keyed property | reject |
| cyclic object | reject |
| `new Date()` | reject |
| `new Map()` / `new Set()` | reject |
| class instance | reject |

The test may observe rejection at the durable-message seam or at the existing Store validation boundary, depending on final implementation, but it must prove there is no silent lossy conversion.

### Slice 5 — `__proto__` Safety

Construct an object with an own enumerable `__proto__` data property.

Acceptance:

- normalized output retains the own data property;
- output object's prototype is not attacker-controlled;
- Store commit/round-trip preserves the string-keyed data.

### Slice 6 — Re-Sync Idempotency

Scenario:

1. runtime message contains `providerMetadata: undefined`;
2. first sync commits the normalized durable message;
3. restore/project the Session message;
4. synchronize an equivalent runtime message that again contains explicit `undefined`;
5. inspect Session Tree Entry count/topology.

Acceptance:

- the second sync does not append a redundant `message_update`;
- active branch topology is unchanged except for semantically real changes.

### Slice 7 — Tool Terminal Regression

The current Tool terminal path already strips `undefined` through a private helper. After consolidation into the shared durable-message seam, preserve existing behavior:

- terminal Tool Result commits before UI exposure;
- optional Tool UI fields with `undefined` do not break persistence;
- array positions are preserved;
- invalid non-plain Tool output still fails strict persistence rather than being silently serialized;
- no duplicate or missing `tool_result` / `message_update` fact is introduced.

### Slice 8 — Compaction Pre-Sync Regression

Create history containing an assistant runtime message with explicit optional `undefined`, then trigger the existing compaction synchronization path.

Acceptance:

- history synchronization succeeds before the compaction Entry is appended;
- checkpoint source history is durable in the same authority transition;
- normalization does not alter compaction metadata or Context semantics.

### Slice 9 — Restart Round-Trip

Persist a normalized assistant message, close/reopen the local Session Store, restore the Session Tree, project messages, then continue with another fake Provider step.

Acceptance:

- restored message is canonical and JSON-safe;
- valid Provider metadata survives;
- omitted optional fields remain absent;
- continuation does not require Server/API_URL access;
- Session Tree remains append-only.

## 4. Regression Reproduction Requirement

Before the implementation is changed, at least one focused test must fail with the current production class of error. The red test should exercise the real semantic commit path and include:

```ts
providerMetadata: undefined
```

The expected red failure should include or correspond to:

```text
...providerMetadata must be JSON-safe
```

Do not satisfy the red phase with a synthetic test that calls only the future normalizer and never reaches Session persistence.

## 5. Mutation and Purity Checks

Normalization must not mutate runtime/UI state.

Tests should retain the original object and verify:

- original own `providerMetadata` property still exists with value `undefined`;
- original nested arrays/objects remain unchanged;
- returned durable message is a separate representation suitable for Session persistence.

This prevents React/AI SDK runtime state from being silently rewritten for the convenience of persistence.

## 6. Suggested Focused Commands

Exact filenames may change during implementation, but the intended verification sequence is:

```text
bun test packages/cli/tests/durable-session-message.test.ts
bun test packages/cli/tests/local-session-durable-turn.test.ts
bun test packages/cli/tests/local-session-tool-durability.test.ts
bun test packages/cli/tests/local-session-authority.test.ts
```

After focused green tests:

```text
bun test packages/cli/tests
bun run --cwd packages/session-store test
bun run --filter @more-more-code/harness test
bunx tsc --noEmit -p packages/cli/tsconfig.json
bunx tsc --noEmit -p packages/session-store/tsconfig.json
bun run build:cli
git diff --check
```

If implementation changes any Harness API or Session Store contract unexpectedly, stop and re-read the design instead of widening the change casually.

## 7. Acceptance Matrix

| Requirement | Unit | Integration | Restart |
|---|---:|---:|---:|
| object `undefined` omitted | required | required | required |
| array `undefined` -> `null` | required | required | optional |
| sparse array position retained | required | optional | optional |
| valid Provider metadata preserved | required | required | required |
| unsupported values fail | required | required | optional |
| `__proto__` remains data | required | required | optional |
| no input mutation | required | optional | n/a |
| duplicate `message_update` avoided | optional | required | required |
| Tool terminal durability unchanged | optional | required | optional |
| compaction pre-sync unchanged | optional | required | optional |
| zero mandatory cloud dependency | n/a | required | required |

## 8. Exit Criteria

Implementation is not considered delivered until:

- every test seam above is covered at the appropriate level;
- the original `providerMetadata: undefined` reproduction is green through the real persistence path;
- strict negative cases remain strict;
- full CLI, Session Store, and Harness suites pass;
- CLI and Session Store typechecks pass;
- CLI build passes;
- `git diff --check` passes;
- no unrelated working-tree changes are included in the implementation commit.

This verification plan is now fulfilled by the delivered Stage 6.5 follow-up implementation and its regression suite.

## 9. Verification Evidence

The required Red phase was reproduced before production implementation. A real local semantic commit containing an assistant text part with enumerable `providerMetadata: undefined` reached the strict Local Session Store and failed with:

```text
Session Tree state.entries[1].message.parts[0].providerMetadata must be JSON-safe
```

Delivered automated coverage includes:

- `packages/cli/tests/durable-session-message.test.ts` — normalization contract, sparse arrays, Provider metadata, `__proto__`, strict negative values, no mutation, idempotent re-sync, and compaction pre-sync;
- `packages/cli/tests/durable-session-message-persistence.test.ts` — real SQLite commit/restart round-trip with both explicit runtime `undefined` and valid Provider metadata, with zero Server fetches;
- `packages/cli/tests/local-session-tool-durability.test.ts` — shared Tool-terminal policy, array-position preservation, fail-closed non-plain output, and commit-before-expose ordering;
- existing Local Session durable-turn, authority, compaction, Provider, and runtime suites remain green.

Final verification evidence:

```text
bun test packages/cli/tests                         -> 153 pass, 0 fail
bun run --cwd packages/session-store test          -> 11 pass, 0 fail
bun run --filter @more-more-code/harness test      -> 99 pass, 0 fail
bunx tsc --noEmit -p packages/cli/tsconfig.json    -> pass
bunx tsc --noEmit -p packages/session-store/tsconfig.json -> pass
bun run build:cli                                  -> pass
git diff --check                                   -> pass
```

One first full-CLI attempt encountered the existing Windows/libsql temporary-directory `EBUSY` cleanup race after all business assertions had passed. The affected authority file then passed independently, and the subsequent complete CLI run passed `153/153`; no test-infrastructure behavior was changed for this delivery.
