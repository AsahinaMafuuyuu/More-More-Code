# DeepSeek Thinking + Tool Continuation Reliability — Delivery Record

**Status:** DELIVERED / VERIFIED

**Date:** 2026-08-29

**Design:**

- `docs/DEEPSEEK-THINKING-TOOL-CONTINUATION-DESIGN.md`

**Related delivery records:**

- `docs/PROVIDER-NATIVE-RUNTIME-DELIVERY.md`
- `docs/CONTEXT-CACHE-COMPACTION-RELIABILITY-DELIVERY.md`

---

## 1. Delivery summary

This delivery fixes the DeepSeek V4 thinking + Tool continuation HTTP 400 observed in
a real local Session after a Tool-pressure Context Compaction.

Two defects were corrected:

1. the DeepSeek wire serializer omitted `reasoning_content` for some assistant
   history objects;
2. the native HTTP layer read bounded Provider error bodies but then hid all useful
   structured diagnostics behind `response body withheld`.

No Session database migration, Checkpoint migration or canonical message rewrite is
required.

---

## 2. User-visible incident

The TUI displayed:

```text
Provider request failed (HTTP 400): response body withheld
```

after multiple successful reasoning/Tool steps.

The visible sequence made the error look like a generic Provider failure, but the
local Session authority showed a deterministic protocol boundary failure.

---

## 3. Evidence from the real local Session

The latest inspected Session had the failure immediately after this durable sequence:

```text
sequence 49  assistant_message
             reasoning + tool-bash

sequence 50  tool_call
sequence 51  tool_result

sequence 52  assistant_message
             tool-readFile
             reasoningParts = 0

sequence 53  tool_call
sequence 54  tool_result

sequence 55  compaction
             trigger = tool-pressure

sequence 56  error
             HTTP 400

sequence 57  error
             HTTP 400
```

The committed compaction used a content-addressed Compaction Plan and retained the
newer Tool tail. The Session/Checkpoint authority itself was intact.

The important protocol condition was the combination of:

```text
DeepSeek thinking model
+ Tool definitions present
+ assistant history without a reasoning block
+ synthetic compaction assistant history
```

---

## 4. Implemented fix

### 4.1 DeepSeek assistant reasoning serialization

Changed:

```text
packages/cli/src/lib/native-provider-executor.ts
```

Previous behavior emitted `reasoning_content` only when an assistant record had both
reasoning text and a Tool Call.

Delivered behavior:

```text
DeepSeek assistant history + reasoning exists
  -> reasoning_content = exact reasoning text

DeepSeek assistant history + no reasoning exists
  -> reasoning_content = ""
```

This covers:

- reasoning + text history;
- reasoning + Tool Call history;
- Tool Call history with no reasoning block;
- Checkpoint V2 synthetic assistant history;
- post-compaction Provider reconstruction;
- repeated Tool continuation.

The Custom/OpenAI-compatible Provider path does not opt into the DeepSeek-specific
reasoning field.

### 4.2 Structured safe HTTP diagnostics

Changed:

```text
packages/cli/src/lib/provider-http.ts
```

The existing bounded 4096-byte error-body read remains.

For arbitrary bodies the behavior is still:

```text
response body withheld
```

For a standard JSON error envelope, only these string fields are allowed through:

```text
type
code
param
message
```

Each field is normalized and bounded to 512 characters. Unknown response fields are
ignored.

This provides actionable 400 diagnostics without turning Provider errors into a raw
prompt/Tool-output exfiltration channel.

---

## 5. Files changed

Implementation:

```text
packages/cli/src/lib/native-provider-executor.ts
packages/cli/src/lib/provider-http.ts
```

Tests:

```text
packages/cli/tests/native-provider-executor.test.ts
packages/cli/tests/provider-http.test.ts
```

Documentation/changelog:

```text
CHANGELOG.md
docs/DEEPSEEK-THINKING-TOOL-CONTINUATION-DESIGN.md
docs/DEEPSEEK-THINKING-TOOL-CONTINUATION-DELIVERY.md
```

No database schema file was modified.

---

## 6. TDD evidence

Two regressions were added before implementation.

Initial focused result:

```text
12 pass
2 fail
```

The failing cases were exactly:

```text
DeepSeek prior assistant reasoning was not serialized
structured Provider JSON diagnostic was not surfaced
```

After the first implementation, the real Session inspection exposed an additional
edge condition: assistant Tool history may have no reasoning block. A second
DeepSeek regression was therefore added for explicit empty `reasoning_content`.

