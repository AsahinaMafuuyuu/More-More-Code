# ADR-0025: Durable Session Message Normalization Boundary

## Status

Accepted

## Date

2026-08-26

## Implementation Status

Delivered — 2026-08-26. The CLI now owns a single durable-message adapter in `packages/cli/src/lib/durable-session-message.ts`. Normal message synchronization, compaction pre-sync, durable user-turn construction, and Tool-terminal message updates all cross that adapter before Harness constructs Session Entries. `LocalSessionStore` remains unchanged and strict.

## Context

ADR-0024 made `LocalSessionStore` the strict local semantic authority. Its JSON boundary intentionally rejects JavaScript values that cannot round-trip through durable JSON without semantic loss.

Vercel AI SDK UI/runtime messages may expose optional fields as explicit enumerable `undefined` values. A streamed assistant part can therefore contain `providerMetadata: undefined`. Copying that runtime object directly into a Session Entry causes the strict Store to reject the tree even though the semantic meaning of that optional field is simply "absent".

The Tool-terminal path already contains private `undefined` cleanup, while ordinary message synchronization and compaction history synchronization can still pass runtime message objects directly to Harness Session Tree construction. Maintaining separate cleanup policies would create inconsistent persistence semantics.

## Decision

Introduce one CLI-owned durable-message normalization boundary between AI SDK/UI runtime messages and Session semantic history.

The canonical rules are:

- omit object properties whose value is `undefined`;
- convert array `undefined` entries and sparse holes to explicit `null` so indexes are preserved;
- preserve all valid JSON-safe values, including JSON-safe Provider metadata;
- preserve own string-keyed data such as `__proto__` without prototype mutation;
- never silently coerce non-finite numbers, bigint, functions, symbols, cycles, symbol-keyed properties, or non-plain objects into another representation;
- keep `LocalSessionStore` strict as the final integrity validator.

The normalization seam is specific to durable Session messages and belongs in the CLI semantic adapter. Harness remains generic over `TMessage` and does not learn AI SDK-specific rules. Session Store remains storage/integrity machinery and does not become a permissive serializer.

Normal message sync, compaction pre-sync, and Tool-terminal message updates must converge on the same policy. Existing Tool durability ordering remains unchanged.

## Alternatives Considered

### Make LocalSessionStore automatically omit `undefined`

Rejected. It would allow callers to hand the semantic authority invalid runtime objects and rely on persistence to mutate them silently.

### Remove only `providerMetadata`

Rejected. It treats one symptom, loses valid metadata, and does not address other optional AI SDK fields represented as `undefined`.

### Use JSON stringify/parse as the conversion

Rejected. It silently converts or loses unsupported JavaScript values and masks integration defects.

### Keep separate cleanup helpers per persistence path

Rejected. The current Tool-terminal helper already demonstrates how policies can diverge. One durable-message seam is easier to specify, test, and audit.

## Consequences

- AI SDK runtime optional fields can be represented canonically before Session persistence.
- The strict Store continues to catch unsupported or corrupt semantic values.
- Provider metadata is retained when it is genuinely durable JSON.
- Runtime/UI message objects are not mutated in place.
- All message-persistence paths must use one shared Session-specific adapter.
- No Store schema or migration is required.
- Future cloud sync can operate on already canonical Session data rather than JavaScript runtime artifacts.

## Verification Evidence

The implementation followed `docs/DURABLE-MESSAGE-NORMALIZATION-TEST.md`.

- The first real pre-fix persistence regression failed through `LocalSessionAuthority.commit` with `Session Tree state.entries[1].message.parts[0].providerMetadata must be JSON-safe` before production code changed.
- Focused durable-message, Local Session, Tool-terminal, compaction pre-sync, restart, mutation-safety, idempotency, `__proto__`, and strict negative-value coverage passes.
- Final verification: CLI `153/153`, Local Session Store `11/11`, Harness `99/99`; CLI and Session Store TypeScript checks pass; CLI build and `git diff --check` pass.
