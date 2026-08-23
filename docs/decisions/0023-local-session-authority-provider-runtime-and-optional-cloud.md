# ADR-0023: Local Session Authority, Provider Runtime, and Optional Cloud

## Status

Accepted

## Date

2026-08-23

## Implementation Status

Stage 6.4 (Provider Runtime & Local Model Configuration) was delivered on 2026-08-23:

- `ProviderId` / `ProviderKind` and canonical `{ providerId, modelId }` `ModelRef` are implemented;
- the user-global strict Provider Registry is persisted at `~/.more-more-code/providers.json` with exactly four built-in provider kinds plus multiple custom OpenAI-compatible provider IDs;
- raw API-key/Bearer values are separated behind `CredentialStore`; the initial adapter is an AES-256-GCM encrypted local file with read-only environment-variable compatibility;
- OpenAI, Anthropic, Google, DeepSeek, and Custom OpenAI-compatible model adapters resolve through Registry/Auth state;
- `/providers` manages provider definitions/auth state and `/models` lists configured model references dynamically;
- OpenAI Codex OAuth is represented by an experimental broker seam but remains explicitly unavailable until a supported native provider-execution contract exists; no private Codex token files are read or copied.

The broader ADR remains only partially implemented: Local Session authority is Stage 6.5, optional cloud sync/commercial separation is Stage 6.6, and therefore the Cloud Session Store remains transitional today.

## Context

ADR-0003 moved model/tool execution out of the Server and into the local CLI, but the current application still depends on the Server for Session creation, listing, retrieval, and whole-tree snapshot persistence. Provider selection is also still represented by a hard-coded model catalog plus a provider switch, and credentials are primarily discovered through ambient environment variables.

That shape no longer matches the product direction. MORE-MORE-CODE is intended to be a complete local-first coding agent whose core runtime remains usable without a MORE-MORE-CODE account or cloud connection. The cloud product is still valuable, but for two narrower capabilities: commercial account/subscription entitlements and multi-device Session synchronization.

The provider layer also needs to support user-owned credentials and endpoints without routing model traffic through the MORE-MORE-CODE Server. The initial provider surface should stay intentionally small while leaving one extensibility path for OpenAI-compatible endpoints.

OpenAI Codex/ChatGPT OAuth is a distinct authentication mechanism from an ordinary API key. It must be represented behind an authentication seam and must not be implemented by copying private token files or assuming that a Codex OAuth token is a stable generic OpenAI API bearer credential.

Anthropic OAuth is deliberately not part of the initial design. Google OAuth and other provider-specific OAuth flows remain future research items.

## Decision

### 1. The local CLI becomes the application authority

The target architecture is:

```text
MORE-MORE-CODE CLI
  ├── AgentLoop / Harness / Context
  ├── Tool Runtime / Permission / Approval / Sandbox
  ├── Local Session Store        <- semantic Session authority
  ├── Local Runtime Store        <- execution/security/recovery facts
  ├── Provider Registry
  ├── Credential Store
  └── Model Provider APIs

            optional
               │
               ▼
MORE-MORE-CODE Cloud
  ├── Account / Subscription / Entitlements
  └── Multi-device Session Sync / Backup
```

The CLI must be able to create, list, open, continue, branch, and persist Sessions without contacting the Server.

This decision supersedes ADR-0003 only where ADR-0003 treats the Cloud Session Store as the creation/retrieval authority. ADR-0003 remains valid for the more fundamental rule that Agent/model/tool execution is local and the Server must not own AgentLoop or Model Steps.

### 2. Server is optional and has only cloud-product responsibilities

The Server may own:

- MORE-MORE-CODE account identity;
- commercial subscription state;
- signed/cached entitlement information;
- multi-device Session synchronization and cloud backup;
- future account-scoped collaboration features explicitly added later.

The Server must not own or proxy:

- model requests;
- provider API keys or OAuth credentials;
- canonical Context compilation;
- AgentLoop execution;
- Tool execution;
- local Runtime Events;
- Sandbox execution.

Subscription checks must not be placed in the per-Model-Step critical path. Cloud-specific capabilities may use cached entitlement state so temporary Server unavailability does not disable the local coding runtime.

### 3. Initial built-in providers are exactly four

The initial built-in provider kinds are:

```text
openai
anthropic
google
deepseek
```

Mistral is removed from the supported provider catalog in Stage 6.4.

Provider identity and provider implementation kind are separate concepts:

```ts
type ProviderKind = "openai" | "anthropic" | "google" | "deepseek" | "custom";
type ProviderId = string;
```

This permits multiple user-defined providers of `kind = "custom"`, such as `openrouter`, `local-ollama`, or a company gateway, without collapsing them into one global `custom` account.

### 4. Custom Provider V1 means OpenAI-compatible

The first custom-provider protocol is intentionally limited to OpenAI-compatible HTTP endpoints. A custom provider can define local non-secret configuration such as:

- stable provider ID and display name;
- `baseURL`;
- authentication strategy;
- optional headers that are explicitly safe to persist;
- configured/discovered model IDs.

Custom Anthropic-compatible, Google-compatible, arbitrary protocol plugins, and executable provider plugins are outside V1.

### 5. Models become data references, not a closed TypeScript union

The canonical model selection moves toward:

```ts
type ModelRef = {
  providerId: string;
  modelId: string;
};
```

Built-in/recommended model catalogs may remain as defaults and UX hints, but they are not the authoritative allowlist for every model a user can configure.

Canonical Session/Context semantics remain provider-independent. Provider adapters resolve `ModelRef` into the AI SDK model/runtime configuration.

