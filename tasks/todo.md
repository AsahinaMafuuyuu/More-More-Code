# Stage 5.1 + Stage 6 — Session Semantics & Tool Runtime

## Stage C — Context Cache Stability & Reliable Compaction Runtime (2026-08-29)

- [x] C1 permanent `CacheFamilyId` / `ContextEpochId` / `RenderedPrefixDigest` + miss classification
- [x] C2 provider capability-aware cache controls and deterministic batch breakpoints
- [x] C3 Pi-style recent raw suffix selection + Compaction Plan + Checkpoint V2 + V1 compatibility
- [x] C4 required-anchor validation + priority-aware deterministic fallback without arbitrary tail truncation
- [x] C5 transactional `commit -> rehydrate -> Provider` cutover + Compaction Runtime Activity UI
- [x] C6 focused/full regressions, typechecks/build/stress and documentation closeout
- [ ] C7 remove temporary full-context recorder only after explicit investigation closeout

---

## Stage 5.1 — Semantic Lock

- [x] Keep chained compaction semantics covered: a replacement checkpoint compacts the previous checkpoint plus newly omitted history
- [x] Verify Context Projection supersedes the old checkpoint and projects latest checkpoint + retained history
- [x] Preserve append-after-jump Session Tree behavior as an independent child branch
- [x] Preserve restore as `Tree + activeEntryId` with message/runtime/checkpoint projections
- [x] Add semantic Session event + timestamp colors to Theme
- [x] Use semantic Theme colors and timestamps in Session Tree UI

## Stage 6 — Tool Runtime

- [x] Add Tool Runtime contracts and normalized execution result/status types
- [x] Add tool capability metadata and permission policy interface (`allow | deny | ask`)
- [x] Add native source adapter and Registry visibility enforcement
- [x] Propagate AgentLoop AbortSignal into Tool Runtime and cooperative native operations
- [x] Add generic Tool Runtime timeout handling
- [x] Bind AgentLoop abort to an already-running native shell process and cancel its output readers so interruption returns immediately (Stage 6.1)
- [x] Route `use-chat` Tool Steps through Tool Runtime
- [x] Persist normalized tool status/source/timing on `tool_result` Session Entries
- [x] Add focused Tool Runtime tests for mode denial, permission deny/ask, completion, cancellation, and timeout

## Documentation & Verification

- [x] Add ADR-0011 for Session/Context/Tool Runtime invariants
- [x] Update CONTEXT / CHANGELOG / current-state docs / project Agent instructions and Context README semantics
- [x] Run Harness + CLI tests
- [x] Run Shared / Harness / CLI / Server typechecks
- [x] Run CLI / Server builds
- [x] Run `git diff --check`

## Deferred

- [ ] MCP transport / remote tool execution
- [x] Interactive permission approval UI (delivered in Stage 6.2 as Allow once / Deny)
- [ ] OS-level Sandbox enforcement
- [ ] Local WAL / crash recovery
- [ ] Cloud revision/conflict sync
- [ ] Subagent Runtime
- [ ] OpenAI server-side conversation as Session authority

---

## Stage 5.2 — Semantic Context Compaction

- [x] Add soft/hard utilization policy and post-compaction target utilization
- [x] Compact only older atomic groups/turns; never split retained/tool/message groups at the cut point
- [x] Keep incremental replacement semantics: previous checkpoint + newly compacted history → new complete checkpoint
- [x] Add trigger/token/source metadata to compaction results and persisted Session entries
- [x] Replace chronology-only primary compaction with a structured semantic state reducer at the CLI/provider boundary
- [x] Keep bounded deterministic compaction as failure fallback
- [x] Add Harness tests for soft trigger, no-thrash checkpoint reuse, safe group boundaries, hard overflow, and chained checkpoints
- [x] Add focused CLI semantic-compactor tests and verify fallback behavior
- [x] Update Server Session validation for optional richer compaction metadata
- [x] Add/update ADR, Context docs, CHANGELOG, and current-state documentation
- [x] Run focused tests, Harness suite, CLI build, relevant typechecks, and `git diff --check`

---

## Stage 5.3 — Context Working Set, Tool Result Pruning & Manual Compaction

### Tool Result Projection & Budget

- [x] Add provider-independent Tool Result projection modes: `full | truncated | summary | reference`
- [x] Preserve durable Session `tool_result` payloads unchanged while allowing bounded model-facing projections
- [x] Preserve Tool Call/Result semantic pairing and durable source-entry references after pruning
- [x] Add Tool Result freshness lifecycle: `fresh -> warm -> cold/reference-eligible`
- [x] Derive a Tool Working Set budget from the effective model input budget
- [x] Keep the immediate tool-continuation result full when feasible; prune eligible warm/older results first under budget pressure
- [x] Surface explicit over-budget state when required/current Tool Results alone cannot fit instead of silently dropping them

### Strategy-aware Tool Result Pruning

