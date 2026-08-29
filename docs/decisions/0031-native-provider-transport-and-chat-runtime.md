# ADR-0031: Native Provider Transport and Project-Owned Chat Runtime

## Status

Accepted — implemented and verified

## Date

2026-08-28

## Context

ADR-0010 established a correct provider-independent Context boundary and deterministic prompt-cache identity, but Stage 5 intentionally kept the Vercel AI SDK as the common streaming/tool integration surface. The current runtime therefore resolves configured providers into AI SDK `LanguageModel` objects and depends on AI SDK message conversion, streaming, usage normalization, and React `useChat` state.

The project now requires direct provider request ownership for protocol fidelity, predictable error/timeout behavior, cache-control tuning, provider-native cache telemetry, and reduced coupling to an external cross-provider abstraction.

The local-first Session Tree, canonical Context projection, compaction checkpoint durability, Tool Runtime, and Runtime Usage persistence remain valid and must not move into provider adapters.

## Decision

MORE-MORE-CODE will remove Vercel AI SDK from its runtime and shared tool contracts.

Model requests are sent with native `fetch()` through project-owned HTTP/SSE infrastructure. OpenAI Responses, Anthropic Messages, DeepSeek Chat Completions, Google Gemini, and custom OpenAI-compatible providers each use a provider adapter behind one normalized request/event interface.

The project also replaces `@ai-sdk/react useChat` with `LocalChatRuntime`, a local in-memory state machine that projects provider stream events into the existing Session/UI message shape. `SessionController` remains the durable authority and accepts finalized model/tool steps exactly as before.

Provider cache controls are emitted directly. Prompt cache identity continues to derive from the canonical `PromptPrefixFingerprint`, and a bounded credential-free stable-prefix compilation cache is added to make repeated provider payload prefixes byte-stable and cheaper to compile.

Provider usage is normalized directly from native response fields. Missing cache buckets remain missing; values are never synthesized merely to make telemetry appear complete.

## Preserved decisions

The following ADR-0010 decisions remain unchanged:

- stable-to-dynamic canonical Context ordering;
- PLAN/BUILD cache-family separation through ToolSet identity;
- provider adapters do not own Session semantics;
- persisted compaction checkpoints are reused;
- OpenAI provider conversation state is not canonical;
- cache telemetry is diagnostic/runtime observability, not semantic history.

## Alternatives considered

### Keep AI SDK and only inject a custom fetch

Rejected. This changes HTTP mechanics but leaves message conversion, stream semantics, provider cache fields, and usage interpretation owned by the SDK.

### Use official provider SDKs instead

Rejected for this stage. Official SDKs improve protocol fidelity but still hide parts of retry/timeout/stream parsing and do not provide one consistent local execution seam. Native fetch keeps the runtime dependency-light and fully testable.

### Keep `@ai-sdk/react` only for UI state

Rejected. It would leave the SessionController dependent on AI SDK transport/chunk semantics after provider execution had moved away from them, creating an unnecessary compatibility layer.

### Use one OpenAI-compatible protocol for every provider

Rejected. It reduces implementation work but loses provider-native capabilities and cache/usage semantics, especially for Anthropic and Gemini.

## Consequences

Positive:

- request/stream/cache behavior is explicit and locally testable;
- provider usage buckets retain native fidelity;
- stable prompt prefixes can be serialized deterministically;
- fewer runtime dependencies and no Vercel AI SDK compatibility surface;
- abort/retry/error behavior is consistent and project-owned.

Costs:

- MORE-MORE-CODE now owns provider protocol maintenance;
- SSE and tool-call assembly require regression tests for provider API evolution;
- Google/Anthropic/OpenAI compatibility changes must be tracked explicitly;
- provider adapters become part of the project's long-term maintenance surface.

## Verification

Implementation completed on 2026-08-28.

- all runtime/shared package references to `ai` and `@ai-sdk/*` were removed;
- OpenAI Responses, Anthropic Messages, DeepSeek/OpenAI-compatible Chat Completions and native Google Generative AI execute through project-owned adapters;
- `LocalChatRuntime` replaced `@ai-sdk/react useChat`;
- stable-prefix LRU and provider-native cache telemetry are active;
- CLI regression: 301 tests passed;
- Harness regression: 107 tests passed;
- focused native-provider/runtime suite: 26 tests passed, including 1,000-turn prefix-cache reuse (999 hits / 1 miss);
- Shared/CLI/Harness/Server typechecks passed;
- CLI and Server builds passed;
- `bun install --dry-run --frozen-lockfile` passed and the resolved install graph contains no AI SDK packages.

See `docs/PROVIDER-NATIVE-RUNTIME-TEST.md` and `docs/PROVIDER-NATIVE-RUNTIME-DELIVERY.md`.
