# Domain Glossary

## Session

A durable local history of one agent conversation/workflow, owned by the Local Session Store and including conversational content, semantic runtime events, state changes, context-control events, and branches. Cloud synchronization is not part of the current CLI path.

## Session Entry

One durable semantic fact in a Session. A Session Entry is the atomic node of Session history. Messages are one kind of Session Entry; model changes, tool calls/results, errors, compaction, and custom events are also Session Entries.

## Session Entry Tree

The append-only, branchable history formed by Session Entries and their parent relationships. Existing Entries are immutable; new Entries are appended as children of the current Active Entry. Selecting an earlier Entry chooses one historical branch and continuation point without deleting sibling futures.

## Active Entry

The current device-local continuation cursor of a Session Entry Tree. New durable Session facts become descendants of the Active Entry; it is not a cloud synchronization field in the current CLI.

## Branch

One root-to-entry history path through a Session Entry Tree. Branches may share an unchanged historical prefix and diverge after any earlier Entry.

## Message Projection

The conversational message history derived from a Session branch. It replays legacy `message_update` Entries for backward compatibility and joins canonical `tool_call` / `tool_result` facts into the terminal Tool state required by UI/provider consumers without mutating source Entries. Non-message Session Entries remain part of Session history even when they are absent from this projection.

## Finalized Assistant Model Step

One immutable durable `assistant_message` representing a completed AgentLoop Model Step. The process-local Chat Runtime may keep an aggregate assistant message across Tool continuation, so runtime/UI identity is not the durable Session identity. The CLI derives the durable assistant id from `stepId` and, when `step-start` markers are present, persists only the parts after the latest marker. A later Tool-continuation Model Step therefore appends a new assistant Entry instead of revising the earlier Tool-calling Entry.

## Navigation Tree Projection

The human-facing semantic navigation view derived from the canonical Session Entry Tree. It folds legacy `message_update` and default bookkeeping Entries, contracts hidden nodes without losing true branch topology, keeps ordinary single-child visible history flat, and exposes explicit canonical navigation targets for selectable rows.

## ToolUse Projection

A CLI presentation projection for one Tool call. Canonical active-branch `tool_call` / `tool_result` facts remain the terminal authority, while the current process-local Chat Runtime Tool part, Approval request and Agent Activity Tool Step may supply transient pre-terminal state. Canonical terminal status always wins; historical `approval_required`, missing terminals and integrity mismatches fail closed as explicit incomplete diagnostics. `ToolUse` is never persisted as a Session Entry or Runtime Event. Session Navigation uses the same canonical call/result identity to expose one semantic ToolUse row whose terminal navigation target is the `tool_result` Entry.

## Agent Activity Projection

The CLI-owned, presentation-ready view over the current Harness `AgentRun -> AgentTurn -> AgentStep` lifecycle. It exposes Run/Turn/Step status, Turn cause, Model/Tool Step identity, active Step and bounded timing/progress information without exposing Provider prompts, Provider payloads, Tool input/output or raw Harness traversal to React. Existing ephemeral `step_update` events are retained process-locally for the current Run only; UI elapsed time uses a process-local clock. Agent Activity creates no Session Entry, Runtime Event or persistence schema.

## Durable Message Normalization

The CLI-owned semantic boundary between project-owned runtime/UI `Message` objects and durable Session history. Runtime object properties whose value is `undefined` are omitted, array `undefined` values and sparse holes become explicit `null`, and valid JSON-safe Provider metadata is preserved. Unsupported values such as non-finite numbers, bigint, functions, symbols/symbol-keyed properties, cycles, and non-plain objects remain fail-closed. Durable user turns and finalized assistant Model Steps share this policy before Harness constructs Session Entries; Tool terminal output is sourced from canonical `tool_result` through Message Projection rather than a new message revision. Harness stays provider-independent and `LocalSessionStore` remains the strict final JSON integrity validator.

## Runtime State Projection