- [x] Keep small Tool Results full below the pruning threshold
- [x] Add bounded generic truncation + durable reference fallback
- [x] Add shell pruning that preserves command/status, useful head, error-bearing lines, and tail
- [x] Add test/build pruning that prioritizes aggregate outcome, failures, errors, warnings, and nearby lines
- [x] Add search/grep pruning that preserves bounded matches plus file/line locations
- [x] Add file-read projection that retains useful/requested ranges and a source reference without indefinitely duplicating huge file bodies
- [x] Ensure every strategy respects its assigned token budget and never mutates canonical Session history

### Context Pipeline Integration

- [x] Run Tool Result working-set projection/pruning before historical Context Compaction
- [x] Cover prune-only path where pruning alone returns Context below the automatic compaction threshold
- [x] Cover prune-then-compact path where semantic historical Compaction is still required afterward
- [x] Preserve stable-prefix ordering, deterministic serialization, and persisted checkpoint reuse

### Manual Compaction

- [x] Extend compaction trigger semantics with `manual`
- [x] Add a gated request-compaction path that bypasses automatic soft/hard threshold checks but still respects safe atomic cut points and retained/required records
- [x] Make manual compaction return a typed no-op when no historical groups are safely compactable
- [x] Reject manual compaction when safely compactable history is below `max(2048 tokens, 3% input budget)`
- [x] Reject repeat manual compaction until an existing checkpoint has at least 2 genuinely new completed Turns and sufficient compactable history
- [x] Exclude the previous checkpoint retained-tail IDs from the new-Turn count
- [x] Reject manual compaction when conservative estimated savings are below `max(1024 tokens, 2% input budget)` or below 30% of replacement-source tokens
- [x] Use checkpoint-relative progress rather than wall-clock cooldown for repeat-compaction protection
- [x] Preserve chained checkpoint semantics for manual compaction: previous checkpoint + newly compacted history -> replacement checkpoint
- [x] Add `/compact` CLI command without creating a fake user message/Turn
- [x] Route `/compact` through the same semantic reducer + deterministic fallback + Session checkpoint persistence pipeline as automatic compaction
- [x] Report manual compaction result with before/after tokens, trigger, fallback/no-op status where available
- [x] Verify `/compact` affects only the active branch and never deletes source entries or sibling branches

### Documentation & Verification

- [x] Add/update ADR separating Tool Result Pruning, historical Compaction, and Branch Summary responsibilities
- [x] Document Tool Result lifecycle, Tool Working Set budget, pruning strategies, references, and `/compact`
- [x] Update README / CONTEXT / CHANGELOG / current-state docs / command help
- [x] Add Harness tests for Tool Result projection/budget/freshness and manual compaction
- [x] Add CLI tests for pruning integration and `/compact` command behavior
- [x] Run Harness + CLI suites, Shared/Harness/CLI/Server typechecks, CLI/Server builds, and `git diff --check`

### Deferred from Stage 5.3

- [ ] LLM semantic summarization of individual Tool Results
- [ ] External blob/object storage for large Tool Result payloads
- [ ] Arbitrary content/relevance scoring beyond freshness and Tool Working Set policy
- [ ] Aggressive manual modes such as `/compact --all`
- [x] Branch Summary semantic transfer implementation — delivered in Stage 5.4
- [ ] Exact tokenizer support for every provider/model family

---

# Stage 5.4 — Branch Knowledge Transfer & Lazy Branch Summary

**Status:** Delivered — 2026-08-14.

### Navigation Delta & Provenance

- [x] Add pure Session Tree source/target path comparison and LCA calculation
- [x] Treat target-path containment of the current source path as no information-loss navigation
- [x] Extract only source-only Entries after the LCA for ancestor/cross-branch navigation
- [x] Filter Branch Summary candidates to semantic Entries; ignore `session_start`, `model_change`, `mode_change`, and `config_change` by default
- [x] Keep `user_message`, `assistant_message`, relevant message updates, tool call/results, errors, compaction, branch summaries, and supported semantic custom Entries eligible
- [x] Add structured transfer metadata with `sourceTipEntryId`, `targetEntryId`, `commonAncestorEntryId`, and exact `coveredEntryIds`
- [x] Deduplicate repeated transfers by subtracting Entry IDs already covered by prior relevant Branch Summary transfers
- [x] Allow prior Branch Summary Entries to participate as transferable semantic knowledge

### Branch Summary Reduction

- [x] Keep `summary` itself as bounded plain text; keep provenance/coverage as structured Session metadata
- [x] Add a Branch Summary reducer contract separate from Context Compaction semantics
- [x] Use stable text sections for key findings, decisions, artifacts, failures/lessons, and pending work
- [x] Cap Branch Summary output at `min(4096 tokens, 4% effective input budget)`
- [x] Do not add a Compaction-style gain-ratio gate; meaningful knowledge preservation is sufficient reason to transfer
- [x] Run Tool Result Working Set/pruning before Branch Summary reduction when source delta contains large Tool Results
- [x] Add deterministic fallback for reducer failure
- [x] Append nothing when both semantic and deterministic reduction cannot produce valid non-empty summary text

