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
- Coverage-aware Branch Summary navigation analysis with LCA/source-only semantic deltas, exact provenance metadata, and incremental transfer deduplication.
- Lazy Branch Summary navigation policy `ask | always | never` (`ask` default), with shared Carry / No Carry / Cancel semantics across `/tree`, `/jump`, `/parent`, and `/root`.
- Dedicated bounded Branch Summary semantic reducer with Tool Result pre-pruning and deterministic fallback.
- ADR-0014 documenting lazy branch knowledge transfer, provenance, navigation semantics, and Context/Compaction interop.
- Independent `packages/runtime-store` SQLite persistence boundary with its own Prisma schema, generated client, migration, and explicit adapter dependencies.
- Session-scoped Runtime Event/Snapshot contracts, database-assigned replay offsets, disposable Projection Cache, hybrid Snapshot Policy, and reducer-based snapshot-plus-replay recovery diagnostics.
- SQLite integration coverage for append ordering, cross-session isolation, restart recovery, and snapshot/replay parity.
- ADR-0016 separating the PostgreSQL Cloud Session Store from the SQLite Local Runtime Store and superseding ADR-0015's shared-package placement.
- Per-user Runtime Store bootstrap at `~/.more-more-code/runtime/runtime.db`, with an absolute file-URL override and embedded idempotent migrations that do not invoke Prisma CLI at application startup.
- Durable `RuntimeSession` wiring for AgentLoop write-ahead execution events, snapshot/replay recovery, Projection Cache warming, and visible incomplete-work diagnostics without automatic replay.
- Strict schema-v1 execution/tool/security/context/system Runtime Event allowlists plus awaited redacted Tool permission/lifecycle and Context projection producers.
- ADR-0017 documenting production Runtime Store lifecycle, fail-closed side-effect ordering, strict redaction, and report-only recovery.
- Unified Harness permission request/decision/rule contracts with deterministic capability, command, path, resource, and scope matching.
- Global-to-project persisted permission overrides, Tool Registry resource classification, and Tool Runtime enforcement before executor invocation.
- Shared canonical workspace path resolution for policy and native filesystem execution, including symlink/junction escape rejection and segment-aware platform path globs.
- Independently versioned schema-v2 permission request/decision lifecycle events with schema-v1 decision compatibility and strict raw command/path rejection.
- ADR-0019 documenting effective permission policy precedence, the Tool Runtime enforcement seam, and redacted lifecycle persistence.
- Derived session-scoped security audit projection over Runtime Events, with v1 legacy entries, v2 request/decision correlation, durable offsets, and explicit complete/pending/inconsistent states.
- Security lifecycle consistency replay that validates request/decision/Tool-terminal invariants without reconstructing redacted command, path, or resource values.
- Dangerous-operation coverage for composed command patterns, multi-capability denial, outside-workspace symlink/junction paths, and fail-closed policy/observer failures.
- ADR-0020 documenting derived audit projection, lifecycle consistency replay, and the boundary between application policy and OS-level sandboxing.
- Provider-independent Tool-call approval transaction contracts and a process-local CLI `InteractiveApprovalBroker` with exact one-time resolution, abort cleanup, and Session-unmount cancellation.
- Interactive Tool approval UI with ephemeral operation details and `Allow once | Deny` choices; dismiss/Escape cancels the pending transaction and never mutates permission config.
- Independently versioned schema-v3 `approval.lifecycle` Runtime Events with strict redaction and schema-v1/v2 backward compatibility.
- Approval-aware security audit replay correlating `ask` permission decisions, human approval outcomes, and Tool terminals.
- ADR-0021 documenting Permission Policy / Approval Broker separation, same-Tool-Step resume, write-ahead approval ordering, and one-time approval scope.
- Layered process Sandbox configuration with strict `off | auto | required` mode, `inherit | deny` network policy, `inherit | safe` child environment policy, and explicit `envAllow` names.
- Deep CLI `ProcessSandbox` execution seam that owns native child-process launch, provider discovery/status, writable workspace/cwd containment, and fail-closed hard-restriction handling.
- Safe child-process environment projection that prevents ambient provider/API credentials from entering native shell processes unless explicitly allowlisted.
- Linux Bubblewrap launch-plan adapter with read-only host root, writable workspace, masked home/private temp, process namespaces, and optional network isolation.
- Sandbox status in `/settings`, including explicit direct fallback/unavailable reasons rather than treating unsupported hosts as isolated.
- ADR-0022 documenting Process Sandbox semantics, Linux Bubblewrap isolation, safe environment policy, and the unresolved Windows native isolation boundary.
- ADR-0023 accepting the next local-first architecture: local Provider/Credential configuration, four built-in providers plus Custom OpenAI-compatible endpoints, Local Session authority, and an optional cloud limited to multi-device sync/backup plus commercial entitlements.
- User-global strict `ProviderRegistry` at `~/.more-more-code/providers.json`, with exactly OpenAI/Anthropic/Google/DeepSeek built-ins, multiple stable Custom OpenAI-compatible provider IDs, dynamic configured model lists, and no raw provider secrets in registry serialization.
- Canonical `{ providerId, modelId }` `ModelRef` runtime selection with deterministic migration of legacy recommended model IDs and conservative Context/token-budget fallback for configured models absent from the recommended catalog.
- Deep `CredentialStore` and provider-auth seams with AES-256-GCM local encrypted storage, read-only environment credential compatibility, API-key/Bearer/None strategies, and an explicitly unavailable experimental Codex OAuth broker that never reads private Codex token files.
- `/providers` provider/status/config/credential UX and dynamic `/models` selection driven by configured Provider Registry entries.
- Provider Registry/Credential/ModelRef regression coverage for disposable homes, invalid config, multiple custom endpoints, encrypted secret round-trip, migration, auth failure, and unknown-model Context fallback.
- `packages/session-store` LocalSessionStore with SQLite migrations, transactionally validated Session Tree topology, root/active metadata, stable append sequences, archive, and idempotent commits.
- CLI Local Session Authority for offline create/list/open/continue/restart/branch flows, with durable-first user/model/tool/automatic-compaction transitions.
- Focused local-only coverage for Session Store persistence/restart/migration/transaction/idempotency, fetch-free Session lifecycle, durable-first ordering, compaction durability, secret-safe Provider connection probes, and persisted model defaults.
- ADR-0024 documenting local-only Session authority, Railway retirement, disabled cloud surfaces, and capability-gated Codex OAuth.
- ADR-0026 semantic Session follow-up with pure Navigation Tree Projection, derived ToolUse rows, legacy `message_update` folding, terminal ToolResult navigation anchors, and step-scoped finalized assistant persistence.

