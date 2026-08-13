# MORE-MORE-CODE Project Instructions

- Keep the coding-agent runtime local-first: the CLI/Harness owns model calls, tools, context, and execution control; the Server remains a cloud persistence boundary.
- Preserve the separation between Session Entries, Execution Events, Context Projection, Message/UI Projection, and Runtime State Projection.
- Do not move agent-loop behavior into React `useChat` or the Server.
- Treat `.more-more-code/` as the project-level agent configuration home. Project instructions and skills are more specific than user-global `.more-more-code/` sources.
- Keep Tools and Skills separate: tools are executable capabilities; skills are progressively loaded workflows/instructions.
- Native tools are the default execution surface. MCP is an extension source and must not be conflated with native tool implementations.
- Run focused tests/typechecks/builds after meaningful runtime changes and update ADR/current-state documentation for architectural decisions.

## Context and Provider Runtime

When working on Context or model-provider code:

- Keep canonical Context provider-independent.
- Order model context from the most stable content to the most dynamic content to preserve prefix-cache reuse.
- The intended order is:
  1. core coding-agent system prompt;
  2. global instructions;
  3. project instructions;
  4. skill catalog metadata;
  5. tool definitions and schemas;
  6. persisted compaction checkpoint;
  7. historical conversation;
  8. retained recent complete turns;
  9. current tool/runtime continuation;
  10. current user, steering, or follow-up input.
- Stable collections such as skills and tools must use deterministic ordering and serialization.
- Do not put OpenAI-specific cache, Responses, or reasoning fields into the canonical Context Manager.
- OpenAI-specific behavior belongs behind `OpenAIResponsesAdapter`.
- Keep Vercel AI SDK responsible for streaming and unified message/tool integration unless an explicit architectural decision supersedes this.
- Do not use OpenAI `previous_response_id` as the canonical MORE-MORE-CODE Session history in this stage.
- Prefer reusing persisted compaction checkpoints instead of regenerating summaries on every Model Step.
- A newer compaction checkpoint summarizes the previous effective checkpoint plus newly compacted history; older compaction entries remain durable Session history while model context starts from the latest effective checkpoint.
- Session restore authority is `Session Tree + activeEntryId`; message/runtime/context state is derived as branch projections.
- PLAN and BUILD may have different prompt-cache families because their model-visible Tool Sets differ.

## Session and Tool Runtime

- Treat Session Entries as append-only semantic facts. New entries append as children of the current `activeEntry`; continuing from history creates a branch instead of rewriting prior entries.
- Keep AgentLoop source-agnostic: it owns Run/Turn/Step orchestration, while Tool Runtime owns registry visibility, permission decisions, cancellation/timeout propagation, source selection, and normalized outcomes.
- Permission decisions use `allow | deny | ask`; interactive approval remains a separate UI concern.
- Workspace path validation is not OS-level Sandbox enforcement.
- Session event and timestamp colors belong to semantic Theme tokens rather than component-specific colors.

## DevTools file deletion

When development is performed through `@DevTools`, verify file-deletion capability before relying on deletion as part of the implementation workflow.

- At the beginning of a development session that may require deleting files, test whether the available DevTools can actually delete files.
- If DevTools cannot delete files, do not claim that obsolete files were removed.
- Continue all non-destructive implementation work that can still be completed safely.
- At the end of every affected turn, explicitly list every file that still needs to be deleted manually.
- Do not omit pending file deletions from the final summary.
