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
- [ ] Interactive permission approval UI
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
- [ ] Branch Summary semantic transfer implementation
- [ ] Exact tokenizer support for every provider/model family

---

# Stage 5.4 — Branch Knowledge Transfer & Lazy Branch Summary

**Status:** Planned — implementation not started.

### Navigation Delta & Provenance

- [ ] Add pure Session Tree source/target path comparison and LCA calculation
- [ ] Treat target-path containment of the current source path as no information-loss navigation
- [ ] Extract only source-only Entries after the LCA for ancestor/cross-branch navigation
- [ ] Filter Branch Summary candidates to semantic Entries; ignore `session_start`, `model_change`, `mode_change`, and `config_change` by default
- [ ] Keep `user_message`, `assistant_message`, relevant message updates, tool call/results, errors, compaction, branch summaries, and supported semantic custom Entries eligible
- [ ] Add structured transfer metadata with `sourceTipEntryId`, `targetEntryId`, `commonAncestorEntryId`, and exact `coveredEntryIds`
- [ ] Deduplicate repeated transfers by subtracting Entry IDs already covered by prior relevant Branch Summary transfers
- [ ] Allow prior Branch Summary Entries to participate as transferable semantic knowledge

### Branch Summary Reduction

- [ ] Keep `summary` itself as bounded plain text; keep provenance/coverage as structured Session metadata
- [ ] Add a Branch Summary reducer contract separate from Context Compaction semantics
- [ ] Use stable text sections for key findings, decisions, artifacts, failures/lessons, and pending work
- [ ] Cap Branch Summary output at `min(4096 tokens, 4% effective input budget)`
- [ ] Do not add a Compaction-style gain-ratio gate; meaningful knowledge preservation is sufficient reason to transfer
- [ ] Run Tool Result Working Set/pruning before Branch Summary reduction when source delta contains large Tool Results
- [ ] Add deterministic fallback for reducer failure
- [ ] Append nothing when both semantic and deterministic reduction cannot produce valid non-empty summary text

### Lazy Navigation Transfer

- [ ] Add `branchSummaryOnJump = ask | always | never` with `ask` as the default
- [ ] Route `/tree`, `/jump`, parent/root, and equivalent navigation through one navigation/transfer controller
- [ ] Do not ask when target Context already contains the source path or source-only semantic delta is empty
- [ ] `Cancel`: keep the original source active and append nothing
- [ ] `No Carry`: jump only; append nothing and do not create a branch until a later real Session mutation
- [ ] `Carry`: jump to target, generate transfer, append exactly one `branch_summary` child, and make it active
- [ ] If Carry reduction fails completely, leave the target active and append no invalid/empty Branch Summary
- [ ] Verify ordinary browsing never creates durable Session branches

### Context & Compaction Interop

- [ ] Project active-path Branch Summary text into canonical historical Context without creating fake chat messages
- [ ] Keep UI Message Projection unchanged
- [ ] Preserve stable provider-independent Context ordering
- [ ] Allow sufficiently old Branch Summary records to participate in normal historical Compaction
- [ ] Ensure absorbed Branch Summary knowledge is not duplicated after checkpoint reuse
- [ ] Preserve append-only source Branch Summary Entries after Compaction

### Tests, UX & Delivery

- [ ] Add Harness tests for descendant, ancestor, sibling, cross-branch, and root navigation analysis
- [ ] Add tests for state-only delta, incremental coverage, prior-summary propagation, and non-contiguous coverage
- [ ] Add reducer/fallback/oversized-Tool-Result tests
- [ ] Add CLI tests for `ask | always | never`, Carry / No Carry / Cancel, and lazy branch creation
- [ ] Add Branch Summary -> Compaction -> restore regression coverage
- [ ] Add/update ADR for Branch Knowledge Transfer and lazy navigation semantics
- [ ] Update README / CONTEXT / PROJECT_ANALYSIS / CHANGELOG / command/settings documentation
- [ ] Run full tests, Shared/Harness/CLI/Server typechecks, CLI/Server builds, and `git diff --check`
- [ ] Verify backward compatibility with existing `branch_summary` Entries that contain only `summary`

### Deferred from Stage 5.4

- [ ] Automatic semantic branch merge/conflict resolution
- [ ] Branch ranking or relevance search across unrelated branches
- [ ] LLM relevance scoring over arbitrary branch history
- [ ] In-place editing/rewriting of existing Branch Summary Entries
- [ ] Dedicated branch IDs instead of path-derived branches
- [ ] Cloud collaborative branch merge semantics