### Lazy Navigation Transfer

- [x] Add `branchSummaryOnJump = ask | always | never` with `ask` as the default
- [x] Route `/tree`, `/jump`, parent/root, and equivalent navigation through one navigation/transfer controller
- [x] Do not ask when target Context already contains the source path or source-only semantic delta is empty
- [x] `Cancel`: keep the original source active and append nothing
- [x] `No Carry`: jump only; append nothing and do not create a branch until a later real Session mutation
- [x] `Carry`: jump to target, generate transfer, append exactly one `branch_summary` child, and make it active
- [x] If Carry reduction fails completely, leave the target active and append no invalid/empty Branch Summary
- [x] Verify ordinary browsing never creates durable Session branches

### Context & Compaction Interop

- [x] Project active-path Branch Summary text into canonical historical Context without creating fake chat messages
- [x] Keep UI Message Projection unchanged
- [x] Preserve stable provider-independent Context ordering
- [x] Allow sufficiently old Branch Summary records to participate in normal historical Compaction
- [x] Ensure absorbed Branch Summary knowledge is not duplicated after checkpoint reuse
- [x] Preserve append-only source Branch Summary Entries after Compaction

### Tests, UX & Delivery

- [x] Add Harness tests for descendant, ancestor, sibling, cross-branch, and root navigation analysis
- [x] Add tests for state-only delta, incremental coverage, prior-summary propagation, and non-contiguous coverage
- [x] Add reducer/fallback/oversized-Tool-Result tests
- [x] Add CLI tests for `ask | always | never`, Carry / No Carry / Cancel, and lazy branch creation
- [x] Add Branch Summary -> Compaction -> restore regression coverage
- [x] Add/update ADR for Branch Knowledge Transfer and lazy navigation semantics
- [x] Update README / CONTEXT / PROJECT_ANALYSIS / CHANGELOG / command/settings documentation
- [x] Run full tests, Shared/Harness/CLI/Server typechecks, CLI/Server builds, and `git diff --check`
- [x] Verify backward compatibility with existing `branch_summary` Entries that contain only `summary`

### Deferred from Stage 5.4

- [ ] Automatic semantic branch merge/conflict resolution
- [ ] Branch ranking or relevance search across unrelated branches
- [ ] LLM relevance scoring over arbitrary branch history
- [ ] In-place editing/rewriting of existing Branch Summary Entries
- [ ] Dedicated branch IDs instead of path-derived branches
- [ ] Cloud collaborative branch merge semantics


# Stage 6.0 — Recoverable Runtime & Security Foundation

**Status:** In progress — Phases 1–3 foundation delivered 2026-08-22 and Phase 4 delivered 2026-08-23; Phases 5–6 remain.

## Phase 1: Repair Persistence Boundaries

- [x] Restore the PostgreSQL `Session` schema/client used by Server routes.
- [x] Remove Runtime Event storage from the cloud database package.
- [x] Add an independent SQLite Runtime Store workspace package.
- [x] Declare and lock the Bun-compatible SQLite Prisma adapter and driver dependencies.
- [x] Add a configurable local database URL and committed initial migration.
- [x] Verify Server typecheck/build and both Prisma schemas.

## Phase 2: Durable Runtime Event Store

- [x] Finalize typed, session-scoped EventStore and RuntimeSnapshot contracts.
- [x] Use database-assigned append-only event offsets.
- [x] Map Prisma rows to Harness contracts without leaking ORM types.
- [x] Add session-isolation and concurrent-append integration tests.
- [x] Make the memory Projection Cache offset-aware and reject stale regressions.

## Phase 3: Snapshot and Recovery

- [x] Finalize hybrid session-event-count/time SnapshotPolicy behavior.
- [x] Save and load session-scoped Runtime Snapshots.
- [x] Replay post-snapshot events through an explicit projection reducer.
- [x] Verify full-replay and snapshot-plus-replay parity.
- [x] Surface incomplete runs without automatically re-executing external work.
- [x] Add Bun-native temporary-SQLite restart and recovery tests.

## Phase 4: Production Runtime Wiring

- [x] Create `~/.more-more-code/runtime/runtime.db` by default with an explicit environment override.
- [x] Run embedded versioned migrations idempotently without requiring Prisma CLI at runtime.
- [x] Bootstrap and close one shared Runtime Store from the CLI lifecycle.
- [x] Remove the invalid trailing identifier from the real CLI launcher and cover it with a regression check.
- [x] Define versioned strict-allowlist execution/tool/context/security/system Runtime Event payloads.
- [x] Persist AgentLoop execution events through a write-ahead, fail-closed Runtime Session adapter.
- [x] Restore snapshot-plus-replay projection state and warm Projection Cache per session.
- [x] Emit awaited Tool request, permission, and terminal facts without raw input/output.
- [x] Emit Context projection lifecycle metrics without prompts or message bodies.
- [x] Persist session-open/recovery diagnostics and expose incomplete work without replay.
- [x] Verify first-run/repeated-start migrations, write ordering, strict redaction, failure handling, restart recovery, and CLI notification.

