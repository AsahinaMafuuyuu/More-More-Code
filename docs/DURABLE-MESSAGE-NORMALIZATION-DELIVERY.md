# Durable Message Normalization Delivery Contract

**Delivery state:** Design approved; implementation pending.

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

## 3. Required Deliverables for the Future Implementation

### D1 — Durable Message Adapter

A CLI-owned Session semantic adapter that exposes a small message-specific normalization interface and contains one authoritative normalization policy.

### D2 — Normal Message Persistence Integration

All normal AI SDK message synchronization entering `appendSessionTreeMessages` is normalized first.

### D3 — Compaction Integration

The pre-compaction history synchronization path uses the same normalization boundary.

### D4 — Tool Terminal Consolidation

Existing Tool-terminal `undefined` cleanup is consolidated into the shared durable-message policy without changing durable-first Tool ordering.

### D5 — Regression and Contract Tests

Tests defined in `docs/DURABLE-MESSAGE-NORMALIZATION-TEST.md`, including a red reproduction of the real persistence failure before the implementation change.

### D6 — Documentation and Decision Record

ADR-0025 and current-state/task documentation updated to reflect the implemented state only after verification succeeds.

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

## 9. Handoff to the Implementation Agent

Before writing code, the next agent must read in this order:

1. `.more-more-code/AGENTS.md`;
2. ADR-0024 and ADR-0025;
3. `docs/DURABLE-MESSAGE-NORMALIZATION-DESIGN.md`;
4. `docs/DURABLE-MESSAGE-NORMALIZATION-TEST.md`;
5. this delivery contract;
6. the Stage 6.5 follow-up section in `tasks/plan.md` and `tasks/todo.md`.

Then reproduce the failure with the first red integration test before changing production code.

## 10. Current Documentation-Only Delivery

This planning delivery intentionally changes documentation only. It does not implement the normalizer, modify message persistence code, alter the Session Store validator, or add passing/failing production regression tests.