The effective agent/model configuration derived from state-changing Session Entries on a branch, such as model, mode, or other configuration changes.

## Context Projection

The bounded, provider-independent input view selected for a particular model invocation. Canonical Context is compiled from stable to dynamic content so model-visible prefixes remain reusable; projection may summarize or omit old history for model limits without deleting the underlying Session history.

## Context Stability

A provider-independent classification of Context Records as stable, checkpoint, history, retained, or dynamic. It controls canonical ordering but does not encode provider-specific cache fields.

## Tool Result Working Set

The bounded model-facing projection of Tool Results created before historical Context Compaction. Complete Tool Result payloads remain durable Session facts; only cloned model input may use `full`, `truncated`, `summary`, or `reference` representations. The individual full-result threshold and aggregate working-set signal are derived from the effective model input budget. To preserve provider prompt-cache prefixes, an individually oversized Tool Result receives its deterministic bounded representation on first model exposure and that representation does not change merely because the result becomes warm/cold or newer Tool Results arrive. Aggregate pressure is reported and handed to normal Context/Compaction policy instead of dynamically rewriting older Tool payloads.

## Tool Result Projection

A bounded representation of one Tool Result for model input. It retains Tool Call identity/status, a pruning reason, original/projected token estimates, and internal durable-source metadata when available. Model-visible bounded envelopes use the stable Tool Call identity so a later Session-entry lookup cannot mutate an already-sent prefix. Shell, test/build, search/grep, file-read, and generic outputs use deterministic strategy-aware projections rather than one universal slice.

## Compaction Entry

A durable record that a context compaction occurred, including the replacement snapshot, trigger reason, token-budget diagnostics, represented history range, content-addressed Compaction Plan identity, and optional structured Checkpoint V2. The latest Compaction Entry on the active branch acts as the persisted Context checkpoint for later Model Steps. A newer checkpoint reduces the previous effective checkpoint plus newly compacted history into one complete replacement snapshot; older checkpoints remain Session history but are superseded for model Context Projection. Provider execution after a new checkpoint is transactional: reduce/validate first, commit through Local Session authority, re-read and verify the accepted checkpoint/digest/membership, then compile the Provider request from rehydrated durable state.

## Compaction Checkpoint V2

The machine-verifiable replacement state stored by new Compaction Entries. V2 contains structured goal/state/decision/constraint/artifact/failure/pending-work facts, source/provenance identities, Required Context Anchor coverage, content-addressed checkpoint identity, validation quality and deterministic rendered summary. Semantic reducer output cannot become durable solely because it fits the token budget: provenance and anchors are validated, P0 state must survive, and invalid output enters priority-aware deterministic fallback or aborts explicitly. Arbitrary `[summary truncated]` text is not a valid durable V2 fallback.

## Required Context Anchor

A source-derived state item that compaction is required to preserve according to priority (`P0` through `P3`). P0 covers state such as hard constraints and critical pending work that cannot be silently dropped. A V2 candidate records required/covered anchor IDs; missing P0 coverage prevents acceptance. Repeated compaction carries still-valid anchored checkpoint state forward rather than treating the previous summary as unverifiable prose.

## Semantic Context Snapshot

The state-oriented payload stored by a Compaction Entry. It represents current goal/state, decisions, constraints, artifacts, failures/lessons, and pending work rather than a chronological transcript. New snapshots preserve still-valid facts, remove superseded facts, and replace the previous snapshot as the effective checkpoint.

## Compaction Policy