## Phase 5: Permission & Enforcement

- [x] Consolidate Harness and CLI `allow | deny | ask` contracts.
- [x] Add capability rules for commands, paths, resources, and scopes.
- [x] Generate effective policy from defaults plus persisted user overrides.
- [x] Enforce the effective decision inside Tool Runtime.
- [x] Persist permission requests and decisions as security Runtime Events.

## Phase 6: Audit & Validation

- [x] Add a session-scoped security audit timeline projection.
- [x] Add lifecycle consistency replay verification for v1/v2 permission events (not redacted policy recomputation).
- [x] Add dangerous command/path/symlink/multi-capability and fail-closed operation tests.
- [x] Update ADR, README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, and Agent rules for the delivered foundation.
- [x] Run foundation tests, typechecks, builds, Prisma validation/generation, migration deploy, and `git diff --check`.
- [x] Complete the final Stage 6.0 audit/delivery review and close with no residual P0/P1 findings.

## Deferred

- [ ] PostgreSQL synchronization of local Runtime Events.
- [ ] Sandbox/container runtime.
- [ ] Automatic restart of interrupted external processes.
- [ ] Multi-agent framework.
- [ ] Full OpenTelemetry integration.

# Stage 6.2 — Interactive Approval & Permission UX

## Phase 1: Approval Contract & Durable Protocol

- [x] Add provider-independent Tool-call approval transaction contracts in Harness.
- [x] Add redacted independently versioned `approval.lifecycle` Runtime Events with v1/v2 compatibility.
- [x] Verify raw command/path/resource values cannot cross the durable approval event seam.

## Phase 2: Tool Runtime & Interactive Broker

- [x] Refactor Tool Runtime to evaluate all capabilities before prompting and batch all ask requirements into one Tool-call approval.
- [x] Continue the same Tool Step after `Allow once`; block executor on deny/cancel/timeout.
- [x] Implement process-local `InteractiveApprovalBroker` with subscription, exact resolution, and abort cleanup.
- [x] Make approval waiting independently timeout-aware and Run-interruptible.

## Phase 3: Audit Compatibility & CLI UX

- [x] Extend security audit replay to validate approval lifecycle and interactive ask outcomes.
- [x] Add CLI approval dialog showing ephemeral operation details with `Allow once` and `Deny` only.
- [x] Treat Escape/dialog dismissal and Session unmount as approval cancellation with no stranded Tool Step.
- [x] Verify approval actions never persist global/project permission overrides.

## Phase 4: Documentation & Delivery

- [x] Add/update ADR, README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, and current-state documentation for Stage 6.2.
- [x] Run approval-focused and full Harness/CLI/Runtime Store tests.
- [x] Run Shared/Harness/CLI/Server/Database/Runtime Store typechecks.
- [x] Run CLI/Server builds, both Prisma validate/generate paths, and `git diff --check`.
- [x] Complete integrated security review with no residual P0/P1 and commit Stage 6.2.

## Explicitly Deferred from Stage 6.2

- [ ] Allow-for-session / allow-for-project persistent approval rules.
- [ ] OS-level Sandbox enforcement.
- [ ] Shell-AST-aware command authorization.
- [ ] MCP transport/auth/remote Tool execution.
- [ ] Cloud synchronization of approval/runtime events.

# Stage 6.3 — Sandbox Execution Foundation & Process Hardening

## Phase 1: Configuration & Deep Process Seam

- [x] Add layered `sandbox.mode/network/environment/envAllow` Agent Config with deterministic global -> project merge semantics.
- [x] Add a deep `ProcessSandbox` module for provider discovery, status, environment projection, launch policy, and child-process creation.
- [x] Verify `required` fails before spawn and `auto` cannot silently drop explicit hard network isolation.

## Phase 2: OS Adapter & Native Tool Integration

- [x] Add safe child-process environment projection that excludes ambient provider/API credentials unless explicitly allowlisted.
- [x] Add Linux Bubblewrap launch-plan support for read-only host root, read-write workspace, private temp/home, namespace isolation, and optional network denial.
- [x] Route native `bash` and `grep` through `ProcessSandbox`; remove direct subprocess creation from `local-tools.ts`.
- [x] Preserve Bash descendant cancellation, grep semantics, timeout propagation, and bounded output.

## Phase 3: Documentation, Security Review & Delivery

- [x] Add ADR-0022 and update README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, current-state docs, and project Agent configuration.
- [x] Run focused/full CLI and Harness tests plus package typechecks/builds and Prisma validation/generation.
- [x] Review fail-open paths and platform capability claims; close with no residual P0/P1 finding.
- [x] Commit Stage 6.3 on `stage/6.3-sandbox-execution-foundation` with a clean working tree.

