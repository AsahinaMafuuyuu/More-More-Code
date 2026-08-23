# MORE-MORE-CODE Project Instructions

## Multi-Agent Collaboration

- Multi-agent collaboration is authorized for this repository when work can be divided into concrete, bounded subtasks that can make useful progress independently. It is permitted, not mandatory; keep small or tightly sequential tasks with the primary agent when delegation would add more coordination than value.
- The primary agent remains accountable for architecture, scope, integration, verification, and the final result. Delegation does not transfer user approval or broaden the actions permitted by the original request.
- Give every sub-agent explicit ownership of files, modules, or a read-only question. Tell code-writing agents that they share the worktree, must preserve other contributors' changes, and must not revert or overwrite work outside their ownership.
- Avoid concurrent edits to the same files. Use read-only explorers for independent codebase questions and workers for disjoint implementation areas; integrate and resolve cross-module decisions in the primary agent.
- Treat sub-agent output as input to the primary review. Before delivery, inspect the integrated diff and run verification proportional to the combined change rather than relying only on each sub-agent's report.
- Report material use of sub-agents to the user, including the responsibilities delegated and any integration constraints or unresolved findings.
