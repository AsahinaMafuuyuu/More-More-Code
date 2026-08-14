# Changelog

All notable changes to MORE MORE CODE are recorded here.

## Unreleased

### Added

- Agent Bootstrap using user-global `~/.more-more-code/` and project-local `.more-more-code/` configuration homes.
- Global → project `AGENTS.md` instruction chain composed into the coding-agent system prompt before Model Steps.
- Progressive Skill Registry discovery from `~/.agents/skills/*/SKILL.md`, user-global `.more-more-code/skills/*/SKILL.md`, and project `.more-more-code/skills/*/SKILL.md`, with metadata-only bootstrap and the read-only native `loadSkill` tool for on-demand full skill loading.
- Tool Registry source model that keeps native tools separate from configured MCP extension sources.
- `/settings` dialog for inspecting resolved agent sources, opening global/project config and instruction files plus the compatible `~/.agents/skills` source, and reloading the Agent Environment.
- ADR-0009 documenting Agent Bootstrap, Skill progressive disclosure, and native/MCP tool-source boundaries.
- Cache-aware canonical Context categories/stability classes with deterministic stable-to-dynamic compilation.
- Deterministic mode-aware `ToolSetSnapshot`, `ToolSetFingerprint`, and `PromptPrefixFingerprint` identities for provider prompt-cache families.
- Provider Runtime request-compilation boundary with `OpenAIResponsesAdapter` and normalized provider/cache telemetry.
- ADR-0010 documenting cache-aware Context ordering, persisted compaction-checkpoint reuse, prefix identities, and provider runtime boundaries.
- Local Tool Runtime with Registry visibility enforcement, capability metadata, permission decisions, timeout/cancellation propagation, and normalized execution status/timing.
- Semantic Session Tree theme tokens for message, tool, compaction, state-change, branch, error/custom, and timestamp presentation.
- ADR-0011 documenting append-only Session, compaction supersession, restore authority, and Tool Runtime boundaries.
- Budget-aware semantic Context Compaction with 80% soft / 92% hard triggers, a 70% post-compaction target, atomic safe cut points, and persisted compaction diagnostics.
- Structured semantic state reducer for replacement checkpoints, with fixed goal/state/decision/constraint/artifact/failure/pending-work sections and bounded deterministic fallback.
- ADR-0012 documenting proactive compaction policy, incremental state reduction, safe cut points, persistence metadata, and reducer/fallback boundaries.
- Provider-independent Tool Result Working Set contracts with `full | truncated | summary | reference` projections, fresh/warm/cold lifecycle, budget-derived pruning policy, and explicit required-result over-budget signaling.
- Deterministic CLI Tool Result pruning strategies for generic, shell, test/build, search/grep, and file-read outputs while preserving complete Session `tool_result` payloads.
- Manual `/compact` command and `manual` compaction trigger using the existing safe semantic reducer/checkpoint pipeline with typed no-op and deterministic-fallback feedback.
- Deterministic manual-compaction eligibility gates for minimum compactable history, checkpoint-relative new Turns, and conservative token-savings benefit, including `insufficient-history`, `recent-compaction`, and `insufficient-gain` no-op reasons.
- ADR-0013 separating Tool Result Pruning, historical Compaction, and Branch Summary responsibilities.

### Changed

- CLI startup now bootstraps the Agent Environment before rendering or starting any Session Run.
- The local system prompt is now a concise coding-agent prompt that includes PLAN/BUILD rules, skill metadata, and the resolved instruction chain.
- PLAN mode includes `loadSkill` alongside the existing read-only native tools.
- System-prefix construction is ordered as core prompt → global instructions → project instructions → Skill catalog, while model-visible Tool schemas remain deterministic through the ToolSet snapshot.
- Persisted Session `compaction` entries are reused as Context checkpoints across later Model Steps and restored sessions; a newer checkpoint reduces the previous effective checkpoint plus newly compacted history into one complete replacement state snapshot, while older checkpoint Entries remain durable tree history.
- Context Compaction now starts proactively at configured utilization thresholds instead of waiting for hard truncation; only optional historical groups are eligible, retained recent Turns remain atomic, and semantic-reducer failure falls back without making the primary Model Step depend on compaction-provider availability.
- Model Context construction now prunes eligible warm/cold Tool Results before considering historical Compaction; fresh Tool continuation remains full when feasible and durable Session payloads are never rewritten by pruning.
- Manual compaction can run below automatic soft/hard thresholds but now rejects too-small, too-recent, or low-benefit requests before reducer execution; repeat eligibility is derived from checkpoint progress rather than elapsed time and still preserves required/retained records, atomic Context groups, checkpoint replacement, active-branch isolation, and append-only Session history.
- AgentLoop Tool Steps now route native capabilities through Tool Runtime and persist optional normalized status/source/timing metadata on `tool_result` Entries.
- Native filesystem operations now receive the Tool Step workspace root and cooperative AbortSignal where supported.
- Native command execution now uses the Runtime workspace root and completes interruption/timeout through Tool Runtime with normalized cancellation status.
- OpenAI model execution explicitly selects the Responses API through `openai.responses(...)` and derives `promptCacheKey` from the prompt-prefix fingerprint; `previousResponseId` remains outside canonical Session authority.
- Provider cache read/write usage is retained as runtime diagnostics rather than semantic Session history.

