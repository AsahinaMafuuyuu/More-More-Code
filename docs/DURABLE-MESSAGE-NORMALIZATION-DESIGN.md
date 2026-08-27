# Durable Message Normalization Design

**Status:** Delivered — 2026-08-26. The implementation matches this design.

**Scope:** Stage 6.5 local Session authority follow-up.

**Related:** ADR-0024, ADR-0025, `packages/session-store`, Harness Session Tree, Vercel AI SDK `Message`/UI message projection.

## 1. Problem Statement

The local Session Store deliberately accepts only values that can be represented as stable JSON without silent semantic loss. This is required because the Session Tree is the durable semantic authority and must round-trip predictably through SQLite and any future append-oriented sync protocol.

Vercel AI SDK runtime/UI messages do not guarantee that every enumerable property is already canonical JSON. In particular, streamed text/reasoning/tool parts may contain optional properties as explicit `undefined` values, for example:

```ts
{
  type: "text",
  text: "...",
  providerMetadata: undefined,
  state: "done",
}
```

When such a runtime message is copied directly into a Session Entry, `LocalSessionStore` rejects it with a precise persistence-edge error such as:

```text
Session Tree state.entries[7].message.parts[1].providerMetadata must be JSON-safe
```

The Store is behaving correctly. The missing boundary is the conversion from a provider/UI runtime object to the durable Session representation.

## 2. Goals

1. Define one explicit boundary that converts runtime `Message` values into durable Session messages before they enter Session Tree semantic history.
2. Preserve strict `LocalSessionStore` validation; the Store must not become a lossy JavaScript serializer.
3. Canonicalize only the JavaScript-only optional-value case that is expected from the AI SDK:
   - object property with value `undefined` -> omit the property;
   - array element/hole representing `undefined` -> `null`, preserving array position.
4. Preserve valid JSON-safe Provider metadata instead of deleting `providerMetadata` wholesale.
5. Continue rejecting values whose meaning cannot be preserved as canonical JSON, including functions, symbols, bigint, non-finite numbers, cycles, symbol-keyed properties, and non-plain objects.
6. Reuse the same normalization semantics for all CLI paths that write AI SDK messages to Session Tree history, including normal message sync, compaction pre-sync, and Tool terminal message updates.
7. Keep Harness provider-independent and keep the persistence boundary independent of SQLite implementation details.

## 3. Non-Goals

- Do not weaken or remove `packages/session-store/src/json.ts` validation.
- Do not silently coerce arbitrary JavaScript values using `JSON.parse(JSON.stringify(...))`.
- Do not delete all `providerMetadata` merely because it is provider-specific.
- Do not move Provider-specific interpretation into Harness or Session Store.
- Do not redesign Vercel AI SDK message types.
- Do not change Session Entry topology, append-only semantics, durable-first ordering, or Store schema.
- Do not change Provider request/response behavior.
- Do not implement cloud sync or legacy Session import as part of this follow-up.

## 4. Domain Boundary

The implementation must distinguish two representations that currently share similar TypeScript shapes:

### Runtime Message

An AI SDK/UI object used while streaming and rendering. It may contain JavaScript-only optional states such as an enumerable `property: undefined`.

### Durable Message

The canonical message representation allowed to cross into Session semantic history. It must be JSON-safe before `appendSessionTreeMessages` constructs `user_message`, `assistant_message`, or `message_update` Entries.

The intended pipeline is:

```text
AI SDK stream / UI Message
          |
          v
normalizeDurableMessage
          |
          v
canonical JSON-safe Message
          |
          v
appendSessionTreeMessages
          |
          v
Session Tree semantic Entries
          |
          v
LocalSessionAuthority.commit
          |
          v
LocalSessionStore strict validation
          |
          v
SQLite
```

The Store remains the integrity backstop. Normalization is not a replacement for validation.

## 5. Module Ownership and Interface

The normalization logic belongs in the CLI Session semantic adapter layer because the incompatibility is between the AI SDK runtime representation and the canonical Session representation.

Recommended module:

```text
packages/cli/src/lib/durable-session-message.ts
```

Recommended public seam:

```ts
normalizeDurableMessage(message: Message): Message
normalizeDurableMessages(messages: readonly Message[]): Message[]
```

An internal recursive helper may normalize the supported JSON-compatible structure, but it should not be exposed as a general-purpose arbitrary-JavaScript serializer. The public vocabulary should remain Session-specific.

The existing private `omitUndefined` implementation in `durable-tool-terminal.ts` should not survive as a second independent policy. During implementation, its behavior should be consolidated behind the durable-message seam so Tool and normal message persistence cannot drift.

## 6. Canonicalization Contract

### 6.1 Object Properties

For a plain object:

```ts
{
  text: "hello",
  providerMetadata: undefined,
}
```

the durable representation is:

```ts
{
  text: "hello",
}
```

This is the canonical representation of an optional field that is absent.

### 6.2 Arrays

Array positions must never shift during normalization.

```ts
["a", undefined, "b"]
```

becomes:

```ts
["a", null, "b"]
```

Sparse holes must follow the same rule and become explicit `null` positions. Implementation must not use an array traversal that silently preserves sparse holes.

### 6.3 Values Preserved Unchanged

- `null`
- strings
- booleans
- finite numbers
- arrays after recursive normalization
- plain objects, including objects with a `null` prototype, after recursive normalization
- ordinary string-keyed Provider metadata when every nested value satisfies the durable contract

### 6.4 Values That Must Still Fail

Normalization must not hide these values from the Store or silently reinterpret them:

