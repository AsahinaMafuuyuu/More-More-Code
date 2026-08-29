# Native Provider Runtime — Technical Design

## 1. Goal

Replace the Vercel AI SDK execution path with a MORE-MORE-CODE-owned native provider runtime while preserving the current local-first authority model, durable Session Tree semantics, Context projection rules, tool execution lifecycle, compaction durability, usage/cost accounting, and TUI presentation behavior.

The runtime must send requests directly with `fetch()` to the configured provider endpoint. Provider-specific request/stream semantics stay behind adapters. Canonical Context and Session records remain provider-independent.

This design supersedes only the AI-SDK-specific execution decision in ADR-0010. It does **not** change the stable-to-dynamic Context ordering, prompt-prefix identity, Session authority, or compaction checkpoint rules.

## 2. Non-goals

- Do not make provider-owned conversation state authoritative.
- Do not introduce `previous_response_id` as Session state.
- Do not move model execution into React or Server.
- Do not bypass the Provider Registry, Credential Store, Permission Engine, Tool Runtime, Context Manager, or Runtime Usage persistence.
- Do not add a second canonical message format. Existing persisted Session messages keep the same structural shape.
- Do not silently retry a completed provider response because post-completion persistence or accounting fails.

## 3. Reference design from pi

The implementation borrows architectural ideas from `earendil-works/pi`, not its dependencies:

1. A uniform provider stream contract with provider-specific API adapters.
2. Provider-neutral request options (`signal`, timeout, retry, headers/fetch seam, cache retention/session identity).
3. Explicit provider cache controls and provider-native cache usage accounting.
4. Abort-aware retry/backoff around the network request instead of hidden SDK retries.
5. Normalized model events and usage at the adapter boundary.

MORE-MORE-CODE differs in two important ways:

- transport is implemented with native `fetch()` + SSE parsing instead of provider SDK clients;
- normalized events are projected into the existing local Session/UI message contract and remain subordinate to the Harness/Session authority.

## 4. Current problems

The existing runtime couples five responsibilities through the AI SDK:

```text
Provider resolution
    -> AI SDK LanguageModel
    -> AI SDK message conversion/validation
    -> streamText/generateText
    -> AI SDK UI message stream
    -> @ai-sdk/react useChat
```

Consequences:

- provider protocol behavior is partly implicit in external adapters;
- cache-control fields and provider-native usage buckets are only available after SDK normalization;
- error/retry/timeout behavior is split between project code and SDK behavior;
- tool-call streaming and response parsing cannot be tuned independently;
- the project cannot guarantee exact byte-stable provider payload prefixes;
- request diagnostics and compatibility behavior are harder to test at the real HTTP seam.

## 5. Target architecture

```text
Session Tree / Agent Loop
        |
        v
Canonical Context Projection
        |
        v
Native Model Request Compiler
        |
        +--> OpenAI Responses Adapter
        +--> Anthropic Messages Adapter
        +--> DeepSeek Chat Adapter
        +--> Google Gemini Adapter
        +--> Custom OpenAI-compatible Adapter
        |
        v
Native HTTP/SSE Transport (fetch)
        |
        v
Normalized Provider Events + Usage
        |
        +--> Message Stream Projection
        +--> Cache Telemetry
        +--> Runtime Usage / Cost
```

The UI side becomes:

```text
SessionController
    <-> LocalChatRuntime (project-owned state machine)
        <-> LocalModelTransport

React/TUI only subscribes to LocalChatRuntime state.
```

## 6. Modules and interfaces

### 6.1 `chat-types.ts`

Own the persisted/UI message types that were previously imported from `ai`.

Required parts:

- text;
- reasoning;
- step-start;
- dynamic `tool-${name}` parts;
- tool states: input-streaming/input-available/output-available/output-error;
- metadata containing mode/model/duration/usage.

Provide local helpers equivalent to the narrow behavior actually used today:

- `isToolUIPart(part)`;
- `getToolName(part)`.

No dependency on provider transport is allowed here.

### 6.2 `provider-runtime.ts`

Becomes the provider execution boundary rather than an AI SDK option compiler.

Core model:

```ts
type ProviderRequestProtocol =
  | "openai-responses"
  | "anthropic-messages"
  | "openai-chat-completions"
  | "google-generative-ai";

type ResolvedModel = {
  provider: ProviderKind;
  providerId: ProviderId;
  modelId: string;
  protocol: ProviderRequestProtocol;
  endpoint: string;
  auth: ResolvedProviderAuth;
  modelOptions?: ProviderModelOptions;
};
```

`ResolvedModel` is an execution descriptor, not an SDK object.

### 6.3 `provider-http.ts`

Deep module that owns:

- native `fetch`;
- request timeout;
- AbortSignal composition;
- retry policy;
- retry-after parsing;
- bounded error-body capture;
- credential-safe error normalization;
- SSE line/event framing;
- JSON decode errors;
- response status/headers callback seam.

