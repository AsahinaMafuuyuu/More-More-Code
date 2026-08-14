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