- `NaN`, `Infinity`, `-Infinity`;
- `bigint`;
- function values;
- symbol values or symbol-keyed properties;
- cyclic object graphs;
- non-plain objects such as `Date`, `Map`, `Set`, class instances, SDK response/class objects, or host objects.

The normalization seam may reject these values itself with a path-aware error or preserve them so the existing Store validator rejects them. The implementation choice may favor earlier diagnostics, but tests must ensure none are silently converted into a different JSON meaning.

### 6.5 `__proto__` and Untrusted Keys

An own string key named `__proto__` is data and must remain data. Object construction must not accidentally mutate the prototype of the normalized object. The existing Session Store and Tool-terminal logic already use property definition rather than unsafe assignment for this reason; the unified seam must preserve that invariant.

## 7. Provider Metadata Policy

`providerMetadata` is not removed by name.

Rules:

1. `providerMetadata: undefined` -> omit the property.
2. JSON-safe `providerMetadata` -> preserve it recursively.
3. Non-JSON-safe `providerMetadata` -> fail rather than silently drop or stringify it.

This keeps canonical Session history provider-independent at the architecture level without throwing away opaque Provider metadata that the AI SDK may require to reconstruct a later model-facing message.

A future decision may define a narrower durable Provider-metadata schema per Provider, but that is explicitly outside this fix.

## 8. Persistence Entry Points That Must Use the Seam

Implementation must audit every path where AI SDK `Message` objects enter Session Tree history. At minimum the current code contains these paths:

1. `use-chat.ts` -> `syncMessagesToTree` -> `appendSessionTreeMessages`.
2. `use-chat.ts` compaction handler -> history sync -> `appendSessionTreeMessages`.
3. `durable-session-turn.ts` when a runtime/user message is converted into a durable Session transition.
4. `durable-tool-terminal.ts` when a Tool UI part is turned into a terminal durable message update.

The preferred design is to normalize at the CLI semantic adapter immediately before the Harness append operation. Do not scatter field-specific `delete providerMetadata` patches across these callers.

Harness should continue to accept generic `TMessage` and should not learn about AI SDK `Message`, `providerMetadata`, or this compatibility policy.

## 9. Equality and Duplicate Update Semantics

Harness currently determines whether a message changed using JSON serialization equality. Because JSON serialization already omits object-valued `undefined`, normalizing both messages before they enter durable history produces the same intended semantic comparison while ensuring the persisted object itself is valid.

The implementation must avoid a loop where a restored durable message lacks `providerMetadata`, the live runtime message contains `providerMetadata: undefined`, and every synchronization appends another `message_update`. Tests must prove repeated synchronization of semantically equivalent normalized messages is idempotent.

## 10. Durable-First Ordering

Normalization occurs before the Session authority commit and therefore before any next Provider or Tool side effect whose execution depends on that semantic transition.

Required ordering remains:

```text
runtime message available
  -> normalize
  -> construct next Session Tree
  -> validate/commit locally
  -> expose committed state / allow dependent side effect
```

If normalization or commit fails, the pending semantic transition remains failed closed. No fallback should write an in-memory-only Session Tree.

## 11. Error Model

Expected `undefined` optional fields are not errors; they are canonicalized.

Unexpected non-JSON-safe values are programming/integration errors. Error messages should remain path-aware where possible so a failure identifies the exact field, for example:

```text
Durable message parts[1].providerMetadata.foo contains a non-plain object
```

The Store validator remains the final source of truth and may still report its existing path-aware `Session Tree state... must be JSON-safe` error if an invalid value crosses the adapter.

## 12. Alternatives Rejected

### Make LocalSessionStore omit `undefined`

Rejected because the Store would silently mutate caller data and gradually become an arbitrary JavaScript serializer instead of a strict semantic persistence boundary.

### Patch only `providerMetadata`

Rejected because `undefined` can occur in other optional AI SDK message fields and would produce repeated one-off fixes.

### Use `JSON.parse(JSON.stringify(message))`

Rejected because it silently changes values such as non-finite numbers and hides unsupported object types, making data corruption harder to diagnose.

### Drop all Provider metadata

Rejected for this follow-up because some Provider metadata may participate in later AI SDK message conversion/continuation. The safe policy is preserve when JSON-safe, omit only absence represented as `undefined`, and reject unsupported runtime values.

## 13. Implementation Slices

The delivered implementation followed these TDD slices:

1. Add the durable-message normalization seam with focused contract tests.
2. Route normal assistant/message synchronization through the seam and reproduce/fix the `providerMetadata: undefined` failure.
3. Route compaction history synchronization through the same seam.
4. Consolidate Tool-terminal `omitUndefined` behavior into the shared seam without changing Tool durability semantics.
5. Add restart/idempotency integration coverage and run the full Stage 6.5 verification matrix.

## 14. Implementation Result

The delivered implementation keeps the design boundaries intact:

- `packages/cli/src/lib/durable-session-message.ts` owns `normalizeDurableMessage`, `normalizeDurableMessages`, and the single `appendDurableSessionMessages` Session Tree entry seam.
- object `undefined` is omitted; array `undefined` and sparse holes become explicit `null` without shifting indexes;
- JSON-safe Provider metadata and own `__proto__` string-keyed data are preserved without mutating runtime/UI messages;
- non-finite numbers, bigint, functions, symbols/symbol properties, cycles, and non-plain objects remain fail-closed;
- `use-chat.ts` normal synchronization and compaction pre-sync, `durable-session-turn.ts`, and `durable-tool-terminal.ts` all reuse the same policy;
- the previous Tool-terminal private `omitUndefined` policy was removed;
- Harness and `LocalSessionStore` were not weakened or made AI SDK-aware, and no Store migration was required.