### Deferred

- MCP transport/auth/remote tool execution, interactive permission approval UI, OS-level Sandbox enforcement, Local WAL/crash recovery, and Subagent runtime remain outside this stage.

## [2.0.1] - 2026-08-13

### Added

- Append-only Harness execution events for Run / Turn / Step lifecycle facts.
- `ExecutionEventStore` contract with an in-memory store, per-run ordering validation, and immutable reads.
- Deterministic execution projection APIs that replay events into `AgentRun`, `AgentTurn`, and `AgentStep` state.
- Awaited Run / Turn / Step lifecycle subscriptions: `run_start/end`, `turn_start/end`, and `step_start/update/end`.
- Settlement-aware `isBusy`, `currentTurn`, `currentStep`, and `waitForIdle()` runtime inspection/control APIs.
- Turn-safe steering and follow-up queues, including queue inspection/clearing helpers.
- Ephemeral Step progress reporting through `reportProgress()` without polluting canonical execution history.
- Session Entry Tree v3: every durable semantic event is a branchable `SessionEntry`, including user/assistant/custom messages, message revisions, tool calls/results, errors, model/mode/config changes, compaction, branch summaries, and custom events.
- Independent Message Projection and Runtime State Projection over the active Session branch.
- V1 snapshot and v2 event-backed Session Tree migration to v3, including branch-local message revision preservation.
- Durable `compaction` Session Entries emitted when Context Projection actually summarizes older history.

### Changed

- Follow-up Turns stay in the same Run history but start a fresh loop-budget epoch, so `maxTurns` and `maxSteps` no longer inherit usage from the interaction that just finished.
- Unhandled `Ctrl+C` now preserves the first press for copying the current OpenTUI selection and exits only on a second press within one second; active dialogs/menus can still consume `Ctrl+C` first.
- `AgentLoop` now uses execution events as its canonical runtime history; `currentRun`, adapter contexts, state notifications, and returned Run state are projections rather than mutable source-of-truth objects.
- Turn semantics now follow a pi-style boundary: one Turn is one model response plus all tools requested by that response; tool-result continuation starts a new `tool-continuation` Turn.
- Steering is consumed after the active Turn and before automatic tool continuation; follow-up is consumed only when the Run would otherwise become idle.
- The CLI input remains available during active Runs: Enter queues steering, Alt+Enter queues follow-up, and Escape requests Run interruption.
- Execution history is explicitly separated from durable Session semantic history, ephemeral lifecycle updates, and Context Projection.
- Session persistence now appends semantic Entries incrementally instead of creating one checkpoint node only after an entire Run completes; best-effort cloud snapshot writes are serialized to prevent stale request completion from overwriting newer state.
- CLI model and mode changes are persisted immediately as branch-local state Entries and restored when navigating Session history.
- `/tree`, `/jump`, `/parent`, and `/root` now navigate Session Entries directly rather than v2 checkpoint nodes; ordinary chat rendering remains a message-only projection.

### Compatibility

- The current CLI upgrades legacy linear message arrays plus Session Tree v1/v2 snapshots to Session Entry Tree v3 in memory; the Server accepts v1/v2/v3 state payloads during the compatibility period.
- No Prisma schema migration is required because versioned Session state remains stored in the existing JSON field.

## [1.1.0] - 2026-08-12

### Added

- Explicit Harness `Run -> Turn -> Step` lifecycle and local-first Agent Loop.
- Context Runtime with model-specific token budget profiles, retained-tail handling, turn-aware projection, and bounded history compaction.
- Session Tree v2 with canonical message events, arbitrary node jumping, historical branching, and legacy v1/linear-session recovery.
- Session tree commands: `/tree`, `/jump`, `/parent`, and `/root`.
- Token counter abstraction supporting provider-calibrated estimators and future exact tokenizer adapters.

### Changed

- Model execution now runs directly in the CLI instead of through the cloud Server.
- Server is reduced to cloud session/account persistence and accepts versioned Session Tree state.
- Session nodes no longer duplicate complete message snapshots; node history is reconstructed by replaying canonical events along the active tree path.
- Context compaction preserves complete turns and summarizes omitted history without mutating canonical history.

### Compatibility

- Existing linear message snapshots and Session Tree v1 snapshots are upgraded to Session Tree v2 when restored by the CLI.
- No Prisma schema migration is required for this release because versioned session state remains stored in the existing JSON field.
