# ADR-0016: Separate Cloud Session and Local Runtime Stores

## Status

Accepted

## Date

2026-08-22

## Context

ADR-0015 selected Prisma with SQLite for durable local Runtime Events and snapshots. Its first implementation replaced the existing `packages/database` PostgreSQL schema with the new SQLite models. That package is also the database boundary for the Hono Server's cloud Session Store, so replacing its schema removed the generated `Session` client while Server routes continued to call `db.session`. Bun bundling still succeeded because it does not perform the Server's full TypeScript check, but the Server client contract and runtime behavior were broken.

The project has two persistence domains with different deployment, lifecycle, and recovery requirements:

- Cloud Session persistence stores account-scoped, branchable semantic Session state and is accessed by the Server.
- Local Runtime persistence stores append-only execution, tool, context, security, and system facts plus recovery snapshots and is accessed by the local Agent Runtime.

Session Entries and Runtime Events are related projections, but neither is a storage substitute for the other. They must be able to evolve and migrate independently.

## Decision

Keep the cloud Session Store and local Runtime Store as separate workspace packages with separate Prisma schemas, generated clients, datasource configuration, dependencies, and migrations.

- `packages/database` remains the PostgreSQL-backed cloud Session Store. It owns the `Session` schema consumed by `packages/server` and resolves its connection through `DATABASE_URL`.
- `packages/runtime-store` owns the SQLite-backed local Runtime Event Store. It uses Prisma's `@prisma/adapter-libsql` because the product runtime is Bun; callers provide its database URL explicitly and the adapter does not derive a durable database location from the process working directory.
- Harness defines provider-independent Runtime Event, snapshot, recovery, and policy contracts. The SQLite package implements those contracts and contains all Prisma row mapping.
- Runtime Event offsets are assigned atomically by SQLite and are used as append-only replay cursors. Events and snapshots are always read within an explicit `sessionId` scope.
- Session Tree remains the authoritative semantic conversation history. Runtime Events are the durable execution/audit history. A Runtime Event adapter may persist facts emitted by AgentLoop, Tool Runtime, Context, and permission boundaries, but it does not rewrite Session Entries.
- Recovery loads the latest valid snapshot for one session and replays subsequent events through an explicit projection reducer. Recovery reports incomplete execution; it does not automatically repeat an external model or tool side effect.

ADR-0016 supersedes ADR-0015 only where ADR-0015 placed local SQLite models in the shared cloud database package or implied that one Prisma client could serve both stores. The decision to use SQLite for local Runtime Events and capability-oriented permission events remains in force.

## Alternatives Considered

### One Prisma schema with PostgreSQL and SQLite models

- Rejected because one Prisma schema has one datasource provider. It cannot safely generate a single client whose models target two engines.
- It couples cloud deployment migrations to local runtime storage and recreates the failure that triggered this decision.

### Two Prisma schemas inside `packages/database`

- This can work technically, but generated-client paths, scripts, dependencies, and ownership remain easy to confuse.
- Rejected in favor of a package boundary that makes the deployment and dependency split visible to builds and future agents.

### Store Runtime Events in the cloud PostgreSQL database

- It would avoid a second schema but would make local execution and crash recovery depend on network availability.
- Rejected because the Agent Runtime is local-first and cloud Session synchronization is intentionally outside the execution critical path.

### Store Runtime Events in the Session Entry Tree

- It would reduce the number of stores but conflate semantic conversation history with high-volume execution and security telemetry.
- Rejected because the histories have different branching, retention, replay, and auditing semantics.

### Use `@prisma/adapter-better-sqlite3`

- The adapter is suitable for Node.js and was used by the first local prototype.
- Rejected because Prisma's supported Bun path is `@prisma/adapter-libsql`; Bun cannot load the native SQLite driver on which `better-sqlite3` depends.

## Consequences

- Cloud Session routes retain their PostgreSQL model and can be validated independently of local runtime work.
- Local Runtime persistence gains an isolated migration path and can later add a PostgreSQL/cloud adapter without changing Harness contracts.
- Workspace setup must generate two Prisma clients and validate two schemas.
- Local SQLite integration tests run in Bun and use libSQL directly to apply the committed migration to an isolated temporary database before exercising the Prisma adapter.
- Cross-store operations are not atomic. Session synchronization remains best-effort, while local Runtime Event append and snapshot operations define their own consistency boundary.
- Tests must include Server typechecking, both Prisma schemas, SQLite restart/replay behavior, event ordering, and cross-session isolation; a successful Bun bundle alone is insufficient verification.