The provider-independent Context policy that decides when and how much history to compact. The default application policy uses an 80% soft limit, 92% hard limit, and 70% post-compaction target over the effective input budget, plus profile-owned recent-raw-tail and checkpoint budgets. Automatic source selection works backward over complete Model Cycle semantic groups, first preserves the configured recent raw token floor/ratio when feasible, then keeps additional newest complete groups while still reaching the post-compaction target. Tool-pressure is a distinct trigger and compacts only enough oldest complete history to relieve its measured excess; one pathological oversized semantic group may use the guarded split-group escape hatch, but a Tool Call/Result interaction is never intentionally split. Automatic triggers are `soft-limit`, `hard-limit`, `overflow`, or `tool-pressure`; `/compact` uses `manual`, which bypasses automatic utilization thresholds but still preserves the recent raw tail and first passes deterministic eligibility gates. Repeat eligibility is checkpoint-progress based rather than time based.

## Branch Summary

A bounded knowledge-transfer record created only when navigation would otherwise drop meaningful source-only branch knowledge and policy/user choice requests Carry. Navigation analysis compares source/target Session paths, computes their LCA, excludes runtime-only state Entries, and deduplicates already-covered Entry IDs. The summary is plain semantic text with structured provenance (`sourceTipEntryId`, `targetEntryId`, `commonAncestorEntryId`, `coveredEntryIds`); older summary-only Entries remain valid. `ask` is the default `branchSummaryOnJump` policy, with `always` and `never` alternatives. Cancel mutates nothing, No Carry performs only navigation, and Carry jumps to the target before appending exactly one `branch_summary` child. Branch Summary is historical canonical Context rather than a fake chat Message or Compaction checkpoint; sufficiently old summaries may later be absorbed by normal Compaction without deleting their Session Entries or being duplicated after checkpoint reuse.

## ToolSet Fingerprint

A deterministic identity of the model-visible Tool contracts for one mode, derived from tool name, source, description, input schema, and mode availability. PLAN and BUILD therefore form different cache families when their Tool Sets differ.

## Prompt Prefix Fingerprint

A deterministic identity of the stable model prefix, derived from provider/model/mode, system prompt version, global/project instruction hashes, Skill catalog hash, and ToolSet fingerprint. Provider adapters may derive provider-specific cache keys from it.

## Cache Family ID

The permanent logical identity of Provider-visible stable cache inputs such as provider/model/mode, system/instruction/skill prefix and Tool Set. It answers whether two requests are eligible to belong to the same prompt-cache family; it does not claim that their rendered conversation bytes are identical.

## Context Epoch ID

The branch/checkpoint-local cache epoch identity. Inside one epoch, already Provider-visible history must grow append-only. Accepting a new compaction checkpoint intentionally creates a new epoch/rebase; that expected transition is distinguished from an unexplained mutation inside the same epoch.

## Rendered Prefix Digest

A bounded SHA-256-style identity computed at the actual Provider wire-serialization boundary over the rendered cache-relevant prefix. It is diagnostic metadata rather than Session authority. Combined with Cache Family ID and Context Epoch ID it classifies cache hits, family changes, expected epoch rebases, unexpected same-epoch prefix mutation, Provider cache misses and insufficient telemetry without persisting the full prompt.

## Provider Runtime

The project-owned boundary that translates canonical model input and prefix identity into provider-specific wire requests, stream events, cache controls and diagnostics. Model execution uses native `fetch()` plus project-owned SSE parsing rather than Vercel AI SDK. Built-in protocols are OpenAI Responses, Anthropic Messages, DeepSeek Chat Completions and native Google Generative AI; Custom V1 remains OpenAI-compatible Chat Completions. Provider-specific behavior belongs here rather than in Session or Context semantics. A bounded credential-free stable-prefix compilation cache is keyed by provider/model/protocol plus `PromptPrefixFingerprint` and `ToolSetFingerprint`; it stores only immutable system/tool material and never dynamic conversation history or credentials.

## Provider Registry

The Stage 6.4 user-global catalog of configured model providers, persisted as strict versioned `~/.more-more-code/providers.json`. Provider identity (`ProviderId`) is separate from implementation kind (`openai | anthropic | google | deepseek | custom`) so multiple custom endpoints can coexist. The built-in provider set is OpenAI, Anthropic, Google, and DeepSeek; Mistral is intentionally removed. Custom Provider V1 is limited to OpenAI-compatible endpoints. The Registry resolves non-secret provider configuration and model references but does not own raw credentials.

