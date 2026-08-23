# ADR-0020: Derived Security Audit and Lifecycle Consistency Replay

## Status

Accepted

## Date

2026-08-23

## Context

Stage 6.0 Phase 5 persists redacted permission lifecycle facts as schema-v2 `permission.lifecycle requested | decided` Runtime Events while retaining schema-v1 `permission.decision` compatibility. The durable protocol deliberately excludes raw command text, filesystem paths, generic resource values, Tool input/output, and policy reasons.

Phase 6 needs an auditable session-scoped security view and replay validation. Recomputing the original `RulePermissionPolicy` decision from the durable log is impossible by design because the sensitive resource value used for command/path/resource matching is not persisted. Treating redacted metadata as enough to recompute policy would create false assurance or pressure the event protocol to retain sensitive data.

Runtime Snapshots are recovery acceleration for open Runs and pending Context work. Embedding the full security timeline in `RuntimeSessionProjection` would duplicate the append-only event history and make snapshots grow without bound.

## Decision

Harness provides a pure, provider-independent `projectSecurityAuditTimeline(sessionId, events)` projection over persisted Runtime Events.

- The audit timeline is derived on demand from the session-scoped Runtime Event stream. It is not stored inside `RuntimeSessionProjection` or copied into Runtime Snapshots.
- Schema-v2 permission facts are correlated by Run/Turn/Step/Tool-call identifiers plus capability. A request and decision must agree on redacted `resourceKind` and `scope` metadata.
- Schema-v1 permission decisions remain readable as explicit `legacy` decision-only audit entries. The projector does not invent a missing request.
- The projector classifies entries as `complete | pending | legacy | inconsistent` and reports durable event offsets for evidence.
- Lifecycle replay validates structural and enforcement invariants: missing/orphan/duplicate request/decision facts, decision-before-request, metadata mismatches, missing/duplicate Tool terminals, and permission-to-terminal consistency.
- Terminal verification is Tool-call aggregate aware. If any capability is `deny`, the Tool terminal must be `denied`. For legacy permission-only histories, `ask` terminates as `approval_required`; ADR-0021 extends new histories so a matching schema-v3 approval may resolve allow/deny/cancel/timeout and the eventual Tool terminal must agree with that human outcome.
- Replay verification is **lifecycle consistency replay**, not policy recomputation. It never claims to rerun command/path/resource rule matching from redacted events.
- Foreign-session events are rejected rather than silently mixed into one audit projection.

Dangerous-operation validation exercises the final Tool Runtime enforcement seam, including composed shell-command patterns, outside-workspace absolute paths, nested symlink/junction escapes, multi-capability Tools, policy failures, and awaited permission-observer persistence failures. These tests validate the current policy boundary; lexical command glob matching is not a shell parser or OS-level sandbox.

## Alternatives Considered

### Persist raw resources so policy can be recomputed exactly

Rejected because raw command/path/resource values may contain secrets or user content and would violate the existing redaction boundary.

### Persist a complete audit projection in Runtime Snapshots

Rejected because the durable event stream is already the source of truth. Copying the timeline into every snapshot would create unbounded duplication and couple recovery state to an audit UI concern.

### Validate each capability terminal independently

Rejected because one Tool call may require multiple capabilities. A Tool can be correctly denied because one capability blocks even when another capability is allowed; terminal validation therefore has to aggregate decisions at the Tool-call boundary.

### Treat command-pattern tests as sandbox guarantees

Rejected. Pattern matching is application policy. Process, filesystem, network, no-follow, and descendant isolation require a separate OS-level Sandbox design.

## Consequences

- Security audit history remains reproducible from the append-only Runtime Event stream and stays session scoped.
- Redaction remains strict: audit validation works without durable raw command/path/resource values.
- Phase 6 can detect lifecycle corruption or enforcement disagreement after restart without claiming impossible policy recomputation.
- Legacy v1 events remain visible but carry less evidence than v2 request/decision pairs.
- The audit projector is intentionally derived and does not enlarge RuntimeSession snapshots.
- ADR-0021 extends this derived projection with schema-v3 interactive approval transactions. Shell-AST-aware command authorization and OS-level Sandbox enforcement remain separate follow-up work.
