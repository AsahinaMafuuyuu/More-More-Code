# ADR-0018: Governed Multi-Agent Collaboration

## Status

Accepted

## Date

2026-08-23

## Context

MORE-MORE-CODE spans CLI, Harness, cloud Server, two persistence boundaries, runtime recovery, provider integration, and project documentation. Some changes contain independent investigation, implementation, testing, or review streams that can benefit from parallel agents. Until this decision, multi-agent use depended on an explicit request in each task or session-level instructions, so future agents could not treat repository-level authorization as durable project policy.

Unrestricted delegation would create a different risk. All agents share one worktree, so unclear ownership can produce conflicting edits, accidental reverts, duplicated investigation, and incomplete integration. A sub-agent also cannot grant itself wider permissions or change the scope authorized by the user.

## Decision

Authorize multi-agent collaboration for this repository when a task can be decomposed into concrete, bounded subtasks that can progress independently. Authorization is optional rather than a requirement; the primary agent should keep small or strongly sequential work local when coordination cost would outweigh parallelism.

The following governance rules apply:

- The primary agent owns architecture, task decomposition, integration, verification, and final delivery.
- Every delegated task must identify responsibility, including owned files/modules or a specific read-only question.
- Code-writing agents must be told that the worktree is shared, that other changes must be preserved, and that they must not revert or overwrite work outside their ownership.
- Concurrent writes to the same files should be avoided. Read-only exploration may run in parallel; implementation should be split across disjoint seams wherever practical.
- Delegation inherits the user's scope and permissions. It does not authorize new external effects, destructive operations, or unrelated changes.
- The primary agent reviews the combined diff and runs integration-level verification after sub-agents finish; individual reports are evidence, not substitutes for integration review.
- Material delegation is disclosed to the user with a concise description of responsibilities and any remaining integration risk.

## Alternatives Considered

### Require single-agent execution for every task

Rejected because independent codebase exploration, disjoint module work, tests, and focused review can proceed safely in parallel and shorten feedback cycles on larger changes.

### Always use multiple agents

Rejected because small fixes and tightly coupled refactors are faster and safer without delegation overhead. Parallelism is a tool, not a delivery requirement.

### Allow delegation without explicit ownership

Rejected because shared-worktree agents could edit the same files, overwrite user changes, or produce incompatible local decisions without a clear integration owner.

## Consequences

- Future tasks may use sub-agents without requesting fresh repository-level authorization when the task benefits from bounded parallel work.
- Primary-agent planning must account for shared-worktree conflicts and assign explicit ownership before code-writing delegation.
- Multi-agent results require central review and integration verification before they are considered complete.
- Tasks that are small, sequential, security-sensitive, or hard to partition may still be executed entirely by the primary agent.