## Model Reference

A provider-independent selection value shaped as `{ providerId, modelId }`. Built-in/recommended model catalogs are UX defaults rather than the canonical allowlist. Session and Context semantics may persist/reference a Model Reference without requiring every possible provider model ID to exist in a compile-time TypeScript union.

## Provider Authentication Strategy

The provider-specific credential acquisition seam used by Provider Runtime. The local CLI supports an OpenAI API key, API keys for Anthropic/Google/DeepSeek, and API key/Bearer/None for custom OpenAI-compatible endpoints. Codex OAuth is modeled as a capability-gated seam but is currently unavailable and hidden because no supported documented broker can provide native model execution. Anthropic OAuth is explicitly outside the initial design; Google OAuth and other provider login mechanisms require later research. Codex OAuth must not be implemented by scraping private token files or assuming undocumented tokens are stable generic OpenAI API credentials.

## Credential Store

The local secret-storage deep module referenced by Provider configuration. `providers.json` contains credential references rather than plaintext API keys, while project config contains only model selection (`providerId/modelId`). Stage 6.4 ships an AES-256-GCM encrypted local-file adapter plus read-only environment-variable compatibility behind one `CredentialStore` interface; the encrypted-file adapter prevents plaintext config/serialization but is not claimed to provide the same trust boundary as an OS-native keychain. A future Windows Credential Manager/macOS Keychain/Secret Service adapter can replace it without changing Provider Runtime. Provider secrets are never cloud-synchronized by the MORE-MORE-CODE Server.

## Execution Event

A runtime lifecycle fact about Run, Turn, or Step execution. Execution Events describe how the runtime executed; Session Entries describe the durable semantic history of the Session. They are related but distinct histories.

## Runtime Event

A JSON-safe, append-only local fact in one of the `execution`, `tool`, `security`, `context`, `usage`, or `system` categories. Runtime Events use a SQLite-assigned global offset as their durable replay cursor and are always queried within an explicit Session scope. Execution/tool/context/system payloads use strict schema v1 allowlists; `usage/model.usage` v1 stores normalized Provider token buckets plus Run/Turn/Step/provider/model correlation and the resolved pricing/cost basis, never raw Provider payloads. Security payload v2 records permission `requested` / `decided`; security payload v3 records approval `requested | resolved | cancelled | timed_out`, while v1 decision compatibility remains readable. Approval v3 contains only approval ID, redacted ask requirements (`capability/resourceKind/scope`), and correlation IDs; raw command/path/resource values remain process-local. Unknown fields are rejected. Prompts, messages, Tool input/output, raw commands/paths/file content, policy reasons, and arbitrary error text are excluded. An Execution Event may be persisted inside an `execution` Runtime Event envelope, but its per-Run sequence and the durable database offset have different meanings.

## Session Usage Projection

A session-scoped derived projection over durable `usage/model.usage` Runtime Events. One `stepId` contributes at most one effective Usage fact: byte-for-byte/semantic duplicates fold once, conflicting duplicates invalidate integrity without double charging. Input/output/cache buckets preserve Provider-reported unknown-vs-zero semantics, and snapshot+tail replay produces the same projection as full replay. This projection is Runtime telemetry, not a Session Entry or message-metadata aggregate.

## Session Observability

The CLI-owned immutable UI projection that combines Session Usage/Cost/Cache with Current Context Usage. Current Context reuses the canonical Context construction, pruning/compaction budget and active model profile and may be `estimated | exact`; API Usage remains Provider-reported; Cost is calculated from each Step's persisted pricing basis; Cache is based on Provider-reported cache-read/input coverage. React/OpenTUI formats these values but does not calculate or persist them.

## Security Audit Projection

