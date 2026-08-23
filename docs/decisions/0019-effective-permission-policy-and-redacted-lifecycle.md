# ADR-0019: Effective Permission Policy and Redacted Lifecycle

## Status

Accepted

## Date

2026-08-23

## Context

Stage 6.0 production wiring recorded a permission outcome before Tool execution, but it did not yet provide effective policy enforcement. Harness exposed a synchronous capability deny-set while CLI Tool Runtime defined a second async `evaluate()` interface, production used an implicit allow-all policy, Agent config had no persisted overrides, and the durable security fact used a synthetic `tool.<name>` capability. The duplicate interfaces made it possible for policy behavior, enforcement, and audit facts to disagree.

Permission evaluation sometimes needs raw paths, commands, or Agent resource names. Those values are necessary transient inputs to policy matching, but ADR-0017 prohibits persisting command text, file paths/content, Tool inputs, or arbitrary reasons in the Local Runtime Store. Interactive approval and OS process isolation also remain separate capabilities; an `ask` decision must not pretend either already exists.

## Decision

Harness owns one provider-independent permission interface and a deep `RulePermissionPolicy` module.

- A request contains one capability plus an optional typed ephemeral resource. Resource kinds are `path | command | resource`; scopes are `workspace | outside-workspace | agent-config | external`.
- A decision contains `allow | deny | ask`, its `default | configured` policy source, and an optional ephemeral reason.
- Rules may constrain capability, command, path, generic resource, and scope. Fields within one rule are conjunctive; pattern arrays are disjunctive glob matches.
- Ordinary rules are evaluated in declaration order and the last matching rule wins. CLI composes code defaults first, then persisted global config, then persisted project config, so more specific project rules can override earlier defaults without duplicating the evaluator. A final non-overridable `outside-workspace` deny keeps policy decisions aligned with native filesystem execution.
- Path patterns are segment-aware (`*` stays within one segment; `**` may cross segments) and use case-insensitive matching on Windows. Tool Registry and native file execution share one canonical resolver: existing symlinks/junctions resolve to their real target, while create targets resolve their nearest existing ancestor before containment is decided.

Tool Registry owns native Tool capability metadata and translates Tool input into ephemeral permission resources. Tool Runtime requires an explicit `PermissionPolicy` dependency; it has no implicit allow-all fallback. It asks the Harness policy once per registered capability, awaits a redacted request observation before evaluation, awaits a redacted decision observation afterward, and invokes an executor only when every effective decision allows it. `deny` produces `denied`; `ask` produces `approval_required`. A thrown policy/observer/Runtime Store error is infrastructure failure and propagates to AgentLoop rather than being normalized as an ordinary Tool outcome.

Permission security payloads use an independently versioned schema v2 lifecycle:

```text
permission.lifecycle requested
  -> capability + resourceKind + scope + correlation IDs

permission.lifecycle decided
  -> the same metadata + decision + policy source
```

The validator continues to accept legacy schema-v1 `permission.decision` events for recovery. Version 2 rejects raw `command`, `path`, `value`, unknown fields, Tool input/output, and policy reasons.

## Alternatives Considered

### Keep separate Harness and CLI permission interfaces

Rejected because callers could adapt or bypass policy differently, and tests would not exercise the same seam used by production Tool Runtime.

### Persist raw resources for richer auditing

Rejected because commands and paths may contain secrets or user content. Audit projection can explain which capability/resource class/scope was decided without copying sensitive Tool input into a second durable history.

### Make the first matching rule win

Rejected because code defaults would prevent later global/project overrides from specializing policy. Stable last-match semantics preserve the existing global-to-project configuration precedence.

### Treat `ask` as implicit approval

Rejected because no interactive approval transaction exists yet. Returning `approval_required` is explicit and fail-closed without conflating policy with UI or sandbox enforcement.

## Consequences

- Harness is the single authority for permission request/decision/rule types and evaluation semantics.
- Tool Runtime remains the final enforcement seam; Tool executors do not reimplement policy.
- Agent config can persist defaults and ordered rules without breaking older files where `permissions` is absent; workspace containment is intentionally not configurable.
- Security events support request/decision correlation without storing raw commands, paths, Tool input/output, or reasons.
- ADR-0020 completes the Phase 6 session-scoped derived audit projection over both legacy v1 decisions and v2 lifecycle events, using lifecycle consistency replay rather than redacted policy recomputation.
- Canonical path validation closes existing-link escape but retains a check/use race; OS-level no-follow filesystem isolation remains a separate Sandbox follow-up.
- Interactive approval UI, OS-level process/network sandboxing, and MCP-specific authorization remain separate follow-up work.