Retryable status policy:

- network error before response;
- 408;
- 409;
- 429;
- 5xx;
- honor `x-should-retry: true|false` when present.

Default model execution retries: `0` for the first landing to preserve current side-effect behavior. The retry module exists and is independently tested so a future explicit policy can enable it safely.

### 6.4 `provider-protocol.ts`

Provider-neutral request/event contract:

```ts
type NativeModelRequest = {
  system: string;
  messages: ModelMessage[];
  tools: NativeToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  reasoning?: ...;
  prefixIdentity: PromptPrefixIdentity;
  cacheRetention: "none" | "short" | "long";
};

type ProviderStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "usage"; usage: ProviderUsage }
  | { type: "finish"; reason: ProviderFinishReason }
  | { type: "error"; error: Error };
```

Provider adapters consume canonical input and emit only these normalized events.

### 6.5 Provider adapters

#### OpenAI Responses

Endpoint: `/v1/responses`.

Request invariants:

- `store: false`;
- `stream: true` for model steps;
- `prompt_cache_key = more-more-code:<PromptPrefixFingerprint>`;
- optional long retention maps to `prompt_cache_retention: "24h"`;
- no `previous_response_id`;
- tools are native Responses function tools;
- reasoning configuration remains model/provider local.

Usage mapping:

- `input_tokens` -> total input;
- `input_tokens_details.cached_tokens` -> cache read;
- `input - cached` -> no-cache when both values are known;
- output tokens + reasoning detail when available.

#### Anthropic Messages

Endpoint: `/v1/messages`.

Request invariants:

- `anthropic-version` header;
- system prompt expressed as content blocks;
- stable system block receives `cache_control: { type: "ephemeral" }` by default;
- long retention may use `ttl: "1h"` where supported;
- final stable/history boundary may receive an additional cache breakpoint only when it is deterministic;
- tools use Anthropic `input_schema`.

Usage mapping:

- `input_tokens`;
- `cache_read_input_tokens`;
- `cache_creation_input_tokens`;
- `output_tokens`.

#### DeepSeek

Endpoint: official `/chat/completions`.

Use OpenAI-compatible Chat Completions wire format but keep a dedicated adapter policy for DeepSeek reasoning and usage fields.

Map DeepSeek cache fields when present:

- `prompt_cache_hit_tokens` -> cache read;
- `prompt_cache_miss_tokens` -> no-cache;
- `prompt_tokens` -> total input.

#### Google Gemini

Use the provider-native Gemini `generateContent` / `streamGenerateContent` protocol rather than routing the built-in provider through an OpenAI compatibility shim.

Authentication uses `x-goog-api-key` so the credential never appears in request URLs or diagnostics.

Usage mapping:

- `promptTokenCount` -> input;
- `cachedContentTokenCount` -> cache read;
- `candidatesTokenCount` -> output text;
- `thoughtsTokenCount` -> reasoning when reported.

Explicit cached-content creation is out of scope for this first landing; the adapter records implicit/provider-reported cache usage and keeps the protocol ready for an explicit cached-content strategy.

#### Custom provider

V1 remains OpenAI-compatible Chat Completions.

- preserve explicit no-auth behavior;
- never inject ambient OpenAI credentials;
- tolerate missing usage details;
- do not assume DeepSeek-specific fields unless returned.

## 7. Canonical message compiler

The current AI SDK `convertToModelMessages()` behavior is replaced by a local compiler.

Input remains the existing Session/UI message shape. Output is a small provider-neutral `ModelMessage` representation:

```ts
type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: ModelContent[] }
  | { role: "assistant"; content: ModelContent[] }
  | { role: "tool"; content: ToolResultContent[] };
```

Rules:

1. Text and reasoning are retained only when provider-visible.
2. Assistant tool calls compile once.
3. Tool terminal parts compile as exactly one matching tool result.
4. `step-start` and pure UI metadata are not sent.
5. Unknown UI-only parts fail closed in validation instead of silently changing provider semantics.
6. Branch-summary system records remain inserted by Context projection exactly where they are today.

## 8. Tool schema ownership

Remove `tool()` from `@more-more-code/shared`.

Tool contracts become plain project-owned descriptors:

```ts
{
  description: string;
  inputSchema: ZodType;
  outputSchema: ZodType;
}
```

`z.toJSONSchema()` remains the canonical schema serializer already used by Tool Registry. This preserves deterministic ToolSet fingerprints and removes the AI SDK from the shared package.

## 9. Cache hit optimization

### 9.1 Preserve semantic prefix identity

Keep ADR-0010/ADR-0030 ordering and fingerprints unchanged. PLAN and BUILD remain separate cache families when tool exposure differs.

### 9.2 Provider-native cache controls

Do not infer cache controls through SDK provider options. Emit them directly in provider request payloads.

### 9.3 Byte-stable prefix serialization