## Explicitly Deferred from Stage 6.3

- [ ] Windows AppContainer/restricted-token/Job-object and equivalent macOS native sandbox adapters.
- [ ] Full cross-platform host-read confidentiality isolation.
- [ ] Allow-for-session / allow-for-project persistent approval rules.
- [ ] Shell-AST-aware command authorization.
- [ ] MCP transport/auth/remote Tool execution and sandboxing.
- [ ] Cloud synchronization of approval/runtime events.

---

# Stage 6.4 — Provider Runtime & Local Model Configuration

**Status:** Completed — delivered 2026-08-23.

## Provider Domain & Registry

- [x] Replace closed provider identity with `ProviderId` + `ProviderKind`.
- [x] Keep built-in provider kinds exactly OpenAI / Anthropic / Google / DeepSeek.
- [x] Remove Mistral from shared model/provider catalog, resolver assumptions, docs, and UI.
- [x] Add `custom` provider kind with multiple stable user-defined provider IDs.
- [x] Add strict versioned user-global `~/.more-more-code/providers.json` persistence.
- [x] Keep provider account/endpoint config out of project `.more-more-code/config.json`; allow project config only to reference/select a provider/model.
- [x] Reject duplicate provider IDs, invalid URLs, unknown fields, and invalid protocol/auth combinations.

## Credentials & Authentication

- [x] Add deep `CredentialStore` interface and scoped encrypted local adapter strategy behind the seam; OS-native secret storage remains a hardening follow-up.
- [x] Ensure JSON provider/project config stores credential references/model refs only, never plaintext provider secrets.
- [x] Add API-key auth for OpenAI, Anthropic, Google, and DeepSeek.
- [x] Add API Key / Bearer / None auth for custom OpenAI-compatible providers.
- [x] Add OpenAI `codex-oauth` as a distinct experimental auth strategy/broker seam.
- [x] Do not read/copy private `~/.codex` access/refresh token files or treat undocumented Codex tokens as generic OpenAI API credentials.
- [x] Do not add Anthropic OAuth in this Stage.
- [x] Keep Google OAuth / Vertex ADC and other OAuth providers explicitly deferred for later research.
- [x] Verify credentials cannot leak to Runtime Events, Session Entries, logs, Provider Registry serialization, or safe subprocess environments.

## Provider Adapters & Models

- [x] Resolve all four built-in providers through configured Provider Registry/auth state.
- [x] Add Custom Provider V1 using an OpenAI-compatible adapter with configurable `baseURL`.
- [x] Introduce canonical `{ providerId, modelId }` `ModelRef` semantics.
- [x] Convert recommended/built-in model catalog into defaults/metadata rather than the only allowed models.
- [x] Define deterministic Context profile/token-budget fallback for configured models absent from the recommended catalog.
- [x] Add backward-compatible migration for legacy Session `model` values.

## UX & Delivery

- [x] Add `/providers` inspect/add/edit/remove/credential/status UX as supported by each auth strategy; unavailable Codex OAuth exposes status rather than unsafe login emulation.
- [x] Refactor `/models` around configured providers and dynamic model refs.
- [x] Surface Codex OAuth experimental/unavailable states explicitly; never silently downgrade auth.
- [x] Update README / CONTEXT / PROJECT_ANALYSIS / current-state docs / CHANGELOG / ADR-0023 implementation status.
- [x] Run focused provider/config/credential/migration tests and full Shared/Harness/CLI verification.
- [x] Run secret-leak security review and `git diff --check` before Stage 6.4 delivery.

## Deferred from Stage 6.4

- [ ] Anthropic OAuth.
- [ ] Google OAuth / Gemini Code Assist login / Vertex ADC.
- [ ] Arbitrary custom protocols beyond OpenAI-compatible.
- [ ] External-Agent mode for Codex / Claude Code / Gemini CLI.
- [ ] Server-side model proxy or provider credential storage.

---

# Stage 6.5 — Local Session Authority & Railway Retirement

**Status:** Delivered — 2026-08-26. Final integrated review and full repository verification completed at delivery time. A subsequently discovered AI SDK runtime-message JSON compatibility defect is tracked in the Stage 6.5 Durable Message Normalization follow-up below; explicit legacy import remains a separate non-blocking follow-up.

## Local Session Store

- [x] Define a LocalSessionStore deep interface with create/load/list/atomic commit/archive.
- [x] Persist root/active Entry identity, append-only topology, stable sequence, metadata, migrations, and idempotency locally.
- [x] Move Session create/list/get/open to LocalSessionStore.
- [x] Make new/existing Session flows work with Server/API_URL unavailable.
- [x] Replace whole-tree cloud persistence with durable-first local transactions that fail before Provider/Tool side effects.
- [x] Define `activeEntryId` and other navigation state as device-local unless an explicit semantic sync field is introduced.
- [x] Keep semantic Session Store separate from Runtime Event/Snapshot Store.

