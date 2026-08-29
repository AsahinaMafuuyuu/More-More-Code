# Native Provider Runtime — Delivery Record

## Delivery status

Delivered and verified on 2026-08-28.

This delivery removes Vercel AI SDK from the CLI/shared execution path and replaces it with project-owned native Provider transport and chat state. The implementation follows ADR-0031 and preserves Session Tree authority, Context Projection, Tool Runtime, compaction durability and Runtime Usage semantics.

## Implemented architecture

### Project-owned message and chat runtime

- `packages/cli/src/lib/chat-types.ts` owns runtime/UI Message, reasoning, text and Tool-part contracts.
- `packages/cli/src/lib/local-chat-runtime.ts` owns in-memory chat state, streaming reduction, cancellation and Tool output attachment.
- `SessionController` remains the durable authority; React/OpenTUI subscribes through `useSyncExternalStore`.
- Shared Tool contracts are plain project descriptors backed by Zod schemas; no AI SDK `tool()` wrapper remains.

### Native Provider transport

- `packages/cli/src/lib/provider-http.ts` owns native `fetch()`, bounded provider errors, timeout, abort, retry classification and SSE parsing.
- Response acquisition and stalled-stream body reads both have timeout/cancellation coverage.
- Model execution defaults to zero automatic retries so a request with possible Provider side effects is never silently replayed.
- Retry infrastructure is available for explicit future policies and supports 408/409/429/5xx, `x-should-retry`, `retry-after-ms` and `retry-after`.

### Provider adapters

- OpenAI: native Responses API, `store:false`, deterministic `prompt_cache_key`, optional 24h retention, no canonical `previous_response_id`.
- Anthropic: native Messages API, stable system cache breakpoint plus deterministic conversation-end cache breakpoint, cache-read/cache-creation usage buckets.
- DeepSeek: native OpenAI-compatible Chat Completions request with DeepSeek reasoning/cache-hit/cache-miss fields.
- Google: native Generative AI `streamGenerateContent`, `x-goog-api-key`, full tool JSON Schema through `parametersJsonSchema`, native function calls/responses and cache/thought usage.
- Custom: OpenAI-compatible Chat Completions with explicit API-key/Bearer/None authentication and no ambient credential injection.

### Cache-hit optimization

The existing canonical `PromptPrefixFingerprint` / `ToolSetFingerprint` remains the semantic cache identity. Provider adapters now emit cache controls directly instead of relying on SDK normalization.

A process-local stable-prefix LRU caches only immutable system/tool material. Its key contains provider/model/protocol, prompt-prefix fingerprint, ToolSet fingerprint and retention mode. Capacity is 32 identities. Credentials and dynamic conversation history are excluded.

The repeated-turn test executes 1,000 requests with changing user content and one unchanged stable prefix:

```text
misses: 1
hits:   999
size:   1
capacity: 32
```

This is a deterministic local compilation/cache-identity result, not a claim that a Provider will report a 99.9% billed-token cache-hit rate. Provider cache hit remains measured only from Provider-reported cache-read/input usage.

## Regression found during implementation

The new Anthropic adapter initially merged a later `message_delta` usage object containing only output tokens over the earlier `message_start` cache buckets. Missing values therefore erased cache-read/cache-write data. The adapter was corrected so normalization drops unreported fields before incremental usage merge. The regression now has a dedicated test.

## DeepSeek cache and billing correction — 2026-08-28

A follow-up audit against current DeepSeek protocol/pricing behavior and the local Runtime Usage database found three independent defects.

### Thinking-mode Tool continuation was dropping `reasoning_content`

The native message compiler preserved assistant reasoning, but the DeepSeek/OpenAI-compatible wire serializer discarded it before the next Chat Completions request. DeepSeek thinking-mode Tool Calls require the assistant `reasoning_content` to be replayed with the Tool Call continuation. The DeepSeek adapter now emits that field for assistant Tool-call messages. Generic Custom/OpenAI-compatible providers do not receive this DeepSeek-specific field.

This matters for both reasoning continuity and cache stability: dropping model-output reasoning changes the request prefix that DeepSeek can reuse on the next Tool continuation.

### DeepSeek cache usage now has a dedicated strict parser

DeepSeek usage is no longer interpreted through the generic OpenAI cache-detail fallback. The adapter reads `prompt_tokens`, `prompt_cache_hit_tokens`, and `prompt_cache_miss_tokens` directly and fails closed when all three are present but `hit + miss != prompt_tokens`. No DeepSeek cache-write billing bucket is synthesized.

### Time-of-use billing schedule was corrected

The prior Cost Engine incorrectly treated DeepSeek peak windows as weekday-only and used an outdated tariff effective boundary. Peak/off-peak windows now apply every UTC day, and the current tariff is effective from `2026-08-16T16:00:00Z`.

One observed local Runtime Usage record demonstrated the impact:

```text
timestamp:  2026-08-29T06:46:47.744Z
input:      18,326
cache hit:  15,872
cache miss:  2,454
output:        923

old stored cost:  $0.001260164  (incorrect off-peak basis)
correct cost:     $0.002520328  (peak basis)
```

Existing persisted Runtime Usage events remain immutable and are not silently rewritten. New Model Steps use the corrected tariff. A historical correction, if required, must be an explicit versioned migration/correction mechanism rather than mutation of append-only Runtime Events.

### Status-bar cache semantics were clarified

