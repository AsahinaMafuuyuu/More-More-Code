# UI Transcript Disclosure — Delivery

**Status:** Delivered — 2026-08-28

## Delivered

- Two-row collapsed reasoning with in-place expansion.
- Aggregate two-or-more consecutive Tool groups with total/success/failure
  status counts; a lone Tool remains a direct one-row disclosure.
- Nested one-row ToolUse disclosure with stronger semantic typography/color.
- Focused OpenTUI renderer regression coverage.
- Cache-stable Tool Result Context projection per ADR-0030: oversized results
  receive the same deterministic bounded model representation from first
  exposure onward, independent of later freshness/neighbor changes.
- Model-visible projection source identity is stable `tool-call:<id>` rather
  than changing when a Session Entry lookup becomes available.

## Verification

- Focused Context/UI suite: **23 passed, 0 failed**.
- Full Harness suite: **107 passed, 0 failed**.
- Full CLI suite: **290 passed, 0 failed**.
- CLI TypeScript no-emit check: passed.
- Harness TypeScript no-emit check: passed.
- CLI production build: passed (`680` modules bundled in the verification run).
- `git diff --check`: passed (line-ending conversion warnings only).
- Native OpenTUI stress suite: passed the complete `idle 20s -> stream 45s ->
  churn 45s` matrix. Churn completed at about `303.2` source updates/sec with
  `13,644` source updates, `3,995` scroll operations and `1,096` dialog
  operations; final-state and commit-budget checks were true.
- Native stress runtime: Bun `1.4.0`, OpenTUI `0.5.9`.

## Authority / boundary audit

- No Session Entry schema or Runtime Event schema changed.
- No Tool terminal-authority precedence changed; the UI still consumes the
  existing semantic `ToolUseView` projection.
- No Provider transport contract or AI SDK serialization path changed.
- Complete Tool Results remain durable Session facts; only model-facing Context
  projection policy changed.
- The previous age/aggregate-pressure Tool Result policy in ADR-0013 is
  superseded only in that narrow area by ADR-0030.

## Known intentional cache invalidators

This delivery removes the accidental historical Tool Result rewrites. It does
not claim every Provider request will hit cache. Intentional prefix changes can
still occur at semantic Compaction/checkpoint replacement, model/provider/tool
set or stable-system-prefix changes, branch navigation, or Provider-side cache
eviction/expiry.