A derived, session-scoped Harness view over persisted Runtime Events. Schema-v2 permission request/decision facts and schema-v3 approval transactions are correlated with Tool terminals; schema-v1 decisions remain explicit `legacy` entries. Replay verifies lifecycle/enforcement consistency rather than recomputing the original Permission Policy: raw command/path/resource values are intentionally absent from durable events. For interactive histories, an `ask` capability set may proceed only after one matching Tool-call approval resolves `allow`; approval deny/cancel/timeout must reconcile with `denied/cancelled/timed_out` Tool terminals. The audit timeline is rebuilt from the append-only event stream and is not copied into RuntimeSession snapshots.

## Runtime Snapshot

A session-scoped checkpoint of a Runtime projection at a specific durable event offset. Recovery loads the latest snapshot and applies later Runtime Events through an explicit reducer. Snapshots optimize replay; they do not become a second Session history authority and do not authorize automatic repetition of incomplete external work.

## Cloud Session Store

The dormant PostgreSQL persistence boundary implemented by `packages/database` and consumed by `packages/server`. It is not the Session authority of the local CLI and is not opened or called by local startup, Session lifecycle, Provider, Context, cache, or Tool execution. A future Stage 6.6 product may evolve it into optional multi-device synchronization/backup over locally authoritative Sessions instead of whole-tree last-write-wins ownership; Stage 6.6 is currently paused.

## Local Session Store

The implemented Stage 6.5 semantic Session authority, backed by the local SQLite `packages/session-store` package (default `~/.more-more-code/sessions/sessions.db`). It owns `create`, `load/open`, `list`, atomic `commit`, and `archive`; validates Session Tree topology; persists root/active Entry identity, metadata, stable append sequence, migrations, and idempotency; and commits semantic transitions before UI exposure or Provider/Tool side effects. It is intentionally separate from the Local Runtime Store: Session Entries are durable conversation semantics and branch topology, while Runtime Events are execution/security/recovery facts. Explicit transactional/idempotent import of legacy linear/v1/v2/v3 snapshots remains a non-blocking follow-up.

## Cloud Session Sync

The paused, future optional synchronization module between the Local Session Store and MORE-MORE-CODE Cloud. Its target protocol is append-oriented, idempotent, and revision/cursor-aware so independent device branches can coexist. Semantic Session Entries and shareable metadata may sync; device-local navigation/presentation state such as `activeEntryId`, expanded nodes, and scroll position remains local by default. It is not part of the current local CLI critical path and requires explicit Stage 6.6 product re-approval.

## Cloud Entitlement

The future optional account/subscription capability record returned by MORE-MORE-CODE Cloud for commercial features such as multi-device synchronization or backup. Entitlements are disabled in the current local CLI; if reintroduced, they may be cached locally but must not become a per-Model-Step authorization dependency for the core local Agent Runtime.

## Local Runtime Store

The independent SQLite persistence boundary implemented by `packages/runtime-store`. It owns Runtime Event and Runtime Snapshot schema/client/migrations. The CLI defaults to `~/.more-more-code/runtime/runtime.db`, permits an absolute `file:` URL override through `RUNTIME_STORE_DATABASE_URL`, and applies embedded versioned migrations without Prisma CLI at application startup. Its Prisma datasource is intentionally separate from the Cloud Session Store so local recovery changes cannot migrate or remove cloud Session models.

## Runtime Session

The deep, session-scoped adapter between AgentLoop and the Local Runtime Store. It implements `ExecutionEventStore`, serializes same-Session append/reduce/cache/snapshot operations, performs awaited write-ahead appends, reduces durable events into the open-Run/pending-Context recovery projection, applies Snapshot Policy, and warms Projection Cache. A critical append failure is fail-closed and never falls back to an in-memory execution path. Snapshot persistence is derived acceleration: failure does not invalidate an already committed event, records transient failure-count/timing diagnostics, retries with bounded backoff, and cannot regress the durable projection. Startup recovery reports incomplete external work but does not execute it.

## Agent Environment