### Changed

- CLI startup now bootstraps the Agent Environment before rendering or starting any Session Run.
- The local system prompt is now a concise coding-agent prompt that includes PLAN/BUILD rules, skill metadata, and the resolved instruction chain.
- PLAN mode includes `loadSkill` alongside the existing read-only native tools.
- System-prefix construction is ordered as core prompt → global instructions → project instructions → Skill catalog, while model-visible Tool schemas remain deterministic through the ToolSet snapshot.
- Persisted Session `compaction` entries are reused as Context checkpoints across later Model Steps and restored sessions; a newer checkpoint reduces the previous effective checkpoint plus newly compacted history into one complete replacement state snapshot, while older checkpoint Entries remain durable tree history.
- Context Compaction now starts proactively at configured utilization thresholds instead of waiting for hard truncation; only optional historical groups are eligible, retained recent Turns remain atomic, and semantic-reducer failure falls back without making the primary Model Step depend on compaction-provider availability.
- Model Context construction now prunes eligible warm/cold Tool Results before considering historical Compaction; fresh Tool continuation remains full when feasible and durable Session payloads are never rewritten by pruning.
- Manual compaction can run below automatic soft/hard thresholds but now rejects too-small, too-recent, or low-benefit requests before reducer execution; repeat eligibility is derived from checkpoint progress rather than elapsed time and still preserves required/retained records, atomic Context groups, checkpoint replacement, active-branch isolation, and append-only Session history.
- Active-path Branch Summary text now enters canonical historical Context independently from UI Message Projection; older summaries may be absorbed by normal Compaction, with generic record coverage preventing checkpoint-reuse duplication.
- Session navigation no longer treats browsing as branching: No Carry appends nothing, Cancel leaves the source active, and successful Carry appends exactly one provenance-bearing `branch_summary` child under the target.
- AgentLoop Tool Steps now route native capabilities through Tool Runtime and persist optional normalized status/source/timing metadata on `tool_result` Entries.
- Native filesystem operations now receive the Tool Step workspace root and cooperative AbortSignal where supported.
- Native command execution now uses the Runtime workspace root and completes interruption/timeout through Tool Runtime with normalized cancellation status.
- OpenAI model execution explicitly selects the Responses API through `openai.responses(...)` and derives `promptCacheKey` from the prompt-prefix fingerprint; `previousResponseId` remains outside canonical Session authority.
- Provider cache read/write usage is retained as runtime diagnostics rather than semantic Session history.
- `packages/database` is restored as the PostgreSQL cloud Session boundary; local Runtime Event models now live in the independent SQLite Runtime Store so Server Session types and migrations cannot be replaced by local recovery work.
- CLI startup now opens one shared Local Runtime Store before rendering, and normal exit closes it after Session use.
- Native Bash cancellation now terminates the monitored process group and waits for descendants, including on Windows/MSYS where killing only the outer `bash.exe` can leave grandchildren alive.
- The real CLI launcher no longer contains a trailing executable identifier.
- RuntimeSession now serializes same-Session append/projection work; derived snapshot failure preserves committed event success and records bounded-backoff retry diagnostics.
- CLI Tool Step infrastructure failures now propagate to AgentLoop instead of being converted into ordinary Tool outcomes that permit later side effects.
- Tool Runtime construction now requires an explicit `PermissionPolicy`; the implicit allow-all fallback was removed from the security enforcement seam.
- Tool Runtime now evaluates all capabilities before prompting, batches all asks for one Tool Call into one approval transaction, and resumes the original Tool Step only after an awaited durable `Allow once` resolution.
- Approval request/resolution observer failures are fail-closed: broker interaction cannot start before a durable request fact, and executor invocation cannot start before a durable approval-allow fact.
- Native `bash` and `grep` subprocesses now share the `ProcessSandbox` seam; `local-tools.ts` no longer creates child processes directly, while existing Bash descendant cancellation remains intact for direct/MSYS execution.
- Native `grep` now resolves Git-for-Windows' `usr/bin/grep.exe` when GNU grep is available inside Git Bash but not exposed on the Windows process PATH, eliminating the previous `ENOENT` path on that setup.
- The post-Stage-6.3 roadmap is reordered to Provider Runtime → Local Session Authority/Railway Retirement → Cloud Session Sync/Commercial Entitlements → Windows Native Sandbox. Stage 6.4 and the local-only Stage 6.5 implementation are delivered; Stage 6.6 is paused and Stage 6.7 remains planned.
- Provider execution no longer treats the shared recommended model catalog as the runtime allowlist: configured Provider Registry accounts now create AI SDK models through one resolver seam, including Google through its OpenAI-compatible Gemini endpoint and Custom V1 through configurable OpenAI-compatible base URLs.
- Project/global Agent Config may select the default `providerId/modelId`, while provider account/endpoint configuration stays user-global and credentials stay outside Agent Config/Provider Registry JSON.
- Local CLI Session creation, listing, opening, continuation, Context/cache/checkpoint handling, and restart recovery no longer depend on Server, `API_URL`, Clerk, Cloudflare, or Railway; `packages/server` and `packages/database` remain dormant future-cloud code.
- The Cloudflare Worker, Railway origin/deployment material, root Wrangler dependency/scripts, CLI cloud helpers, and `/login`/`/logout` surfaces are retired from the local workflow.
- `/providers` connection validation now reports a secret-safe resolved URL and typed configuration/credential/protocol/HTTP/model/network failures; `/models` defaults persist locally across restart.
- Codex OAuth is hidden while no supported documented model-execution broker exists; OpenAI API Key remains the supported local path, and the CLI never reuses private Codex token files.
- Stage 6.5 Local Session Authority & Railway Retirement is delivered; Stage 6.6 Cloud Session Sync & Commercial Entitlements is paused pending explicit product re-approval.
- Normal assistant persistence now appends one immutable `assistant_message` per completed AgentLoop Model Step; normal Tool completion no longer writes `message_update`, while existing update-bearing v3 Sessions remain readable through the legacy projection path.
- `/tree` and `/jump` now consume semantic Navigation Tree Projection rows rather than raw Session Entries: bookkeeping/update rows are folded, ordinary single-child history stays flat, true branches retain topology, and canonical `tool_call` + `tool_result` facts appear as one derived ToolUse whose terminal navigation target is the `tool_result` Entry.
- Tool terminal UI/provider state is reconstructed from canonical `tool_result` facts through Message Projection, preserving request-before-side-effect and result-before-continuation ordering without duplicating terminal truth into assistant history.

