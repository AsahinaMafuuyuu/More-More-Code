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