The compact status bar previously displayed the entire Session's cumulative cache-read ratio. That is valid as a Session aggregate but is misleading when comparing the UI with one Provider request/billing line. The status bar now prefers the latest Provider request's reported hit ratio when available; the durable Session Usage projection still retains the cumulative aggregate for accounting/analytics.

For the inspected seven-step Session, the cumulative hit ratio was about `59.5%`, while the latest Provider request was `15,872 / 18,326 = 86.6%`; the compact status therefore reports `Cache 87%` after that request.

## Long Tool-chain / Context follow-up — 2026-08-29

The Session that exposed the former 64-Step failure was inspected directly from the local append-only Session/Runtime stores. Its failed interaction contained:

```text
Harness Turns: 27
Model Steps:    27
Tool Steps:     37
Total Steps:    64
Exact duplicate Tool name+input calls: 0
```

This was a legitimate long coding-agent interaction rather than a trivial repeated-call loop. AgentLoop defaults now use independent Turn, Model-Step and Tool-Step budgets plus a much higher total safety ceiling; a regression executes 141 total Steps under defaults and completes normally.

The same Session also showed why cache percentage alone was not sufficient to diagnose Context behavior. Provider-reported `cacheReadTokens` grew monotonically from `4,736` to `51,456`; temporary hit-rate drops occurred when new uncached Tool/current-tail material grew faster than the cached prefix. The prefix itself was not repeatedly collapsing after the DeepSeek reasoning-continuation fix.

At the Context layer, however, the final projection contained about `61.4k` estimated input tokens of which about `49.9k` were Tool Results. The configured Tool working-set signal had been over budget since the middle of the interaction while `prunedResults=0`, because every individual result remained below the per-result projection threshold. Aggregate Tool pressure now triggers one explicit `tool-pressure` Context checkpoint rather than retroactively changing old Tool Result bytes.

A DeepSeek wire regression also compares consecutive Tool-continuation bodies and verifies that the second request retains the entire first `messages[]` prefix byte-equivalently at the structured JSON boundary, keeps the Tool schema/reasoning effort unchanged, and only appends the new assistant Tool Call plus Tool Result.

Automatic semantic compaction can itself consume Provider tokens. That auxiliary usage is now aggregated into the owning Model Step's persisted Usage/Cost fact so an earlier Context-maintenance request cannot become invisible local spend.

## Home runtime configuration hint

The startup Home screen now shows the effective mode, provider/model, and non-secret reasoning effort beside the Composer, for example:

```text
Build › deepseek/deepseek-v4-flash · Reasoning Medium        tab Build/Plan
```

The previous `tab agents` text was incorrect for the actual Composer binding: Tab toggles BUILD/PLAN, so both Home and Session interaction hints now label that behavior accurately.

## Dependency closeout

Removed direct dependencies from CLI/shared manifests:

- `ai`
- `@ai-sdk/react`
- `@ai-sdk/openai`
- `@ai-sdk/anthropic`
- `@ai-sdk/deepseek`
- `@ai-sdk/provider-utils`

Static source/package grep returns no matches under `packages/**`. `bun install --dry-run --frozen-lockfile` succeeds, and its resolved install graph contains no AI SDK packages.

## Verification matrix

### Focused native runtime

```text
bun test packages/cli/tests/native-provider-executor.test.ts \
  packages/cli/tests/provider-http.test.ts \
  packages/cli/tests/local-chat-runtime.test.ts \
  packages/cli/tests/local-model-transport-durability.test.ts \
  packages/cli/tests/provider-runtime.test.ts \
  packages/cli/tests/provider-usage.test.ts \
  packages/cli/tests/chat-submit.test.ts
```

Result: 26 passed, 0 failed.

### Full CLI regression

```text
bun test packages/cli/tests
```

Latest DeepSeek-correction regression was executed in partitioned groups to keep native Windows test output bounded:

```text
109 passed + 14 passed + 189 passed
= 312 passed, 0 failed, 1,037 assertions across 70 files
```

Existing React test warnings about updates outside `act(...)` remain warnings only; they are unrelated to this Provider Runtime change.

### Harness regression

```text
bun run --cwd packages/harness test
```

Result: 109 passed, 0 failed, 371 assertions.

### Type/build/lock verification

The following completed successfully:

```text
bun run --cwd packages/harness typecheck
bunx tsc -p packages/shared/tsconfig.json --noEmit
bunx tsc -p packages/cli/tsconfig.json --noEmit
bunx tsc -p packages/server/tsconfig.json --noEmit
bun run --filter @more-more-code/server build
bun run --filter @more-more-code/cli build
bun install --dry-run --frozen-lockfile
```

## External-network boundary

No real Provider credentials were used during automated verification. Provider wire requests, headers, SSE streams, usage fields, errors, timeout behavior and cache controls are tested through injected/mock `fetch` responses. This avoids secret exposure and nondeterministic billed requests. A real-provider smoke test can be run separately with user-configured credentials, but it is not required for this repository-level delivery.

## Compatibility and rollback

- Persisted Session Tree and Runtime Usage schemas are unchanged.
- Provider conversation state is still non-canonical.
- Existing compaction checkpoint-before-side-effect ordering is preserved and regression-tested.
- Tool Call/Result exactly-once continuation remains regression-tested.
- The old AI SDK execution path is intentionally not retained as a parallel fallback; rollback is a source-level revert of ADR-0031 implementation rather than runtime dual-stack selection.
