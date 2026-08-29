# Local Session Storage Reference

This document describes the local persistence layout used by the CLI. It is a storage reference, not a replacement for the Session Tree authority rules in the ADRs.

## Files

| File | Purpose |
| --- | --- |
| `%USERPROFILE%\.more-more-code\sessions\sessions.db` | Durable semantic Session Tree: conversation/history/model/mode/tool/compaction entries. |
| `%USERPROFILE%\.more-more-code\runtime\runtime.db` | Runtime execution telemetry/recovery data: run/turn/step, context projection, usage, tool/security events and snapshots. |

`sessions.db` is the semantic history authority. `runtime.db` is execution/observability state and must not be treated as the canonical conversation transcript.

## `sessions.db`

Schema source: `packages/session-store/src/migrations.ts`.

### `LocalSession`

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | TEXT PK | Session ID. |
| `title` | TEXT | Display title. |
| `metadataJson` | TEXT | Session metadata encoded as JSON. |
| `rootEntryId` | TEXT | Root Session Entry ID. |
| `activeEntryId` | TEXT | Current active branch tip. |
| `createdAt` | INTEGER | Creation timestamp in milliseconds. |
| `updatedAt` | INTEGER | Last update timestamp in milliseconds. |
| `archivedAt` | INTEGER NULL | Archive timestamp. |
| `revision` | INTEGER | Optimistic/session revision counter. |

### `LocalSessionEntry`

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | TEXT PK | Entry ID. |
| `sessionId` | TEXT FK | Owning `LocalSession.id`. |
| `sequence` | INTEGER | Append order inside the session. Unique with `sessionId`. |
| `parentId` | TEXT NULL | Parent entry; defines Session Tree topology. |
| `type` | TEXT | Semantic entry type such as `user_message`, `assistant_message`, `tool_call`, `tool_result`, `compaction`, `model_change`. |
| `createdAt` | INTEGER | Entry creation timestamp in milliseconds. |
| `entryJson` | TEXT | Full typed entry payload serialized as JSON. Message text/tool payloads are stored here rather than in separate text columns. |

## `runtime.db`

Schema source: `packages/runtime-store/prisma/schema.prisma`.

### `RuntimeEvent`

| Field | Type | Meaning |
| --- | --- | --- |
| `offset` | Int PK autoincrement | Global append-only event cursor. |
| `id` | String unique | Event ID. |
| `sessionId` | String | Correlated session. |
| `type` | String | Event channel such as `execution`, `context`, `usage`, `tool`, `security`. |
| `payloadJson` | String | Typed event payload encoded as JSON. |
| `createdAt` | DateTime | Persistence timestamp. |

### `RuntimeSnapshot`

| Field | Type | Meaning |
| --- | --- | --- |
| `sequence` | Int PK autoincrement | Snapshot sequence. |
| `id` | String unique | Snapshot ID. |
| `sessionId` | String | Correlated session. |
| `eventOffset` | Int | Last runtime event represented by the snapshot. |
| `stateJson` | String | Materialized runtime state encoded as JSON. |
| `createdAt` | DateTime | Snapshot timestamp. |

## Relevant implementation paths

- Session store bootstrap/SQLite implementation: `packages/session-store/src/bootstrap.ts`, `packages/session-store/src/sqlite-local-session-store.ts`
- Runtime store: `packages/runtime-store/src/sqlite-runtime-store.ts`
- Session controller/persistence integration: `packages/cli/src/app/session/session-controller.ts`
- Durable message projection: `packages/cli/src/lib/durable-session-message.ts`
- Session navigation projection: `packages/cli/src/lib/session-navigation-projection.ts`
