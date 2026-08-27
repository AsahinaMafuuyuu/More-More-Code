# ADR-0025: Durable Session Message Normalization Boundary

## Status

Accepted

## Date

2026-08-26

## Implementation Status

Planned. The design, test plan, delivery contract, and implementation task breakdown are documented. No production implementation is included in this decision-record update.

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

## Verification Requirement

Implementation must follow `docs/DURABLE-MESSAGE-NORMALIZATION-TEST.md`, including a real pre-fix red reproduction of `providerMetadata: undefined`, strict negative-value coverage, Tool/compaction regressions, idempotent re-sync, and restart round-trip verification.
