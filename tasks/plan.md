# Implementation Plan: Session Entry Tree v3

## Overview

Replace the v2 checkpoint-node/message-upsert model with a Pi-inspired Session Entry Tree. A persisted Session becomes a branchable semantic event history: every durable event is one entry/node linked by `parentId`. Conversation messages are only one entry family; tool calls/results, errors, model/mode/config changes, compaction, branch summaries, and custom events can also be persisted. UI messages, model context, and runtime configuration are projections of the active root-to-leaf branch.

ExecutionEventStore remains a separate Run/Turn/Step lifecycle log. High-frequency streaming/progress events remain ephemeral and are not Session Entries.

## Architecture Decisions

- Introduce Session Tree snapshot version 3 with `SessionEntry[]`; one durable semantic entry equals one tree node.
- Persist a `session_start` root entry so empty sessions still have a stable navigation root.
- Keep entry identity distinct from message/tool/run identities.
- Support conversation entries (`user_message`, `assistant_message`, `custom_message`, `message_update`), execution-facing semantic entries (`tool_call`, `tool_result`, `error`), state entries (`model_change`, `mode_change`, `config_change`), and context-control/custom entries (`compaction`, `branch_summary`, `custom`).
- Reconstruct UI messages by replaying only message-bearing entries on the active branch. `message_update` updates a previously introduced message without mutating historical entries.
- Reconstruct runtime state independently by replaying model/mode/config entries.
- Keep Run/Turn/Step execution events separate from Session Entries; Session Entries are durable semantic history, Execution Events are runtime lifecycle facts/telemetry.
- Upgrade v1 snapshots and v2 event-backed checkpoint trees in memory to v3 while preserving branch projections and active cursor semantics.
- Keep cloud persistence on the existing `POST /sessions/:id/state` JSON payload for now; no Prisma migration is required in this phase.
- Record stable conversation/tool/error/state events incrementally from the CLI instead of waiting for the entire Run to finish.

## Task List

### Phase 1: Domain Model and Migration
- [x] Define Session Entry v3 types and branch/path validation.
- [x] Add append/jump/parent/path APIs and message/runtime projections.
- [x] Add message-snapshot reconciliation that emits message entries/updates.
- [x] Migrate legacy arrays, v1 snapshots, and v2 event-backed trees to v3.

### Phase 2: CLI Runtime Integration
- [x] Persist user/assistant message boundaries during model steps.
- [x] Persist tool call/result and error entries around local tool execution.
- [x] Persist model/mode changes as state entries and restore them when navigating history.
- [x] Keep branch continuation semantics after `/tree`, `/jump`, `/parent`, and `/root`.

### Phase 3: Server and UI Projection
- [x] Accept v3 state in the Server while retaining v1/v2 compatibility reads/writes.
- [x] Render Session Tree entries by entry type/preview instead of checkpoint message snapshots.
- [x] Keep hidden/non-chat state events persisted even when normal chat UI does not render them.

### Phase 4: Verification and Documentation
- [x] Add v3 branch/projection/state/migration regression tests.
- [x] Run Harness/CLI/Server typechecks, Harness/CLI tests, CLI/Server builds, and diff check.
- [x] Add ADR-0008 and update README, changelog, current implementation notes, and domain glossary.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| v2 branches contain branch-local updates to existing message IDs | High | Convert each v2 checkpoint relative to its mapped parent and emit branch-local `message_update` entries |
| AI SDK mutates an assistant UI message as tool results arrive | High | Persist the initial assistant entry and append immutable `message_update` entries after tool-result changes |
| State entries accidentally enter model context | High | Keep runtime-state and message projections separate; only message projection feeds current UI/provider conversion |
| Session history duplicates ExecutionEventStore | Medium | Persist only semantic milestones in Session Entry Tree; keep Run/Turn/Step/progress lifecycle in ExecutionEventStore |
| Model/mode restoration creates duplicate change events while jumping | Medium | Restore prompt configuration without recording during the navigation transition, then record subsequent user changes normally |
