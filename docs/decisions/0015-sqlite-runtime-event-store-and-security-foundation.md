# ADR-0015: SQLite Runtime Event Store and Security Foundation

## Status

Accepted

## Date

2026-08-15

## Context

Stage 6 introduces durable runtime persistence, recovery, and security foundations while keeping Session Tree as semantic authority.

## Decision

Use SQLite through Prisma as local source of truth. RuntimeEvent stores append-only facts. RuntimeSnapshot stores recovery checkpoints. EventStore abstracts persistence. Recovery restores snapshots and replays events.

Permission decisions use capability-oriented allow/deny/ask policies. Security actions are represented as runtime events for future audit timelines.

## Consequences

Runtime recovery and auditing become possible. PostgreSQL migration remains adapter-level. Full event sourcing, cloud sync, and sandboxing are deferred.
