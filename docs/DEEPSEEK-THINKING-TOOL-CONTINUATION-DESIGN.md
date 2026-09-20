# DeepSeek Thinking + Tool Continuation Reliability — Technical Design

**Status:** IMPLEMENTED / VERIFIED

**Date:** 2026-08-29

**Related architecture:**

- `docs/PROVIDER-NATIVE-RUNTIME-DESIGN.md`
- `docs/CONTEXT-CACHE-COMPACTION-RELIABILITY-DESIGN.md`
- `docs/PI-INSPIRED-CONTEXT-COMPACTION-DESIGN.md`
- `docs/decisions/0031-native-provider-transport-and-chat-runtime.md`

---

## 1. Purpose

This document defines the DeepSeek-specific wire contract required by the native
Provider runtime when reasoning/thinking history, Tool Calls, Tool Results and
Context Compaction are combined in one long-running coding-agent Session.

The incident that motivated this design presented as:

```text
Provider request failed (HTTP 400): response body withheld
```

after several successful DeepSeek Tool continuation cycles. The failure was not a
TUI rendering problem and was not caused by Session persistence corruption. It was
caused by an incomplete DeepSeek Chat Completions serialization rule at the final
Provider wire boundary.

The design has two goals:

1. make DeepSeek thinking + Tool continuation serialization deterministic across
   ordinary history and compaction-rehydrated history;
2. keep Provider error diagnostics useful without allowing arbitrary Provider
   response bodies, prompts, Tool Results or secrets to leak into user-visible
   errors.

---

## 2. Scope

In scope:

- DeepSeek native `openai-chat-completions` request compilation;
- historical assistant `reasoning_content` replay;
- assistant records that have no reasoning block;
- Tool Call / Tool Result continuation;
- synthetic assistant messages produced by Checkpoint V2 compaction;
- post-compaction Provider request reconstruction;
- bounded structured Provider HTTP error diagnostics;
- regression coverage for all of the above.

Out of scope:

- changing canonical Session Entry schemas;
- changing Checkpoint V2 semantics;
- changing Tool Batch scheduling;
- changing Provider retry policy;
- changing DeepSeek pricing/cache accounting;
- changing OpenAI, Anthropic, Google or Custom Provider message contracts except
  through shared HTTP error handling;
- exposing raw Provider response bodies.

---

## 3. Incident topology

The inspected local Session showed the following sequence immediately before the
failure:

```text
assistant_message
  reasoning + tool
tool_call
tool_result

assistant_message
  tool only
  reasoningParts = 0
tool_call
tool_result

compaction
  trigger = tool-pressure

Provider HTTP 400
Provider HTTP 400
```

The important detail is that a valid assistant Model Step can contain a Tool Call
without a persisted reasoning part. Compaction then inserts a synthetic assistant
checkpoint message that also has no reasoning part.

Before this correction, both message shapes could cross the DeepSeek boundary with
`reasoning_content` completely absent.

---

## 4. Root cause

The project-owned normalized message model is Provider-independent:

```text
NativeModelMessage
  role
  content[]
    text
    reasoning
    tool-call
    tool-result
```

That model is correct. The defect was in the DeepSeek/OpenAI-compatible wire
serializer.

Previous behavior effectively required all of the following before it emitted
`reasoning_content`:

```text
Provider is DeepSeek
AND role is assistant
AND reasoning text exists
AND the same assistant record contains a Tool Call
```

This was too narrow.

It caused at least three invalid/fragile wire shapes:

```text
assistant + reasoning + text, no Tool Call
  -> reasoning_content omitted

assistant + Tool Call, no reasoning block
  -> reasoning_content omitted

synthetic compaction checkpoint assistant
  -> reasoning_content omitted
```

Long Tool chains made the issue more visible because Context pressure eventually
triggered compaction, causing the synthetic checkpoint assistant to become part of
the next DeepSeek request.

---

## 5. Required DeepSeek wire invariant

For DeepSeek requests compiled with the project Tool definitions, every assistant
history object MUST contain the `reasoning_content` property.

Normative rules:

```text
assistant has one or more reasoning parts
  -> reasoning_content = exact joined reasoning text

assistant has no reasoning part
  -> reasoning_content = ""

non-assistant message
  -> do not add DeepSeek reasoning_content
```

