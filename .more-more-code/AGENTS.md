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
- Treat Provider identity, Provider implementation kind, model identity, and authentication strategy as separate concepts. Do not reintroduce a closed provider/model switch as the long-term public configuration surface.
- The accepted built-in Provider set is OpenAI, Anthropic, Google, and DeepSeek. Mistral is not part of the Stage 6.4+ built-in provider surface.
- Custom Provider V1 means an OpenAI-compatible endpoint with a stable user-defined `providerId`; multiple custom providers must be able to coexist.
- Provider account configuration is user-global local state. Project `.more-more-code/config.json` may select a provider/model but must not own provider credentials.
- Keep raw API keys/OAuth tokens out of repository/project config and out of process-backed Tool environments. Provider secrets belong behind the Credential Store/Auth seam.
- OpenAI Codex OAuth is a distinct, initially experimental auth strategy. Do not scrape or copy private Codex token files and do not assume an undocumented Codex token is a generic OpenAI API bearer credential.
- Do not add Anthropic OAuth in the initial provider design. Google OAuth and other provider-specific login flows require later explicit research/decisions.
- Compaction is budget-aware and may trigger proactively at soft/hard utilization thresholds before actual overflow. Cut points must preserve complete Context groups/Turns and never split retained atomic interactions merely to hit a token count.
- A newer compaction checkpoint reduces the previous effective checkpoint plus newly compacted history into one complete replacement state snapshot; older compaction entries remain durable Session history while model context starts from the latest effective checkpoint.
- Harness owns provider-independent compaction policy/source selection/metadata; LLM semantic reduction belongs at the CLI/provider seam and must retain a bounded deterministic fallback so compaction failure does not automatically fail the primary Model Step.
- Tool Result pruning is a model-facing working-set projection and must run before historical Compaction. Never mutate or delete the canonical Session `tool_result` payload to save Context tokens.
- Preserve fresh/current Tool Results for immediate continuation when feasible; warm/cold results may use bounded `full | truncated | summary | reference` projections under a budget derived from the effective model input budget.
- Manual `/compact` must reuse the normal compaction source-selection/reducer/checkpoint pipeline with `trigger=manual`; it may bypass automatic utilization thresholds but must first pass the provider-independent manual eligibility gates for minimum compactable history, checkpoint-relative new Turn progress, and estimated token savings. Do not implement repeat-compaction protection as a wall-clock cooldown. Manual compaction must not bypass required/retained records, atomic group boundaries, branch-local persistence, or append-only Session history.
- Branch Summary is a separate branch knowledge-transfer mechanism and must not reuse Compaction trigger/state-snapshot semantics by default.
- Session navigation must remain lazy: browsing/jumping alone does not append Session Entries. Analyze source/target path loss first; only an explicit/configured Carry may append one provenance-bearing `branch_summary` child under the target. `No Carry` is navigation-only and `Cancel` must leave the source active.
- Session restore authority is `Session Tree + activeEntryId`; message/runtime/context state is derived as branch projections.
- PLAN and BUILD may have different prompt-cache families because their model-visible Tool Sets differ.

## Session and Tool Runtime

- Treat Session Entries as append-only semantic facts. New entries append as children of the current `activeEntry`; continuing from history creates a branch instead of rewriting prior entries.
- Keep AgentLoop source-agnostic: it owns Run/Turn/Step orchestration, while Tool Runtime owns registry visibility, permission decisions, cancellation/timeout propagation, source selection, and normalized outcomes.
- Permission decisions use `allow | deny | ask`; interactive approval remains a separate UI concern.
- Workspace path validation is not OS-level Sandbox enforcement.
- Every native child process must cross the CLI `ProcessSandbox` seam. Do not call `Bun.spawn` from individual native Tools.
- Sandbox `required` and explicit hard restrictions such as `network=deny` are fail-closed. Never describe the `auto` direct fallback, sanitized child environment, canonical workspace path, or `cwd` alone as OS isolation.
- Keep Permission Policy, Approval Broker, Tool Runtime, and Process Sandbox separate: they respectively answer authorization, one-time human consent, Tool lifecycle orchestration, and subprocess execution constraints.
- Session event and timestamp colors belong to semantic Theme tokens rather than component-specific colors.

## Persistence Boundaries

- Keep the cloud Session Store and local Runtime Store separate. `packages/database` is the PostgreSQL/Server boundary; `packages/runtime-store` is the SQLite/local-runtime boundary.
- ADR-0023 defines the target Session authority as local. Until Stage 6.5 lands, the current Server-backed Session create/read/snapshot flow is transitional and must not be mistaken for the target architecture.
- A future Local Session Store owns semantic Session creation/list/get/append persistence. It remains distinct from the Local Runtime Store even if both are SQLite-backed.
- The Server is optional cloud product infrastructure: account/subscription entitlements plus multi-device Session sync/backup. Do not place Provider credentials, Model Steps, AgentLoop, Tools, Context, Runtime Events, or Sandbox execution behind it.
- Multi-device Session sync must evolve away from whole-tree last-write-wins replacement toward append-oriented, idempotent revision/cursor semantics. Device UI/navigation state such as `activeEntryId` stays local by default.
- Subscription/entitlement checks must not be inserted into every Model Step or Tool Step. Temporary cloud unavailability must not disable the local coding runtime.
- Each store owns its own Prisma schema, generated client, datasource configuration, dependencies, and migrations. Do not replace or merge one schema while implementing the other.
- Session Tree is the semantic conversation authority. Runtime Events are execution/security/recovery facts and must not rewrite Session Entries.
- Runtime Event and snapshot reads must be explicitly scoped by `sessionId`; SQLite-assigned event offsets are replay cursors, not per-Run execution sequence numbers.
- Runtime Event payloads are versioned strict allowlists. Reject unknown fields and never persist prompts, messages, Tool input/output, command/file contents, or arbitrary error text.
- Persist critical execution, Tool-request/permission, and Context-start facts before the corresponding external side effect. Runtime Store failure is fail-closed; do not silently substitute an in-memory store.
- The installed CLI owns one shared per-user Runtime Store at `~/.more-more-code/runtime/runtime.db` unless `RUNTIME_STORE_DATABASE_URL` supplies an absolute `file:` URL. Runtime migrations must be embedded and idempotent; application startup must not invoke Prisma CLI.
- Recovery may reconstruct and report incomplete execution, but must not automatically repeat external model/tool side effects.
- Verify database changes with TypeScript checks and both Prisma schemas. A successful Bun bundle alone is not sufficient because bundling does not enforce the generated Prisma client types used by Server routes.

## Git Version Control

- Each planned Stage must be developed on its own Git branch. Create/switch to a new Stage branch before beginning implementation for that Stage, and do not mix work from the next Stage into the previous Stage branch. Prefer descriptive names such as `stage/5.4-branch-summary`.
- Changes that do not constitute a new Stage should remain on the current appropriate branch and be recorded as focused commits rather than creating unnecessary branches.
- During a Stage, use additional focused commits when useful for coherent checkpoints, but keep all commits scoped to that Stage.
- When a Stage is complete, ensure its implementation, tests, and required documentation are committed on that Stage branch before moving on to the next Stage.
- Every commit must have a clear description: use a concise subject describing what changed, and when the change is non-trivial include a body that explains the important behavior/design decision and verification performed. Avoid vague messages such as `update`, `fix`, or `changes`.
- Before committing or switching branches, inspect the working tree and preserve unrelated user changes. Never discard, overwrite, or silently absorb unrelated work into the Stage commit.
