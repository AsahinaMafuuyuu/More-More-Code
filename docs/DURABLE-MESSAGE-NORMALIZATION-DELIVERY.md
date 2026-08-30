# Durable Message Normalization Delivery Contract

**Delivery state:** Delivered — 2026-08-26.

**Target:** Stage 6.5 local Session authority follow-up, not a new cloud/sync stage.

## 1. Business/User Requirement

After local Session authority became strict and durable-first, a valid model interaction can reach the persistence boundary with AI SDK runtime message fields such as `providerMetadata: undefined`. The current Store correctly rejects that JavaScript-only representation as non-JSON-safe, which blocks the conversation even though the semantic value is simply an absent optional field.

The delivered fix must allow ordinary AI SDK messages to be stored locally without weakening Session integrity.

The user-visible success criterion is:

> A local conversation can stream assistant text/reasoning/tool updates, persist them, restart, and continue without failing merely because an optional AI SDK message property is represented as explicit `undefined`.

## 2. Accepted Product/Architecture Decision

Use Scheme C: introduce a dedicated durable-message normalization boundary between AI SDK/UI runtime messages and Session semantic history.

The Local Session Store remains strict. It must not automatically discard unsupported data.

Canonical policy:

- object property `undefined` -> omitted;
- array `undefined` or sparse hole -> explicit `null` without shifting indexes;
- valid JSON-safe values -> preserved;
- valid JSON-safe `providerMetadata` -> preserved;
- unsupported JavaScript values -> fail closed;
- no generic JSON stringify/parse coercion.

## 3. Delivered Artifacts

### D1 — Durable Message Adapter

Delivered in `packages/cli/src/lib/durable-session-message.ts`, including the message-specific normalizers and the single normalized Session Tree append boundary.

### D2 — Normal Message Persistence Integration

Delivered. Normal AI SDK message synchronization crosses `appendDurableSessionMessages` before Harness Session Tree construction.

### D3 — Compaction Integration

Delivered. The pre-compaction history synchronization path uses the same adapter in the same semantic authority transition.

### D4 — Tool Terminal Consolidation

Delivered. The private Tool-terminal `omitUndefined` implementation was removed and Tool message/data normalization now reuses the shared Session policy without changing commit-before-expose ordering.

### D5 — Regression and Contract Tests

Delivered, including the required real Red reproduction before the production change and full contract/integration/restart regressions.

### D6 — Documentation and Decision Record

Delivered after the full verification matrix passed.

## 4. Explicit Non-Deliverables

The implementation must not bundle any of the following into this follow-up:

- Stage 6.6 cloud Session sync or account/entitlement work;
- legacy v1/v2/v3 Session import;
- Provider API behavior changes;
- removal of all Provider metadata;
- Session Store schema redesign;
- Runtime Store changes;
- Harness ownership of AI SDK-specific normalization;
- Windows sandbox work;
- unrelated UI changes.

## 5. Engineering Constraints

1. Preserve append-only Session Entry semantics.
2. Preserve durable-first side-effect ordering.
3. Preserve separation of Session Store and Runtime Store.
4. Preserve Harness as provider-independent generic Session/Context machinery.
5. Preserve the Store as a strict JSON integrity boundary.
6. Do not mutate AI SDK/React runtime messages in place.
7. Do not introduce a second normalization implementation after consolidation.
8. Preserve unrelated user working-tree changes.
9. Use TDD for the implementation, one red/green slice at a time.

## 6. Required Failure Behavior

The fix is not allowed to turn strict errors into silent data loss.

Examples that must still fail rather than becoming `null`, strings, or missing fields:

```text
NaN / Infinity
bigint
function
symbol
cycle
Date / Map / Set / class instance
symbol-keyed property
```

The Store remains an independent final validator even if the new adapter provides earlier diagnostics.

## 7. Definition of Done

The follow-up is delivered only when all of the following are true:

- the exact `providerMetadata: undefined` production failure has a real regression test and is fixed;
- all runtime-message persistence paths in scope use the single normalization seam;
- valid Provider metadata survives persistence and restart;
- repeated synchronization is idempotent and does not generate redundant semantic updates;
- Tool terminal and compaction durability behavior remain unchanged except for the normalization compatibility fix;
- unsupported values remain fail-closed;
- CLI, Session Store, and Harness verification matrices pass;
- CLI typecheck/build and `git diff --check` pass;
- implementation and documentation are committed as a focused Stage 6.5 follow-up with no unrelated files;
- current-state docs are changed from `planned` to `delivered` only after all verification evidence exists.

## 8. Rollback Boundary

No database migration is expected. Therefore rollback should consist of reverting the normalization integration and its tests/docs without migrating stored Session data.

Any Session message written by the accepted design remains ordinary JSON-safe Session data and should remain readable by the pre-fix Store. This is an important compatibility property and must be retained during implementation.

## 9. Implementation Record

The implementation followed the prescribed reading order and TDD gate. Before production code changed, the real Local Session persistence path reproduced the exact `providerMetadata: undefined` JSON-safety failure. Production changes then stayed inside the CLI semantic adapter/integration layer; neither Harness nor Session Store persistence semantics were relaxed.

The pre-existing unrelated working-tree modification to root `AGENTS.md` was preserved and is not part of this delivery.

## 10. Final Delivery Evidence

- Focused normalization/Session/Tool regressions: `19 pass, 0 fail` across the critical files.
- Full CLI suite: `153 pass, 0 fail` on final run.
- Local Session Store suite: `11 pass, 0 fail`.
- Harness suite: `99 pass, 0 fail`.
- CLI and Session Store TypeScript checks: pass.
- CLI build: pass.
- `git diff --check`: pass.
- No database migration, Provider API behavior change, Runtime Store change, cloud sync work, or unrelated UI work was introduced.