## Provider & Cloud Removal

- [x] Remove the Railway Cloudflare Worker, root Wrangler scripts/dependency, and Railway deployment documentation.
- [x] Remove cloud `/login` and `/logout` from the local CLI and remove CLI runtime/type dependence on Server Session routes.
- [x] Preserve `/providers` API-key configuration, direct Provider execution, Harness Context, and local cache/checkpoint behavior.
- [x] Persist `/models` default selection and add a secret-safe Provider connection test/resolved URL preview.
- [x] Hide unsupported OAuth; expose Codex OAuth only through a supported documented broker contract.

## Migration, Tests & Delivery

- [ ] Import legacy linear/v1/v2/v3 Session state transactionally and idempotently without startup cloud fetches. Non-blocking follow-up; no explicit import command is implemented in this delivery.
- [x] Add Store contract/migration plus offline create/continue/restart/branch/cache/Provider integration tests.
- [x] Assert cloud/API URL fetches are zero throughout the local end-to-end path.
- [x] Update ADR-0023/ADR-0024, README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, and current-state docs.
- [x] Run focused tests, package typechecks/builds, and documentation checks.
- [x] Complete final integrated review and full repository verification after fixing the production default Session UUID path and the Provider-dialog test transaction boundary; no residual P0/P1 finding remains.

---

# Stage 6.5 Follow-up — Durable Message Normalization Boundary

**Status:** Delivered — 2026-08-26. Real Red reproduction, unified normalization integration, restart/idempotency regressions, full verification, and documentation delivery are complete.

## Contract & Red Reproduction

- [x] Add focused durable-message contract tests for object `undefined` omission and array/sparse `undefined` -> `null` semantics.
- [x] Verify valid JSON-safe Provider metadata and own `__proto__` data are preserved without mutating runtime messages.
- [x] Verify non-finite numbers, bigint, function, symbol, cycles, symbol properties, and non-plain objects remain fail-closed.
- [x] Add a real red persistence regression for an assistant part containing `providerMetadata: undefined` before changing production code.

## Normalization Integration

- [x] Add one CLI-owned durable-message normalization seam before Session Tree message construction.
- [x] Route normal message synchronization through the seam.
- [x] Route compaction history pre-sync through the same seam.
- [x] Consolidate Tool-terminal private `undefined` cleanup into the same policy without changing commit-before-expose ordering.
- [x] Keep Harness provider-independent and keep `LocalSessionStore` strict.

## Idempotency, Restart & Delivery

- [x] Prove repeated semantically equivalent message sync does not append redundant `message_update` Entries.
- [x] Prove valid Provider metadata survives local commit/restart and omitted optional fields remain absent.
- [x] Prove restart/continue stays local-only with no mandatory Server/API_URL call.
- [x] Run the full CLI, Session Store, Harness, typecheck/build, and `git diff --check` verification matrix.
- [x] Update ADR/design/test/delivery/current-state documents to Delivered only after all verification evidence exists.

---

# Stage 6.5 Follow-up — Finalized Message Persistence & Semantic Navigation Projection

**Status:** Delivered — 2026-08-27.

## Projection Foundation

- [x] Add the required Red regression proving raw navigation currently exposes `message_update`.
- [x] Add a pure Navigation Tree Projection that folds legacy `message_update` and default bookkeeping rows.
- [x] Preserve visible branch topology when hidden Entries are contracted.
- [x] Keep ordinary single-child visible chains structurally flat for rendering.
- [x] Add ToolUse projection that joins `tool_call` + `tool_result` by exact `toolCallId`.
- [x] Make terminal ToolUse navigate to the terminal `tool_result` Entry.
- [x] Define and test incomplete/orphan/duplicate Tool fact behavior fail-closed.

## Finalized Message Persistence

- [x] Add a Red regression proving normal streaming/tool flows currently append `message_update`.
- [x] Keep provider stream/message deltas in runtime/UI state rather than Session semantic history.
- [x] Append one normalized finalized `assistant_message` per completed AgentLoop Model Step.
- [x] Treat AI SDK assistant `UIMessage.id` as runtime aggregation identity only; derive durable assistant identity from `stepId` and persist only the current `step-start` segment.
- [x] Stop newly writing `message_update` in normal execution while keeping legacy-read support.
- [x] Never mutate an existing canonical Session Entry in place.

## Tool Terminal Projection & Durability

- [x] Preserve durable `tool_call` before external Tool execution.
- [x] Preserve durable `tool_result` before dependent Provider continuation.
- [x] Remove normal Tool terminal message write-back through `message_update`.
- [x] Derive terminal Tool UI/message state from canonical `tool_result` without mutating source Entries.
- [x] Prove fake Provider tool-continuation input contains one valid matching Tool Call/Result pair and no duplicates.
- [x] Prove a later follow-up remains provider-valid after two Model Steps reuse one AI SDK assistant `UIMessage.id`.
- [x] Preserve Tool Result Working Set durable source identity and pruning semantics.