### 6. Authentication is a separate seam from provider configuration

Initial authentication support is:

```text
OpenAI
  ├── API Key
  └── Codex OAuth (initially experimental)

Anthropic
  └── API Key

Google
  └── API Key

DeepSeek
  └── API Key

Custom OpenAI-compatible
  ├── API Key / Bearer
  └── None
```

Anthropic OAuth is explicitly not designed in this stage. Google OAuth, Vertex/ADC, and other provider login mechanisms require separate future research and ADRs.

Codex OAuth is represented as its own auth strategy. The implementation should prefer an official Codex authentication/account interface or broker when a stable supported integration exists. It must not scrape/copy `~/.codex` token files, persist raw Codex refresh/access tokens into MORE-MORE-CODE config, or silently treat an undocumented token format as a permanent OpenAI API contract.

### 7. Provider configuration is user-global and secrets are stored separately

Provider account/endpoint configuration belongs in a user-global local file, planned as:

```text
~/.more-more-code/providers.json
```

Project-level `.more-more-code/config.json` may select a provider/model alias or default, but it must not contain account credentials or provider secrets.

Raw secrets are owned by a `CredentialStore` seam. The preferred production adapters are OS-native secret stores such as Windows Credential Manager/DPAPI, macOS Keychain, and Linux Secret Service. If an interim encrypted local adapter is required, it must remain behind the same interface and never place plaintext API keys in `providers.json`.

### 8. Local Session Store becomes semantic Session authority

The current cloud-first `POST /sessions` / `GET /sessions/:id` / whole-state persistence flow is transitional.

Stage 6.5 introduces a local Session Store that owns at minimum:

```text
create
get
list
append semantic Session Entries
update local Session metadata
delete/archive as explicitly defined
```

The Session Tree remains append-only semantic history. The Local Runtime Store remains a separate execution/security/recovery store and is not merged into the Local Session Store merely because both use SQLite.

### 9. Cloud synchronization is append-oriented and conflict-aware

Whole-tree last-write-wins snapshot replacement is not the target multi-device protocol.

Cloud synchronization should use stable Session Entry identity plus revision/cursor/idempotency semantics so independently-created branches from two devices can coexist instead of overwriting one another.

Semantic Session Entries and shareable Session metadata may synchronize. Device-local navigation/presentation state such as `activeEntryId`, expanded tree nodes, and scroll position should remain local by default. A separate semantic "latest" pointer may be designed if cross-device resume needs one.

### 10. Delivery order changes

The accepted roadmap becomes:

1. **Stage 6.4 — Provider Runtime & Local Model Configuration**
2. **Stage 6.5 — Local Session Authority & Server Optionalization**
3. **Stage 6.6 — Cloud Session Sync & Commercial Entitlements**
4. **Stage 6.7 — Windows Native Sandbox**

Windows native isolation remains important, but it no longer precedes the product-architecture migration that removes Server dependence and hard-coded provider configuration.

## Alternatives Considered

### Keep Cloud Session Store as mandatory Session authority

- Pros: existing implementation already works; simple cross-run retrieval.
- Cons: offline/local-only usage still requires MORE-MORE-CODE infrastructure; multi-device snapshot writes remain conflict-prone.
- Rejected: inconsistent with a complete local-first coding agent.

### Route model traffic through the MORE-MORE-CODE Server

- Pros: centralized billing and credentials.
- Cons: reintroduces the exact remote execution dependency rejected by ADR-0003; expands trust and outage surface.
- Rejected.

### Put raw API keys in `.more-more-code/config.json` or `providers.json`

- Pros: simplest implementation.
- Cons: easy accidental Git/log/backup leakage and weak separation between configuration and secrets.
- Rejected.

### Treat Codex as an external Agent backend

- Pros: official Codex login/runtime can be reused wholesale.
- Cons: MORE-MORE-CODE would become a wrapper around another Agent and lose authority over its own Harness, Context, Tool Runtime, Permission, Approval, and Sandbox semantics.
- Rejected for the primary provider path. A future explicit external-agent mode would require a separate architecture decision.

### Support every provider-specific OAuth flow immediately

- Pros: convenient account login experience.
- Cons: provider policy/technical contracts differ and several flows are not interchangeable with ordinary model API authentication.
- Rejected: V1 implements only the approved Codex OAuth seam in addition to API-key strategies.

## Consequences

- Stage 6.4 must replace the hard-coded `SupportedProvider`/closed model assumptions with Provider Registry + `ProviderId`/`ProviderKind` + `ModelRef` semantics.
- Mistral is removed from the built-in provider surface.
- Provider account configuration becomes user-global local state; project config may only refer to providers/models without owning their credentials.
- Credential persistence receives an explicit deep module rather than relying on ambient process environment as the only mechanism.
- Codex OAuth can be implemented without contaminating OpenAI provider/session semantics, and can remain experimental until the integration contract is verified.
- Stage 6.5 must remove mandatory Server calls from Session creation/open/persistence before the product can accurately claim full local-first operation.
- Stage 6.6 must replace whole-state last-write-wins synchronization with an append-oriented, idempotent, conflict-aware multi-device protocol.
- Cloud subscription/entitlements remain optional product capabilities rather than an Agent Runtime dependency.
- Stage 6.7 resumes the Windows native sandbox work on top of the same ProcessSandbox seam delivered in Stage 6.3.

## Implementation Status

Architecture accepted and roadmap planned on 2026-08-23. The current code is transitional: model execution is already local, but Session authority is still cloud-backed and provider/model configuration is still partly hard-coded. Stages 6.4-6.6 implement this ADR incrementally.
