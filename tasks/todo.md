# Stage 5 — Context & Provider Runtime

- [x] Define canonical Context Record categories and stability classes
- [x] Implement deterministic stable-to-dynamic Context Compiler ordering
- [x] Add deterministic `ToolSetSnapshot` and `ToolSetFingerprint`
- [x] Add deterministic `PromptPrefixFingerprint`
- [x] Reuse persisted compaction checkpoints across later Model Steps
- [x] Introduce provider-independent Provider Adapter / Compiler boundary
- [x] Implement `OpenAIResponsesAdapter` with Vercel AI SDK + `@ai-sdk/openai`
- [x] Keep OpenAI `previous_response_id` outside canonical Session authority
- [x] Record provider/cache telemetry without polluting semantic Session history
- [x] Add focused tests for ordering, fingerprints, checkpoint reuse, and provider compilation
- [x] Run Harness + CLI tests
- [x] Run CLI / Harness / Server typechecks
- [x] Run CLI / Server builds
- [x] Verify Session Tree and AgentLoop behavior remains unchanged
- [x] Update ADR/current-state documentation when Stage 5 implementation lands

## Deferred

- [ ] MCP Runtime
- [ ] Permission Engine
- [ ] Sandbox
- [ ] Tool cancellation
- [ ] Local WAL / Crash Recovery
- [ ] Cloud revision/conflict sync
- [ ] Subagent Runtime
- [ ] OpenAI server-side conversation as Session authority
