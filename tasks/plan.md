# Implementation Plan: Context Runtime v1 and Session Tree

## Overview

Move model-context selection out of the React/AI SDK message list and into a reusable Harness context layer, then evolve cloud-restored sessions from a linear message snapshot into a versioned session tree. A tree node represents a resumable conversation point; jumping to any node changes the active projection, and submitting from an older node naturally creates a new branch.

## Architecture Decisions

- Keep `AgentLoop` focused on Run / Turn / Step orchestration. Context selection is a sibling Harness concern, not loop logic.
- Add a generic Harness `ContextManager` that operates on context records and produces a budgeted projection without depending on React or AI SDK types.
- Treat the UI message list as one projection of session state, not as the authoritative history model.
- Represent session history as a versioned tree whose nodes contain resumable message snapshots. This first version favors correctness and simple recovery over snapshot deduplication; later event storage can replace the duplicated snapshots without changing tree semantics.
- The active node is the continuation point. Jumping to an ancestor and submitting a new turn creates another child branch automatically.
- Persist the versioned tree through the existing Session JSON storage so this phase does not require a database migration. Keep legacy array snapshots readable.
- Add `/tree`, `/jump`, `/parent`, and `/root` commands. `/tree` and `/jump` open the same node browser; selecting a node makes it active.
- Remove obsolete server-side chat/model runtime files after verifying they are no longer referenced.
- Compaction/automatic summarization remains out of scope. Token budget projection should fail soft by retaining the newest required context rather than mutating historical data.

## Task List

### Phase 1: Harness Context Foundation
- [x] Add generic context record, model budget, projection, and `ContextManager` types.
- [x] Add deterministic tests for tail-preserving budget projection and required-record behavior.
- [x] Integrate the manager into `LocalModelTransport` before conversion to provider messages.

### Phase 2: Session Tree Runtime
- [x] Add generic session-tree state/types/helpers in the Harness package.
- [x] Add tests for root creation, append, jump, branching from an ancestor, parent lookup, and legacy restoration.
- [x] Add CLI session-state persistence and restore helpers using the existing cloud Session JSON field.

### Phase 3: CLI Navigation
- [x] Make `useChat` own the active session-tree state and update it after completed turns.
- [x] Support replacing the displayed/provider message projection when jumping to a node.
- [x] Add a session-tree browser dialog plus `/tree`, `/jump`, `/parent`, and `/root` commands.

### Phase 4: Cleanup and Documentation
- [x] Confirm obsolete server chat/model runtime stubs are inert and unmounted from the Server runtime.
- [x] Add ADR for context projection and tree-shaped sessions.
- [x] Update `.docs` current implementation snapshot.
- [x] Run tests, Harness/CLI/Server typechecks, CLI build, and Server build.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| AI SDK chat state cannot be replaced safely | High | Use its `setMessages` state API and keep tree snapshots in the same UI message shape at the CLI adapter boundary. |
| Branch persistence overwrites a newer local node | Medium | Serialize the full tree snapshot from one CLI runtime; revision/conflict resolution remains a later offline-sync concern. |
| Token estimation is not provider tokenizer-exact | Medium | Use an explicitly approximate estimator for budgeting and maintain a conservative safety margin. Exact provider tokenizers can replace it behind the same interface. |
| Tree snapshots duplicate messages | Medium | Accept for v1 to preserve simple arbitrary-node recovery; later event/delta storage can optimize without changing node IDs/parent semantics. |
| Legacy sessions contain only an array | High | Normalize legacy arrays into a root/active tree on load. |

## Out of Scope

- Automatic compaction or model-generated summaries
- Persistent Run / Turn / Step event store
- Cross-device optimistic concurrency/revision merging
- Permission engine and sandbox
- Subagent/session-tree child runtimes