## `/tree` Integration

- [x] Route `/tree` through Navigation Tree Projection instead of raw Session Entries.
- [x] Hide legacy `message_update` and default bookkeeping rows from normal navigation.
- [x] Show one derived ToolUse row rather than separate Tool Call and Tool Result rows.
- [x] Keep user/assistant/approved semantic landmarks in conversational order.
- [x] Render nesting only at real visible branch points; keep linear history flat.
- [x] Resolve every selectable projected row to an explicit canonical Entry target.
- [x] Preserve existing Branch Summary Carry / No Carry / Cancel controller semantics after target resolution.

## Compatibility, Recovery & Regression

- [x] Load existing v3 Sessions containing `message_update` without destructive migration.
- [x] Reconstruct legacy effective messages exactly enough to preserve previous conversation semantics.
- [x] Continue an old Session using only the new finalized-message write style.
- [x] Verify ToolUse navigation from terminal result creates the correct new branch and preserves siblings.
- [x] Verify an incomplete historical Tool request is not automatically replayed.
- [x] Verify Compaction, Branch Summary and Tool Result Working Set regressions remain green.
- [x] Keep Local Session Store schema and strict JSON-safety boundary unchanged.

## Documentation & Delivery Gate

- [x] Add ADR-0026 for finalized message persistence, ToolUse projection and semantic `/tree` navigation.
- [x] Add `SESSION-NAVIGATION-PROJECTION-DESIGN.md`.
- [x] Add `SESSION-NAVIGATION-PROJECTION-TEST.md`.
- [x] Add `SESSION-NAVIGATION-PROJECTION-DELIVERY.md`.
- [x] Add bounded implementation plan/tasks without claiming implementation is delivered.
- [x] Run focused Red -> Green slices in the documented order during implementation.
- [x] Run relevant Harness/CLI/Session Store suites, required typechecks/builds and `git diff --check`.
- [x] Update README/CONTEXT/PROJECT_ANALYSIS/CHANGELOG and delivery state only after verified implementation.
- [x] Preserve the pre-existing unrelated root `AGENTS.md` modification outside the implementation commit.

## Explicitly Out of Scope

- [ ] Usage/token-cost + Context Window observability — separate design unit.
- [ ] Provider pricing/model-capability redesign — separate design unit.
- [ ] Physical deletion/migration of historical `message_update` rows — separate migration decision.
- [ ] Runtime Store schema redesign / persisted partial-stream recovery.
- [ ] Parallel Tool execution and completion-order semantics.
- [ ] Stage 6.6 cloud sync / commercial entitlements.
- [ ] MCP / new Tool protocol work.
- [ ] Windows Native Sandbox.
- [ ] Unrelated UI redesign.

---

# Stage 6.5 Follow-up — Usage, Cost & Context Observability

**Status:** Approved design / implementation pending.

## Usage Authority

- [ ] Add Red regression for missing `usage/model.usage` Runtime Event support.
- [ ] Add strict normalized Provider Usage event with Run/Turn/Step/Provider/Model correlation.
- [ ] Preserve Provider-reported input total/no-cache/cache-read/cache-write and output total/text/reasoning buckets.
- [ ] Keep missing Provider fields unknown instead of coercing them to zero.
- [ ] Keep raw Provider payloads, prompts, messages, Tool content, commands/files, and secrets outside durable Usage payloads.
- [ ] Persist one effective Usage fact per completed Model Step.
- [ ] Fold identical duplicate `stepId` Usage once and fail integrity on incompatible duplicate Usage.
- [ ] Make Runtime Usage facts the only new durable Usage authority; do not add a Session Entry kind.
- [ ] Stop using legacy/current message metadata Usage as an aggregation source.

## Restart & Projection

- [ ] Add pure Session Usage projection with token/cache/cost coverage and integrity state.
- [ ] Add backward-compatible cumulative Usage state to Runtime snapshot/replay projection.
- [ ] Prove full replay == snapshot + tail replay.
- [ ] Prove Runtime Store restart restores Usage locally with zero Server/API URL dependency.
- [ ] Keep Runtime Store and Session Store SQLite schemas unchanged unless ADR-0027 is revised first.

## Pricing & Cost

- [ ] Replace flat pricing hints with versioned effective-time Pricing revisions.
- [ ] Support uncached input, cache-read, optional cache-write, and output rates.
- [ ] Persist the resolved pricing basis used by each priced Usage fact.
- [ ] Keep historical Session cost stable across later pricing-catalog changes.
- [ ] Do not implicitly price Custom OpenAI-compatible endpoints as OpenAI.
- [ ] Add deterministic Cost Engine with tested rounding.
- [ ] Do not double-charge reasoning tokens already included in output total.
- [ ] Make unknown required rates produce unavailable/partial Cost rather than guessed values.
- [ ] Aggregate Session Cost with explicit `complete | partial | none` coverage.

