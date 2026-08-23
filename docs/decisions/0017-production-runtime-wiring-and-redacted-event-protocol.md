# ADR-0017: Production Runtime Wiring and Redacted Event Protocol

## Status

Accepted

## Date

2026-08-23

## Context

ADR-0016 separated the PostgreSQL Cloud Session Store from the SQLite Local Runtime Store and established snapshot-plus-replay recovery. The foundation was not yet on the CLI execution path: AgentLoop still defaulted to an in-memory execution store, migrations depended on repository tooling, and Tool/Context facts had no durable production producer.

Putting the store on the critical path introduces two coupled risks. A write failure could allow a model or tool side effect to run without a durable preceding fact, and loosely shaped JSON telemetry could accidentally duplicate prompts, commands, file contents, Tool input/output, or arbitrary error text. Restart behavior must also distinguish reconstructing state from repeating an external operation.

## Decision

The CLI owns one process-wide Local Runtime Store lifecycle.

- The default database is the stable per-user file `~/.more-more-code/runtime/runtime.db`. `RUNTIME_STORE_DATABASE_URL` is the explicit absolute `file:` URL override.
- Runtime Store migrations are embedded, versioned, transactional, and idempotent. Installed CLI startup does not invoke Prisma CLI or depend on a repository-relative migration directory.
- CLI startup bootstraps the store before rendering a Session, reuses one adapter and Projection Cache, and closes them during normal exit.
- One `RuntimeSession` deep module implements the existing `ExecutionEventStore` seam and owns durable append, replay reduction, cache warming, snapshot policy, and recovery reporting.

Runtime Events use schema version 1 and strict allowlists for `execution`, `tool`, `security`, `context`, and `system` payloads. Validation rejects unknown fields at every persisted envelope, including nested execution events. Durable events may contain identifiers, lifecycle status, duration, permission outcome/source, and bounded numeric Context metrics. They must not contain prompts, messages, Tool input/output, command text, file contents, or arbitrary error strings. Execution failures persist the fixed code `execution_failed`.

Write ordering is fail-closed at side-effect boundaries:

```text
execution step.started -> durable append -> model/tool side effect
tool requested -> durable append -> permission decision -> durable append -> executor
context projection started -> durable append -> compaction/model projection work
```

An awaited Runtime Store append failure prevents the next external side effect; there is no silent in-memory fallback. Terminal and metric facts are also awaited so the durable order remains observable.

Recovery loads the latest valid snapshot, replays later session-scoped events, warms the disposable Projection Cache, records a content-free `runtime.session_opened` fact, and reports incomplete Runs or Context operations to the UI. It never automatically replays a model call, Tool execution, or other external operation. The user may start a new Run after acknowledging the report.

## Alternatives Considered

### Invoke Prisma CLI migrations during application startup

Rejected because an installed CLI must not require development tooling, generated repository paths, or a source checkout to open its local database.

### Derive the SQLite file from the current working directory

Rejected because changing projects would create unrelated databases and make recovery depend on where the CLI happened to launch.

### Fall back to `InMemoryExecutionEventStore` when SQLite fails

Rejected because the user would observe a side effect whose write-ahead fact was lost, defeating crash recovery and audit guarantees.

### Persist complete AgentLoop, Tool, or provider objects

Rejected because structural typing alone does not prevent future properties or arbitrary payloads from crossing the durable boundary. Strict runtime allowlists make redaction enforceable even when a caller bypasses TypeScript.

### Automatically resume incomplete operations after restart

Rejected because replay cannot determine whether an interrupted external side effect actually occurred. Reporting incomplete work is safe; repeating it is not.

## Consequences

- Local execution startup now depends on a writable per-user Runtime Store. Migration or append failure is visible and blocks unsafe progress.
- Runtime Event schema changes require a new explicit version and validator/migration compatibility work; adding a TypeScript property alone is insufficient.
- Runtime telemetry is intentionally less detailed than Session history or ephemeral error UI. Rich content remains in its appropriate semantic or transient boundary.
- SQLite is the durable runtime authority while Projection Cache and snapshots are derived acceleration structures.
- Permission policy consolidation and the session-scoped security audit projection remain follow-up work built on the same strict event protocol.