Introduce a bounded provider request-prefix cache keyed by:

```text
providerId
modelId
protocol
PromptPrefixFingerprint
ToolSetFingerprint
cacheRetention
```

The cached object contains only immutable stable material (system/tool definitions and provider-specific stable wrappers). Dynamic conversation records are appended per request.

Properties:

- small bounded LRU (default 32 identities);
- immutable/cloned values at public boundaries;
- no credentials;
- no user dynamic history;
- no timestamps/request IDs;
- cache invalidates naturally when the prompt/tool fingerprint changes.

This improves local CPU/serialization work and, more importantly, ensures the provider sees an exactly stable prefix representation between turns.

### 9.4 Cache telemetry

Own a project `ProviderUsage` shape instead of `LanguageModelUsage`:

```ts
type ProviderUsage = {
  inputTokens?: number;
  inputNoCacheTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  outputTextTokens?: number;
  outputReasoningTokens?: number;
};
```

Telemetry records provider-reported values only. Missing fields remain missing; they are never guessed.

## 10. Local Chat Runtime

Replace `@ai-sdk/react useChat` with `LocalChatRuntime`.

Responsibilities:

- own current message array;
- own `ready/submitted/streaming/error` status;
- own active AbortController;
- call `LocalModelTransport.sendMessages()`;
- reduce native model stream chunks into one assistant Message;
- expose `setMessages`, `sendMessage`, `addToolOutput`, `stop`;
- invoke controller completion/error callbacks;
- provide `subscribe/getSnapshot` for React via `useSyncExternalStore`.

It does **not** own durable Session persistence; `SessionController` remains responsible for accepting and persisting finalized steps/tool terminals.

## 11. Failure semantics

### Before provider side effect

- invalid model/provider/auth -> fail before fetch;
- context compaction checkpoint persistence failure -> fail before fetch;
- invalid tool/message compilation -> fail before fetch.

### During provider request

- timeout/abort -> abort fetch and stream reader;
- malformed SSE/JSON -> protocol error;
- non-2xx -> bounded provider error classification;
- terminal stream missing required finish event -> protocol error.

### After provider completion

- Usage persistence failure is diagnostic only and must never retry provider;
- Session finalization remains owned by SessionController;
- a completed response is never replayed implicitly.

## 12. Security

- credentials exist only in the resolved execution descriptor/request header assembly and are never stored in telemetry/cache entries;
- provider error bodies are bounded and not surfaced raw by default;
- diagnostic URLs strip userinfo/query/fragment;
- Google API key is sent via header, not query string;
- custom provider `auth: none` produces no Authorization/x-api-key header;
- payload debug hooks are not persisted and must not be added to normal UI logs.

## 13. Migration sequence

### Stage N1 — Internal protocol types and tests

- own message/tool/usage types;
- native model-message compiler;
- native Provider event contract;
- zero provider behavior change yet.

### Stage N2 — HTTP/SSE core

- native fetch;
- timeout/abort;
- retry policy;
- bounded errors;
- SSE parser tests.

### Stage N3 — Provider adapters

- OpenAI Responses;
- Anthropic Messages;
- DeepSeek Chat;
- Google Gemini native;
- Custom Chat.

### Stage N4 — Cache optimization and accounting

- direct cache controls;
- prefix LRU;
- usage normalization;
- cache telemetry/cost compatibility.

### Stage N5 — LocalModelTransport cutover

- replace `generateText/streamText/convertToModelMessages/toUIMessageStream`;
- preserve compaction-before-side-effect ordering;
- preserve tool call/result semantics.

### Stage N6 — LocalChatRuntime cutover

- replace `@ai-sdk/react useChat`;
- preserve bridge/controller behavior.

### Stage N7 — Dependency removal and closeout

- remove `ai` and all `@ai-sdk/*` dependencies/imports;
- regenerate lockfile;
- run focused + package + workspace verification;
- update ADR/current-state/delivery docs.

## 14. Rollback strategy

Each provider adapter is isolated behind the same project-owned interface. A provider can be disabled or temporarily routed to a compatibility adapter without changing Context/Session semantics. The old AI SDK path is not kept as a parallel runtime after closeout because two execution stacks would create divergent behavior and double the test surface.

## 15. Acceptance criteria

1. `git grep` finds no runtime or package dependency on `ai` / `@ai-sdk/*`.
2. Built-in providers resolve to explicit native protocols and official endpoints.
3. OpenAI cache key is derived from the canonical prefix fingerprint.
4. Anthropic cache control is present on stable content when enabled.
5. Provider cache-read/write buckets survive into Runtime Usage without guessing missing values.
6. Tool call/result pairing remains exactly-once across durable continuation.
7. automatic/manual compaction still commits before the provider side effect.
8. abort interrupts fetch/stream consumption.
9. post-completion usage persistence failures do not cause provider retry.
10. CLI typecheck/build and focused Harness/CLI tests pass.
