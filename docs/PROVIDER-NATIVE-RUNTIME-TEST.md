# Native Provider Runtime — Verification Plan

## Test philosophy

Tests target project-owned seams rather than provider implementation details. No test requires a real provider key.

## T1 — Native message contract

- text/reasoning/step/tool parts validate correctly;
- `isToolUIPart` and `getToolName` preserve current callers;
- assistant tool call + durable tool terminal compiles to one call/result pair;
- unknown provider-visible structures fail before network execution.

## T2 — Native HTTP/SSE transport

- parses CRLF/LF SSE framing and multiline `data:`;
- ignores comments/heartbeats;
- handles final unterminated event;
- abort cancels body reader;
- timeout aborts request and body reads;
- non-2xx error reads are bounded;
- credential/provider bodies are not copied into user-facing errors;
- retry classification covers 408/409/429/5xx and `x-should-retry` overrides;
- retry sleep is abortable.

## T3 — OpenAI Responses adapter

- exact endpoint + auth header;
- `store:false`;
- cache key contains canonical prefix fingerprint;
- no `previous_response_id`;
- tool schema and tool result mapping;
- text/reasoning/function-call streaming;
- cached input usage mapping;
- completed/failed/incomplete terminal handling.

## T4 — Anthropic adapter

- exact endpoint + version/api-key headers;
- stable system cache-control;
- tools use `input_schema`;
- text/thinking/tool-use stream mapping;
- cache read/cache creation usage mapping;
- stop-reason mapping.

## T5 — DeepSeek/custom Chat adapter

- exact endpoint/auth/no-auth behavior;
- streaming text/reasoning/tool-call argument assembly;
- `[DONE]` handling;
- DeepSeek prompt cache hit/miss mapping;
- custom providers tolerate missing usage.

## T6 — Google Gemini adapter

- native Gemini endpoint;
- `x-goog-api-key`, no credential in URL;
- system instruction/content/tool mapping;
- functionCall/functionResponse mapping;
- token/cache/thought usage mapping.

## T7 — Prefix compilation cache

- identical prefix identity is a cache hit;
- mode/tool/prompt fingerprint change is a miss;
- capacity eviction is bounded;
- cached values contain no auth/dynamic messages;
- equivalent stable input serializes identically.

## T8 — LocalModelTransport durability

Preserve existing scenarios using a fake project-owned ProviderExecutor:

- one normalized Usage completion;
- accounting failure does not retry;
- exactly one Tool Call/Result pair;
- follow-up after multiple durable assistant steps;
- automatic checkpoint commit precedes provider request;
- checkpoint commit rejection prevents provider request;
- manual compaction waits for durable commit.

## T9 — LocalChatRuntime

- sends current messages;
- reduces stream deltas into finalized assistant message;
- tool input becomes `input-available`;
- `addToolOutput` updates the matching part;
- stop aborts the active request;
- onFinish/onError are emitted exactly once;
- `setMessages` supports navigation/recovery resets.

## T10 — Static dependency gate

Verify no source/package reference remains:

```text
git grep -n -E 'from "ai"|@ai-sdk|"ai":' -- packages
```

Expected: no matches.

## T11 — Package/workspace validation

Run, at minimum:

```text
bun test packages/cli/tests/provider-*.test.ts
bun test packages/cli/tests/local-model-transport-durability.test.ts
bun test packages/cli/tests/chat-submit.test.ts
bun run --filter @more-more-code/shared typecheck
bun run --filter @more-more-code/harness test
bun run --filter @more-more-code/cli typecheck
bun run --filter @more-more-code/cli build
```

If package scripts differ, use the repository's actual equivalent commands and record them in delivery notes.

## Performance checks

- compile the same stable prefix repeatedly and assert the LRU reports hits;
- ensure dynamic messages do not enter the stable cache;
- run at least 1,000 local adapter/stream-parser iterations with mock fetch and assert no unbounded cache growth;
- compare request payload stable prefix serialization across repeated turns byte-for-byte.