### Fixed

- Local Session creation now preserves the Web Crypto receiver when using the production default UUID generator, preventing Bun `ERR_INVALID_THIS` / `Expected this to be instanceof Crypto` failures before Provider execution; regression coverage now exercises the real default-ID path.
- AI SDK runtime messages with explicit optional fields such as `providerMetadata: undefined` are now normalized at one CLI durable-message boundary before Session Tree construction. Object `undefined` is omitted, array holes/`undefined` retain position as `null`, valid Provider metadata survives restart, unsupported JavaScript values remain fail-closed, and normal sync/compaction/Tool-terminal persistence no longer maintain divergent cleanup policies.
- Tool-continuation finalization no longer treats AI SDK assistant `UIMessage.id` as immutable Session identity. AI SDK v7 can reuse one aggregate assistant message across multiple Model Steps; durable assistant ids are now derived from AgentLoop `stepId`, and only the parts after the latest `step-start` marker are persisted for each completed step. This fixes `Finalized durable assistant message ... already exists with different content` without reintroducing `message_update` or duplicating Tool Call/Result semantics.
- Windows CLI integration-test cleanup now treats a persistently locked temporary libsql directory as best-effort only after explicit store close, successful persistence/restart assertions, and bounded retries; Session/database operation failures and non-transient cleanup errors remain test failures.
- The `/providers` custom-provider editor integration test now drives OpenTUI keyboard state through React test transactions instead of depending on batched synthetic key events that could observe stale selection state.

### Deferred

- Windows/macOS native OS Sandbox adapters, MCP transport/auth/remote tool execution, persistent allow-for-session/project rules, and product-level Subagent runtime remain outside this delivery slice.
- Explicit transactional/idempotent import of legacy linear/v1/v2/v3 Session snapshots remains a non-blocking follow-up; it is not required for new local Sessions and does not add a startup cloud fetch.
- Real external-Provider E2E coverage and Codex OAuth model execution remain unclaimed until the corresponding supported contracts exist.

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
