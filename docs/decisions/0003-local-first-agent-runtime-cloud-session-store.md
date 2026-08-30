# ADR-0003: Local-First Agent Runtime with a Cloud Session Store

## Status

Accepted for client-owned Agent/model execution. The Cloud Session authority portion is superseded by ADR-0023.

## Date

2026-08-12

## Context

ADR-0002 correctly moved ownership of the Agent Loop to the CLI, but retained an incorrect execution boundary: each model step was still performed by the server through `/chat`.

MORE MORE CODE is intended to behave like a local coding-agent application. The CLI process owns the user interface, harness, model interaction, tool execution, and message orchestration. The server exists primarily to provide authenticated cloud persistence so sessions can be listed, restored, and synchronized across runs or machines.

Putting model execution on the server makes the local runtime dependent on a remote service for every step, couples cloud persistence to agent execution, and gives the server responsibilities it does not need.

## Decision

Use a local-first execution architecture:

```text
CLI
  UI
   ↓
  AgentLoop
   ↓
  Local Model Transport ──→ Model Provider API
   ↓
  Tool Runtime ───────────→ Local workspace / shell
   ↓
  AgentLoop

  Session Store ──────────→ Cloud Server ──→ PostgreSQL
```

The CLI owns:

- UI and user interaction;
- Run / Turn / Step lifecycle;
- Agent Loop continuation;
- model/provider resolution and `streamText()` calls;
- system instructions;
- local tool execution;
- message orchestration;
- interruption of active local model execution.

The server owns:

- authentication for cloud data;
- session creation, listing, retrieval, and message snapshot persistence;
- session recovery data;
- unrelated account/billing APIs if the product still needs them.

The server does **not** expose an Agent/Chat execution endpoint and is not part of the critical model/tool execution path.

For this service, HTTP endpoints are intentionally limited to **GET** for reads and **POST** for commands/writes. Session message snapshot persistence therefore uses `POST /sessions/:id/messages`; PUT/PATCH/DELETE are not part of the service API convention.

AI SDK `useChat` remains a UI-state primitive. A custom local `ChatTransport` performs one model step in-process and converts the result into UI message chunks. The explicit `AgentLoop` remains responsible for deciding when another model step is required after local tool results.

Cloud message persistence is best-effort from the runtime's perspective. A temporary sync failure must not redefine the local Agent Runtime as a remote-server-dependent system.

Context management, compaction, event-sourced Run/Turn/Step persistence, offline-first local session storage, permissions, and sandboxing remain separate future layers.

> **2026-08-23 update:** ADR-0023 keeps this ADR's local Agent/model/tool execution decision, but supersedes the long-term Cloud Session authority described here. The accepted target is a locally authoritative Session Store with the Server reduced to optional multi-device Session Sync/Backup plus account/subscription entitlements.

## Alternatives Considered

### Server-Side Model Steps

- Pros: provider credentials and usage accounting are centralized.
- Cons: every model step depends on server availability; persistence and execution are coupled; the server becomes an unnecessary runtime coordinator.
- Rejected: conflicts with the intended Claude Code-like local application boundary.

### Server-Owned Agent Loop

- Pros: centralized orchestration.
- Cons: local tools require a remote execution protocol and the server becomes authoritative over a local coding environment.
- Rejected: wrong trust and execution boundary.

### Remove Cloud Server Entirely

- Pros: simplest local runtime.
- Cons: loses account-backed session storage and cross-run/cross-machine recovery.
- Rejected: cloud session persistence is still a desired product capability.

## Consequences

- Model API credentials/configuration must be available to the CLI environment or a future provider-specific forwarding service that is explicitly separate from the session store.
- The CLI can execute model/tool loops without `/chat` or a server-side stream.
- The server API becomes simpler and centered on session snapshots, using only GET and POST methods.
- Session synchronization failures can be handled independently from Agent Run failures.
- Future context and recovery work can distinguish local runtime state from cloud persistence state rather than conflating them.
