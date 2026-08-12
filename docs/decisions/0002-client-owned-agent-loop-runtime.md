# ADR-0002: Put the Agent Loop Runtime on the CLI Side

## Status

Superseded by ADR-0003

## Date

2026-08-12

## Context

MORE MORE CODE previously relied on AI SDK UI behaviour to continue a chat automatically after client-side tool calls. The model is invoked by the remote Hono server, while filesystem and shell tools execute on the user's local machine.

That split makes a server-owned agent loop unsuitable: the server cannot directly execute local workspace tools without introducing a remote execution channel. It also leaves important harness concepts such as execution identity, step boundaries, interruption, and loop limits implicit inside UI library behaviour.

The project needs an explicit harness runtime before adding context management, permissions, extensions, or subagents.

## Decision

Add a dedicated `packages/harness` runtime and make the CLI the owner of the top-level agent loop.

The runtime uses three lifecycle levels:

- **Run**: one top-level agent execution started by a CLI submission.
- **Turn**: the user-to-assistant interaction processed by that run. A top-level run currently contains one turn, but the structure permits additional turn-like units later without changing step semantics.
- **Step**: one atomic execution unit. The initial step kinds are `model` and `tool`.

The loop is explicit:

```text
Run
  -> Turn
      -> Model Step
          -> no tool calls -> complete
          -> tool calls
              -> Tool Step(s)
              -> Model Step
              -> ...
```

The server remains responsible for a single streamed model step. Local tools remain in the CLI. The harness decides when to invoke the server again after tool outputs are available.

AI SDK's `sendAutomaticallyWhen` is no longer the owner of continuation. During this transitional phase the CLI sends the current conversation state for each model step so consecutive tool rounds cannot lose messages that have not yet been persisted by the server.

Context construction, token budgeting, compaction, persistent Run/Turn/Step event storage, permissions, and sandboxing are explicitly deferred to later harness layers.

## Alternatives Considered

### Keep AI SDK Automatic Tool Resubmission

- Pros: Minimal custom runtime code.
- Cons: Run/Turn/Step boundaries remain implicit; interruption and loop limits are difficult to own; future harness features remain coupled to React chat behaviour.
- Rejected: The project needs an explicit execution runtime rather than a UI-library-driven loop.

### Move the Entire Agent Loop to the Server

- Pros: Centralized runtime and easier server-side observability.
- Cons: The server cannot directly access the user's local filesystem and shell. Supporting local tools would require a bidirectional remote execution protocol before the basic harness model is established.
- Rejected: It reverses the current trust and execution boundary and adds unnecessary infrastructure.

### Put the Loop Directly in `useChat`

- Pros: Few files and no new package.
- Cons: Lifecycle types and orchestration would remain coupled to React and would be difficult to reuse for non-UI entrypoints, tests, subagents, or future runtimes.
- Rejected: The loop is harness infrastructure, not a UI concern.

## Consequences

- Agent execution has explicit Run, Turn, and Step identities and statuses.
- The harness can enforce a maximum step count independently of the model provider.
- Interruptions are represented as runtime state instead of being only an HTTP stream abort.
- Tool execution errors can be returned to the model as tool outputs while harness integration failures can fail the run.
- The CLI temporarily resends the current message state on continuation requests; a later context/session layer should replace this with deliberate context and event construction.
- Local tool cancellation is not yet complete. An interrupt can abort the active model stream and prevents later steps, but cancellation of an already-running local tool belongs to the future Tool Runtime layer.