The resolved process-local coding-agent environment created before Session execution. It combines global/project configuration, the ordered Instruction Chain, the Skill Registry, and Tool Registry sources. It is execution context, not Session history.

## Instruction Chain

The ordered instructions loaded from `~/.more-more-code/AGENTS.md` and `<workspace>/.more-more-code/AGENTS.md`. Project instructions are more specific than global instructions and are composed into the model system prompt.

## Skill

A reusable workflow/instruction package stored as `.more-more-code/skills/<name>/SKILL.md`. Skills are not executable tools. Bootstrap loads only descriptor metadata; the full skill body is loaded on demand through `loadSkill`.

## Tool Source

The origin of executable tool capabilities. `native` is the built-in default source; `mcp` represents externally configured Model Context Protocol extension sources. MCP transport execution is not implemented yet.

## Tool Runtime

The local boundary between AgentLoop Tool Steps and concrete Tool Sources. It applies Tool Registry visibility/capabilities, permission decisions, interactive approval, timeout/cancellation propagation, source selection, and normalized status/timing outcomes. Construction requires both an explicit `PermissionPolicy` and `ApprovalBroker`; there is no implicit allow-all or implicit human approval fallback. Tool Runtime evaluates every capability before prompting, suppresses approval if any capability denies, batches all asks into one Tool-call transaction, and resumes the same Tool Step only after a durable one-time allow. AgentLoop owns lifecycle orchestration; Tool Runtime owns these execution concerns.

## Tool Capability

A semantic capability label attached to a registered Tool, such as `filesystem.read`, `filesystem.write`, `process.execute`, or `agent.skill.read`. Capability metadata is intended for policy evaluation and is distinct from the model-facing input schema.

## Permission Policy

The provider-independent Harness module that decides `allow | deny | ask` for one Tool capability and its ephemeral typed resource. Resource kinds are `path | command | resource`; scopes are `workspace | outside-workspace | agent-config | external`. Code defaults are evaluated first, followed by persisted global then project rules, with the last matching ordinary rule winning; a final non-overridable workspace-containment rule keeps policy aligned with native filesystem execution. Path globs are segment-aware and use platform path casing. Tool Registry and native file execution share a canonical resolver that follows existing symlinks/junctions and canonicalizes the nearest existing ancestor for create targets. Permission Policy does not perform human interaction; `ask` is handed to the Approval Broker only after all capability decisions are known.

## Approval Broker

The provider-independent Harness seam for one-time human authorization of a Tool Call whose effective Permission Policy contains one or more `ask` decisions and no deny. The process-local CLI adapter exposes pending transactions to the terminal UI and resolves only `allow | deny`; it never mutates permission config. Raw command/path/resource values exist only in the ephemeral `ApprovalRequest` shown to the human. Tool Runtime owns approval timeout and Run-signal cancellation, and durable approval-request/terminal observations must complete before broker waiting or executor invocation proceeds.

## Process Sandbox

The CLI deep module below native process-backed Tools. It is distinct from Permission Policy and Approval Broker: authorization/approval decide whether a Tool may execute; `ProcessSandbox` constrains how an authorized child process is launched. Every native subprocess crosses this seam, which owns provider discovery, launch planning, safe environment projection, writable `workspaceRoot`/`cwd` containment, and the only CLI `Bun.spawn` call. Resolved configuration is layered global -> project with `mode=off|auto|required`, `network=inherit|deny`, `environment=inherit|safe`, and exact-name `envAllow`. `required` and an unenforceable `network=deny` fail before spawn. `safe` excludes ambient provider/API credentials unless explicitly allowlisted. Linux can use Bubblewrap for read-only host root + writable workspace, masked home/private temp, process namespaces, and optional network isolation; unsupported hosts use an explicitly unisolated direct adapter only when policy allows fallback. Windows does not yet have a native OS-isolation adapter, so direct fallback is never represented as a Sandbox guarantee.