This is a Provider-adapter rule. It does not mutate canonical Session messages.

### 5.1 Example: ordinary reasoning history

Canonical message:

```text
assistant
  reasoning: "Inspect the repository first."
  text:      "I will inspect it."
```

DeepSeek wire object:

```json
{
  "role": "assistant",
  "content": "I will inspect it.",
  "reasoning_content": "Inspect the repository first."
}
```

### 5.2 Example: Tool Call with no reasoning block

Canonical message:

```text
assistant
  tool-call: readFile(...)
```

DeepSeek wire object:

```json
{
  "role": "assistant",
  "content": null,
  "reasoning_content": "",
  "tool_calls": [
    {
      "type": "function",
      "id": "...",
      "function": {
        "name": "readFile",
        "arguments": "{...}"
      }
    }
  ]
}
```

### 5.3 Example: compaction checkpoint

Checkpoint V2 is rendered into a synthetic assistant text message by the Context
Compactor. It is semantic state, not Provider thinking output.

DeepSeek serialization therefore becomes:

```json
{
  "role": "assistant",
  "content": "<deterministic Checkpoint V2 rendering>",
  "reasoning_content": ""
}
```

The checkpoint remains provider-independent in Session/Context storage. The empty
DeepSeek field exists only in the adapter's wire representation.

---

## 6. Serialization algorithm

The relevant boundary is:

```text
Session Tree
  -> canonical Context Projection
  -> NativeModelMessage[]
  -> openAIChatMessages(...)
  -> DeepSeek Chat Completions JSON
  -> native fetch()
```

The implementation uses the existing `includeAssistantReasoning` adapter option,
but its meaning is now strict:

```ts
includeReasoning =
  options.includeAssistantReasoning
  && message.role === "assistant";
```

When enabled for DeepSeek:

```ts
reasoning_content: reasoning.join("\n")
```

is emitted even when `reasoning.length === 0`, in which case the value is the empty
string.

The generic Custom/OpenAI-compatible Provider path does not enable this rule.

---

## 7. Tool continuation invariants

Tool semantics remain unchanged:

```text
assistant Tool Call
  -> durable tool_call
  -> Tool Runtime side effect
  -> durable tool_result
  -> next Model Step
```

The Provider wire continuation must preserve:

- original assistant text;
- original assistant reasoning, when present;
- explicit empty `reasoning_content` when it was absent;
- Tool Call ID;
- Tool name;
- Tool arguments;
- matching Tool Result ID;
- Tool Result content;
- message ordering.

No Tool Result is rewritten in canonical Session history to satisfy DeepSeek.

---

## 8. Interaction with Context Compaction

Compaction remains governed by the Stage-C transaction:

```text
plan
  -> reduce
  -> validate
  -> durable commit
  -> rehydrate
  -> Provider
```

This fix adds no new compaction state.

However, it establishes an important adapter invariant:

> Rehydration may legitimately replace old Provider history with a synthetic
> Checkpoint V2 assistant message. Provider adapters must serialize that canonical
> checkpoint into a request shape accepted by their protocol.

For DeepSeek, that means the synthetic checkpoint assistant must receive
`reasoning_content: ""` at wire time.

The Context system must not preserve arbitrary historical reasoning merely to satisfy
a Provider-specific syntax rule. Provider syntax belongs in the Provider adapter.

---

## 9. Cache behavior

The correction improves cache stability but does not redefine cache authority.

Within one Context Epoch:

- old assistant reasoning is replayed deterministically;
- assistant messages with no reasoning use a deterministic empty field;
- Tool schemas remain unchanged;
- Tool continuation appends new messages without retroactively mutating old wire
  messages.

At a compaction boundary:

- the Context Epoch intentionally rebases;
- old history may be represented by Checkpoint V2;
- the checkpoint receives deterministic DeepSeek serialization;
- a cache miss caused by the epoch transition remains classified as an intentional
  rebase, not same-epoch prefix mutation.

---

## 10. Provider HTTP diagnostic design

The native HTTP layer already bounded error-body reads to 4096 bytes. Before this
change it intentionally discarded all body content after reading it, surfacing only:

```text
Provider request failed (HTTP 400): response body withheld
```

This was safe but operationally insufficient.

