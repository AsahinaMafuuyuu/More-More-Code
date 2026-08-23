# Stage 5.1 + Stage 6 — Session Semantics & Tool Runtime

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

- [ ] Add layered `sandbox.mode/network/environment/envAllow` Agent Config with deterministic global -> project merge semantics.
- [ ] Add a deep `ProcessSandbox` module for provider discovery, status, environment projection, launch policy, and child-process creation.
- [ ] Verify `required` fails before spawn and `auto` cannot silently drop explicit hard network isolation.

## Phase 2: OS Adapter & Native Tool Integration

- [ ] Add safe child-process environment projection that excludes ambient provider/API credentials unless explicitly allowlisted.
- [ ] Add Linux Bubblewrap launch-plan support for read-only host root, read-write workspace, private temp/home, namespace isolation, and optional network denial.
- [ ] Route native `bash` and `grep` through `ProcessSandbox`; remove direct subprocess creation from `local-tools.ts`.
- [ ] Preserve Bash descendant cancellation, grep semantics, timeout propagation, and bounded output.

## Phase 3: Documentation, Security Review & Delivery

- [ ] Add ADR-0022 and update README, CONTEXT, PROJECT_ANALYSIS, CHANGELOG, current-state docs, and project Agent configuration.
- [ ] Run focused/full CLI and Harness tests plus package typechecks/builds and Prisma validation/generation.
- [ ] Review fail-open paths and platform capability claims; close with no residual P0/P1 finding.
- [ ] Commit Stage 6.3 on `stage/6.3-sandbox-execution-foundation` with a clean working tree.

## Explicitly Deferred from Stage 6.3

- [ ] Windows AppContainer/restricted-token/Job-object and equivalent macOS native sandbox adapters.
- [ ] Full cross-platform host-read confidentiality isolation.
- [ ] Allow-for-session / allow-for-project persistent approval rules.
- [ ] Shell-AST-aware command authorization.
- [ ] MCP transport/auth/remote Tool execution and sandboxing.
- [ ] Cloud synchronization of approval/runtime events.
