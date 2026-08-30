# ADR-0021: Interactive Tool Approval Transactions

## Status

Accepted

## Date

2026-08-23

## Context

ADR-0019 introduced a provider-independent Permission Policy with `allow | deny | ask`, but Stage 6.0 intentionally treated `ask` as a fail-closed `approval_required` Tool outcome because no human approval transaction existed. That behavior was safe but incomplete: the model received a failed Tool Call and would have needed to issue another Tool Call after the user approved, which would split one intended operation across multiple AgentLoop steps.

Approval also needs information that must not become durable audit content. A user deciding whether to approve a command or file operation may need to see the raw command/path/resource value, while ADR-0017/0019 require Runtime Events to exclude those values.

## Decision

Harness owns a provider-independent `ApprovalBroker` interface, while CLI supplies the process-local interactive adapter and terminal UI.

- `PermissionPolicy` and approval remain separate modules. Policy answers whether a capability is `allow | deny | ask`; Approval Broker answers whether the human permits this specific Tool Call once.
- Tool Runtime evaluates and durably observes **all** registered capability decisions before requesting approval. Any `deny` wins immediately and suppresses the prompt. If there is no deny, all `ask` requirements are batched into exactly one Tool-call-level approval transaction.
- The Approval Broker receives the full ephemeral `PermissionRequest` set so the CLI can show raw command/path/resource values to the user. Those values never cross the Runtime Event seam.
- Stage 6.2 supports only `Allow once` and `Deny`. Approval never edits global/project config and does not create session/project persistent permission rules.
- Tool Runtime awaits approval inside the original Tool Step. An allowed transaction proceeds to the original executor without requiring a second model Tool Call.
- Approval waiting has its own timeout and consumes the Run `AbortSignal`. Deny becomes a normal `denied` Tool result; dialog dismissal or Run interruption becomes `cancelled`; approval timeout becomes `timed_out`.
- Approval broker or durable observer failures are infrastructure failures and propagate fail-closed. In particular, the approval request must be durable before the broker is awaited, and an approval allow must be durable before executor invocation.

Approval Runtime Events use an independently versioned schema v3 lifecycle:

```text
approval.lifecycle requested
  -> approvalId
  -> ask requirements: capability + resourceKind + scope
  -> Run/Turn/Step/Tool-call correlation

approval.lifecycle resolved
  -> allow | deny

approval.lifecycle cancelled | timed_out
```

The event validator continues to accept permission schema v1/v2 histories. Schema v3 rejects raw command/path/resource values, reasons, and unknown fields.

ADR-0020's derived audit projection is extended rather than replaced. For v3 histories, `ask` may legally proceed to executor execution only after a matching approval resolves `allow`; approval deny/cancel/timeout must agree with the eventual Tool terminal. Older v1/v2 permission-only histories keep their previous replay semantics.

## Alternatives Considered

### Return `approval_required` and ask the model to retry

Rejected because one human decision would become two model Tool Calls and two Tool Steps, polluting execution semantics and creating opportunities for the retried input to differ from the operation the user approved.

### Put interactive approval inside Permission Policy

Rejected because policy evaluation is deterministic rule interpretation, while approval is asynchronous human interaction with cancellation, timeout, and UI lifecycle. Combining them would make the policy interface shallow and UI-dependent.

### Persist raw command/path values for approval replay

Rejected because approval context can contain secrets or user-authored content. The human sees raw values only from the process-local request; durable audit records keep redacted metadata.

### Add Allow-for-session / Allow-for-project immediately

Rejected for this Stage. Persisting broader authority requires a separate scope/revocation/config-mutation design and should not be implied by a one-time approval transaction.

## Consequences

- `ask` is now a complete interactive execution path rather than a model-visible dead end.
- Permission enforcement remains deterministic and independent from terminal UI concerns.
- Raw operation details are available to the human without weakening durable event redaction.
- One Tool Call creates at most one approval transaction even when it requires multiple ask capabilities.
- Session unmount and dialog dismissal cancel pending approvals so AgentLoop cannot remain stranded.
- The audit projector can distinguish permission decision evidence from human approval evidence.
- Persistent approval scopes, shell-AST-aware command authorization, MCP authorization, and OS-level process/filesystem/network Sandbox enforcement remain separate follow-up work.