Final focused result:

```text
15 pass
0 fail
57 expect() calls
```

---

## 7. Full regression results

### CLI

```text
346 pass
0 fail
1176 expect() calls
75 files
```

Existing React renderer tests still emit some pre-existing `act(...)` warnings.
Those warnings did not cause failures and are unrelated to this Provider fix.

### Harness

```text
130 pass
0 fail
566 expect() calls
17 files
```

### TypeScript

```text
bunx tsc --noEmit -p packages/cli/tsconfig.json
PASS
```

### Production CLI build

```text
646 modules bundled
index.js ~6.87 MB
PASS
```

### Diff hygiene

```text
git diff --check
PASS
```

Windows LF -> CRLF notices remain Git warnings only.

---

## 8. Compatibility

### Existing Sessions

Existing local Sessions do not require repair.

Persisted assistant messages remain provider-independent. On the next DeepSeek
request, the adapter reconstructs the corrected wire shape dynamically:

```text
persisted assistant with reasoning
  -> replay exact reasoning_content

persisted assistant without reasoning
  -> reasoning_content: ""
```

### Existing Checkpoints

Checkpoint V2 remains unchanged.

Existing checkpoint summary messages receive the required empty DeepSeek
`reasoning_content` only during request serialization.

### Other Providers

No Provider-specific message behavior was intentionally changed for:

- OpenAI Responses;
- Anthropic Messages;
- Google Generative AI;
- generic Custom OpenAI-compatible providers.

The HTTP diagnostic allowlist is shared and remains provider-neutral.

---

## 9. Runtime behavior after delivery

The corrected path is:

```text
Tool Batch terminal
        ↓
optional tool-pressure compaction
        ↓
Checkpoint V2 validate + commit
        ↓
rehydrate accepted checkpoint
        ↓
compile NativeModelMessage[]
        ↓
DeepSeek adapter
        ↓
every assistant wire object has reasoning_content
        ↓
Provider request
```

If the Provider still rejects the request, the UI can now receive a bounded diagnostic
such as:

```text
Provider request failed (HTTP 400):
type=...;
param=...;
message=...
```

when the Provider returns that information inside the supported JSON envelope.

---

## 10. Security review

Preserved protections:

- authorization headers are not included in surfaced diagnostics;
- arbitrary response text is not surfaced;
- raw prompt/context is not surfaced;
- Tool arguments/results are not surfaced through HTTP diagnostics;
- unknown JSON keys are not surfaced;
- diagnostic fields are length bounded;
- temporary full Provider-context recording remains opt-in and separate.

The change improves observability without weakening the existing "raw body withheld"
default.

---

## 11. Operational guidance

After pulling/applying this delivery, restart the local CLI:

```bash
npm run dev:cli
```

The affected Session may be continued directly.

Do not:

- delete the Session;
- edit SQLite manually;
- delete the Checkpoint V2 entry;
- clear Provider credentials merely because this historical 400 occurred.

If another 400 appears, capture the newly surfaced bounded `type/code/param/message`
diagnostic first. That diagnostic should be sufficient to distinguish a new Provider
contract issue from the resolved reasoning-content defect.

---

## 12. Rollback

This delivery is source-revertable.

Rollback does not require:

- Session migration;
- database rollback;
- Checkpoint migration;
- Context Epoch repair.

However, reverting the DeepSeek serialization fix can reintroduce the original HTTP
400 condition for Tool-enabled thinking Sessions, especially after compaction.

---

## 13. Remaining boundaries

This delivery does not claim a live external DeepSeek E2E test was executed as part of
the automated regression suite. The verification is based on:

- direct inspection of the real failing local Session structure;
- deterministic wire-body unit tests;
- native HTTP error tests;
- complete CLI/Harness regression;
- typecheck/build/diff gates.

The temporary Stage-C exact Provider request recorder remains available for an
explicit future cache/protocol investigation and is still intentionally not removed.

---

## 14. Delivery conclusion

The failure was a Provider adapter protocol bug at the final wire serialization layer,
made observable by a long Tool chain and a subsequent Tool-pressure compaction.

The delivered invariant is now:

```text
DeepSeek + Tool-enabled history
  -> every assistant wire message carries reasoning_content
  -> exact reasoning when available
  -> empty string when unavailable
```

and the HTTP diagnostic boundary is now:

```text
arbitrary body
  -> withheld

structured JSON error
  -> bounded allowlisted type/code/param/message
```

The implementation is regression-tested and requires no Session or database
migration.