The new contract is allowlist-based.

### 10.1 Raw bodies remain withheld

Arbitrary text, HTML and unknown JSON structures MUST NOT be surfaced.

```text
text/plain response
  -> response body withheld

unknown JSON payload
  -> response body withheld
```

### 10.2 Structured JSON error envelope

When the response is JSON and contains an object-shaped `error` envelope, only these
fields may be surfaced:

```text
type
code
param
message
```

All other top-level or nested fields are ignored.

Each surfaced field is:

- required to be a string;
- stripped of control characters;
- whitespace-normalized;
- capped at 512 characters.

Example:

```text
Provider request failed (HTTP 400):
type=invalid_request_error;
param=messages[3].reasoning_content;
message=Missing reasoning_content ...
```

---

## 11. Security and privacy invariants

The diagnostic enhancement MUST NOT expose:

- API keys or authorization headers;
- request headers;
- raw prompt/system prompt;
- user conversation history;
- Tool input/output payloads;
- full Provider response bodies;
- arbitrary JSON fields returned by a Provider;
- temporary Provider-context recorder files.

The temporary exact Provider request recorder remains opt-in and governed by Stage C7.
It is not used as the user-facing error channel.

---

## 12. Failure handling

DeepSeek HTTP 4xx failures remain non-retryable by default unless the existing HTTP
policy explicitly classifies them otherwise.

This fix does not add automatic replay.

Reason:

```text
request may already have external/provider-side effects
  -> do not silently duplicate it
```

Structured diagnostics improve the next debugging step without changing side-effect
semantics.

---

## 13. Regression requirements

The DeepSeek adapter must cover at least these cases:

1. assistant reasoning + Tool Call replays exact reasoning;
2. assistant reasoning + ordinary text replays exact reasoning when tools are in the
   request;
3. assistant Tool Call without reasoning emits `reasoning_content: ""`;
4. compaction-style assistant text without reasoning emits
   `reasoning_content: ""`;
5. consecutive Tool continuation preserves earlier structured message prefix;
6. DeepSeek cache usage normalization remains unchanged;
7. generic OpenAI-compatible providers do not receive the DeepSeek-only behavior.

The HTTP layer must cover:

1. arbitrary provider bodies remain hidden;
2. structured JSON diagnostics surface allowlisted fields;
3. unrelated secret/echo fields remain hidden;
4. retry/timeout/SSE behavior remains unchanged.

---

## 14. Acceptance criteria

The fix is accepted only if all of the following hold:

- the real failure shape from the local Session is represented in tests;
- DeepSeek assistant messages always have deterministic `reasoning_content` when the
  DeepSeek Tool-enabled adapter path is used;
- compaction checkpoint history is accepted by the same serializer without adding
  Provider-specific fields to canonical Checkpoint V2;
- Provider errors remain secret-safe;
- focused Provider tests pass;
- full CLI regression passes;
- Harness regression passes;
- CLI TypeScript typecheck passes;
- production CLI build passes;
- `git diff --check` passes.

---

## 15. Implementation map

Primary implementation:

```text
packages/cli/src/lib/native-provider-executor.ts
packages/cli/src/lib/provider-http.ts
```

Regression coverage:

```text
packages/cli/tests/native-provider-executor.test.ts
packages/cli/tests/provider-http.test.ts
```

Related unchanged authority boundaries:

```text
packages/cli/src/lib/native-message-compiler.ts
packages/cli/src/lib/local-model-transport.ts
packages/cli/src/lib/context-compactor.ts
packages/harness/src/compaction-checkpoint.ts
packages/harness/src/context.ts
```

---

## 16. Design decision summary

The project will not solve Provider syntax constraints by contaminating canonical
Session or Checkpoint state with Provider-specific fields.

The stable architecture is:

```text
canonical provider-independent history
        ↓
durable compaction/checkpoint authority
        ↓
provider-specific final wire serialization
        ↓
DeepSeek always receives valid assistant reasoning_content
```

For diagnostics:

```text
raw Provider error body
        ↓
bounded read
        ↓
strict JSON envelope allowlist
        ↓
useful type/code/param/message only
```

This keeps Session semantics provider-independent while making the native DeepSeek
adapter protocol-correct, compaction-safe and operationally diagnosable.
