# ADR-0024: Local-Only Session Authority and Railway Retirement

## Status

Accepted

## Date

2026-08-26

## Implementation Status

Delivered in the local CLI on 2026-08-26. The implementation now provides:

- a SQLite `LocalSessionStore` with embedded migrations, transactionally
  validated Session Tree topology, root/active metadata, stable append
  sequences, and idempotent commits;
- local `create`, `list`, `open/load`, `continue`, and archive flows with no
  Server, `API_URL`, Cloudflare Worker, Railway, or `/login` prerequisite;
- durable-first user/model/tool/automatic-compaction transitions, including
  fail-closed behavior before Provider/Tool side effects and restart recovery;
- local Provider connection probes with secret-safe diagnostics and persisted
  `/models` defaults; unsupported Codex OAuth is hidden because no supported
  documented model-execution broker exists;
- focused Store and CLI coverage for migrations, transactions, topology,
  idempotency, offline restart/continue, durable-first ordering, provider
  probes, and model-default persistence.

The final integrated review completed on 2026-08-26 with no residual P0/P1
finding. During that review, the production default Local Session ID path was
found to detach `crypto.randomUUID` from its `Crypto` receiver under Bun; the
runtime path was corrected and a real default-ID regression test now covers
new-session creation. The full Session Store, Runtime Store, Harness, and CLI
test matrices, package typechecks, CLI/Server builds, both Prisma schema
validations, local-only dependency checks, and `git diff --check` pass.

This delivery does not include an explicit transactional/idempotent import
command for legacy linear/v1/v2/v3 snapshots; that is a non-blocking follow-up
and does not reintroduce a cloud startup dependency. It also does not claim a
real external-provider end-to-end test or working Codex OAuth execution.

## Context

ADR-0023 established the local CLI as the target Session authority, but Stage 6.5 was not connected. The CLI still creates, lists, opens, and persists Sessions through the MORE-MORE-CODE Server. The public API edge currently forwards to a Railway application that no longer exists, so a local model Run cannot start even when the selected Provider, credential, Harness, Context, and network path are healthy.

Restoring Railway would repair the obsolete dependency without fixing the product architecture. The accepted product direction is now stricter: cloud features are disabled for the current local CLI, Railway is retired, and a Session must be durable locally before it is visible to the UI or allowed to trigger model or Tool side effects.

## Decision

### 1. LocalSessionStore is the only Session authority

The CLI uses one deep `LocalSessionStore` module for `create`, `load`, `list`, atomic `commit`, and `archive`. Its interface accepts and returns Harness Session Tree semantics rather than exposing SQL rows.

The Store owns these invariants:

- exactly one `session_start` root per Session;
- immutable Entry identity and same-Session parent topology;
- stable monotonic Entry ordering independent of wall-clock timestamps;
- idempotent replay of identical Entries and explicit conflict for different content under the same ID;
- one transaction for appended Entries, metadata, `activeEntryId`, and `updatedAt`;
- versioned, repeatable embedded migrations;
- validation before commit and after load.

Semantic Session data remains separate from the Runtime Store. The Session Store records conversation meaning, branches, Context checkpoints, model/mode/config changes, and device-local navigation state. The Runtime Store continues to record execution, security, approval, and recovery facts.

### 2. Session transitions are durable-first

Session creation commits the root Entry before navigation. User messages and every later semantic transition commit locally before React state exposes the new tree and before Provider or Tool execution begins.

A local durability failure fails closed for the pending transition: the next model call or Tool side effect does not start. Provider failures may append a durable error Entry, but they never roll back already-committed user intent.

### 3. Cloud and Railway leave the local critical path

The Cloudflare Railway proxy, its root scripts/dependency, and Railway deployment documentation are removed. `API_URL`, Clerk login, cloud Session routes, billing, and PostgreSQL packages may remain as dormant future-cloud code, but the local CLI must not import or call them for startup, authentication, Session lifecycle, model execution, Context, cache, or Tool execution.

`/login` and `/logout` are removed from the local CLI while cloud accounts are disabled. A future cloud product must re-enter through a separate, explicitly optional sync/account module and a new delivery decision; it cannot become the Session authority again.

This decision supersedes ADR-0001 and the transitional cloud-authority portions of ADR-0003 and ADR-0016. It narrows ADR-0023 by disabling, rather than merely optionalizing, cloud integration in the current CLI release.

### 4. Provider traffic is direct and locally configured

`/providers` remains the configuration interface for Provider definitions and credentials. Raw API keys remain in `CredentialStore`, never in Session data, Provider Registry JSON, Runtime Events, logs, or subprocess environments. `/models` selects a configured `{ providerId, modelId }`, and the selected default must survive restart through local Agent configuration.

The Harness compiles Context and owns cache/checkpoint semantics. `LocalModelTransport` resolves the selected local Provider and sends requests directly to that Provider endpoint. No MORE-MORE-CODE Server proxies model traffic.

Custom Provider V1 remains OpenAI Chat Completions compatible. Its connection test must display the resolved request URL without secrets and distinguish configuration, credential, protocol, HTTP, and model errors.

### 5. Codex OAuth is capability-gated

Official OpenAI documentation supports ChatGPT sign-in for Codex clients, but it does not define cached Codex OAuth tokens as a generic bearer contract for third-party AI SDK model calls. MORE-MORE-CODE therefore does not read or copy `~/.codex/auth.json`, scrape private tokens, or send undocumented bearer tokens to model endpoints.

The `codex-oauth` option is visible only when a supported broker can provide a documented model-execution contract while preserving MORE-MORE-CODE's Harness authority. Until then, the unavailable option is hidden and OpenAI remains usable through an API key. Integrating Codex as an external Agent backend is a different architecture and is not an acceptable substitute for a model Provider in this stage.

### 6. Legacy import is explicit and idempotent

Legacy linear/v1/v2/v3 snapshots may be imported into the local Store through an explicit import path. Import uses a source fingerprint/journal and deterministic identity for legacy records that lack stable Entry IDs. It runs in one transaction, can be safely repeated, and never fetches cloud state during local startup or Session open.

## Alternatives Considered

### Restore Railway first

- Pros: smallest operational change.
- Cons: preserves the failure-prone cloud prerequisite and whole-tree snapshot authority.
- Rejected: fixes the outage, not the architecture.

### Reuse Runtime Store for semantic Sessions

- Pros: one SQLite database and migration system.
- Cons: mixes user-visible append-only conversation meaning with execution/security/recovery facts and couples their retention and evolution.
- Rejected.

### Reuse Codex cached OAuth tokens in the AI SDK

- Pros: superficially enables subscription-backed OpenAI usage.
- Cons: relies on an undocumented third-party bearer contract, duplicates secret ownership, and may break workspace/security semantics.
- Rejected.

## Consequences

- The CLI works without `API_URL`, Clerk, PostgreSQL, Cloudflare, or Railway.
- New, list, open, continue, branch, Context compaction, and restart recovery depend only on local stores plus the selected Provider.
- Local persistence errors become visible blocking errors instead of best-effort console logs.
- Railway-specific Worker code, scripts, dependency, and documentation are deleted; cloud Server code is not part of the local build/runtime contract.
- Codex OAuth is not claimed until a supported broker exists; the UI cannot advertise an unavailable authentication method.
- Stage 6.6 cloud synchronization is paused and must be explicitly re-approved before implementation.