## Cache

- [ ] Define Cache hit as `sum(cacheRead) / sum(inputTotal)`.
- [ ] Distinguish explicit `cacheRead=0` from missing telemetry.
- [ ] Exclude cache-write and output tokens from hit numerator.
- [ ] Mark mixed incomplete cache telemetry partial/none; V1 StatusBar shows `Cache —` unless coverage is complete.

## Current Context

- [ ] Add pure Current Context observability projection that reuses canonical Context construction.
- [ ] Expose current input tokens, Context Window, input budget, reserved output, safety margin, utilization, counter ID, and estimated/exact quality.
- [ ] Prove Context observability matches the actual Model Step Context pipeline without making a Provider request.
- [ ] Recompute after Session open/restart, branch/history/Tool/Compaction/Branch Summary changes, model/mode changes, and Agent source/ToolSet reload.
- [ ] Keep Context estimates separate from Provider-reported Usage and Cost calculation.

## StatusBar UI

- [ ] Add one Session observability state seam combining Usage summary + Current Context summary.
- [ ] Keep all calculation/aggregation outside `status-bar.tsx`.
- [ ] Render `Ctx ~current/window · API ~$sessionCost · Cache hit%` beside current mode/model.
- [ ] Omit `~` only for exact Context counters.
- [ ] Render unknown Cost/Cache as `—`, not zero.
- [ ] Render real zero cache hit as `0%`.
- [ ] Keep formatting compact and deterministic without changing metric semantics.

## Failure, Compatibility & Delivery

- [ ] Prove Usage Runtime append failure after Provider completion never retries the Provider.
- [ ] Preserve already-received assistant result while surfacing incomplete observability state.
- [ ] Never reconstruct missing actual Usage from local Context estimates.
- [ ] Verify legacy Session message metadata cannot double-count Runtime Usage.
- [ ] Verify mixed Provider/model Session cost uses each Step's own pricing basis while current Context uses the currently selected model.
- [ ] Run all Red -> Green slices in `docs/USAGE-COST-CONTEXT-OBSERVABILITY-TEST.md`.
- [ ] Run full relevant Harness/CLI/Runtime Store regression suites, typechecks/builds, Prisma validation, and `git diff --check`.
- [ ] Update README/CONTEXT/PROJECT_ANALYSIS/CHANGELOG to Delivered only after all verification is green.
- [ ] Preserve pre-existing unrelated root `AGENTS.md` modification outside the Stage commit.

## Explicitly Deferred

- [ ] `/usage` dashboard/dialog and per-message Step Usage footer.
- [ ] Day/week/month/project/provider/model analytics and charts.
- [ ] Spend budgets/alerts and account quota/balance monitoring.
- [ ] Provider billing portal reconciliation or automatic online pricing updates.
- [ ] Exact tokenizers for every Provider/model family.
- [ ] Custom Provider pricing editor.
- [ ] Branch-scoped cost views.
- [ ] Usage cloud sync/commercial billing.
- [ ] Stage 6.6 Cloud Sync, Stage 6.7 Windows Sandbox, MCP/Subagent/OAuth, and unrelated UI work.

---

# Stage 6.6 — Cloud Session Sync & Commercial Entitlements

**Status:** Paused — requires explicit product re-approval after ADR-0024.

## Multi-device Session Sync

- [ ] Replace whole-state last-write-wins design with append-oriented Session Entry sync contracts.
- [ ] Add revision/cursor/idempotency semantics and ownership validation.
- [ ] Preserve concurrent branches created independently on two devices.
- [ ] Add Server persistence/migrations for the accepted sync protocol.
- [ ] Add client offline queue, retry, push/pull cursors, and duplicate-safe merge.
- [ ] Keep device UI/navigation/transient Runtime state out of cloud semantic sync by default.
- [ ] Add two-device/offline/reconnect/retry/conflict simulation coverage.

## Commercial Account Boundary

- [ ] Restrict Server commercial responsibilities to account/subscription/entitlement features plus optional sync/backup.
- [ ] Add locally cached bounded entitlement state for cloud-only product features.
- [ ] Ensure transient entitlement Server failure cannot disable local Provider/Model/Tool execution.
- [ ] Keep Provider credentials and direct provider usage outside MORE-MORE-CODE Server/billing proxy paths.
- [ ] Update Server/API/database docs and ADR-0023 delivery status.

---

# Stage 6.7 — Windows Native Sandbox

- [ ] Design and implement a Windows native ProcessSandbox provider using AppContainer/restricted-token/Job-object or an equivalently defensible isolation mechanism.
- [ ] Define explicit filesystem/network/process guarantees and fail-closed behavior.
- [ ] Add real Windows E2E isolation tests and Linux Bubblewrap E2E CI coverage.
- [ ] Keep direct fallback explicitly unisolated and preserve Stage 6.3 Permission/Approval/ToolRuntime/ProcessSandbox seam separation.
