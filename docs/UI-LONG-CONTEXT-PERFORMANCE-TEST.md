# UI Long-Context Performance Test Contract

**Status:** Active — 2026-08-29

## Deterministic correctness/performance tests

### LC-1 LocalChatRuntime structural sharing

- Seed thousands of finalized messages.
- Stream many deltas into one assistant message.
- Historical message references and payloads remain unchanged.
- Only the changed assistant message is replaced.
- Full-history reads remain available explicitly.

### LC-2 bounded transcript materialization

- Project a synthetic transcript containing at least 10,000 messages.
- Materialized messages remain under the configured hard bound plus round-boundary
  allowance.
- Latest round is always present.
- Hidden count is exact.
- Small transcripts remain unchanged.

### LC-3 round semantics on a bounded window

- A tail beginning inside a round extends backward to its user message when within
  boundary allowance.
- The active run summary remains associated with the visible round.

### LC-4 ToolUse canonical/live split

- Canonical tool result continues to win over live hints.
- Live running/approval state remains visible without a canonical terminal.
- A chat-only revision can be projected from a prebuilt canonical index.

### LC-5 collapsed hidden-content bounds

- Reasoning preview is bounded before render while expand restores the full source.
- ToolUse detail serialization is not performed when collapsed.
- A one-million-character user/assistant text message produces a renderer preview
  below 20K characters while preserving its full source outside the renderer.

## Existing regression gates

```text
bun test packages/cli/tests/local-chat-runtime.test.ts
bun test packages/cli/tests/long-context-ui.test.ts
bun test packages/cli/tests/runtime-activity-ui.test.tsx
bun test packages/cli/tests/session-ui-render-isolation.test.tsx
bun test packages/cli/tests/tool-use-view-model.test.ts
bun run --filter @more-more-code/cli test
bun run build:cli
bun run tui:stress
git diff --check
```

Wall-clock benchmark output may be recorded as supporting evidence, but pass/fail is
based primarily on bounded-work invariants so CI noise cannot hide an O(N) regression.
