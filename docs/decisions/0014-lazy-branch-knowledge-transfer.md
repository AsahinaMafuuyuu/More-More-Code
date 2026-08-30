# ADR-0014: Lazy Branch Knowledge Transfer

## Status

Accepted

## Date

2026-08-14

## Context

Session Entry Tree v3 allows navigation to any historical Entry without deleting sibling history. A navigation from one branch to an ancestor or sibling can nevertheless remove useful source-only discoveries from the model Context. Treating every jump as a branch mutation would make ordinary browsing create durable history, while silently dropping source knowledge would make cross-branch work lossy.

Branch knowledge transfer must also remain distinct from historical Compaction: Compaction replaces old active-branch Context with a bounded current-state checkpoint; Branch Summary transfers useful discoveries from a departed path into a different target path.

## Decision

### Navigation is analyzed before it is mutated

The Harness compares the active source path with the requested target path, computes their lowest common ancestor, and returns only source-only semantic Entries after that point. Descendant navigation is lossless because the target already contains the source path. Runtime-only Entries (`session_start`, model/mode/config changes) do not trigger transfer.

Navigation policy is configured as:

```text
branchSummaryOnJump = ask | always | never
default = ask
```

`/tree`, `/jump`, `/parent`, and `/root` all use the same CLI navigation controller.

### Browsing stays lazy

- **Cancel** leaves the source active and appends nothing.
- **No Carry** changes only `activeEntryId`; no Session Entry is created.
- **Carry** jumps to the target first, reduces uncovered source knowledge, then appends exactly one `branch_summary` child under the target.
- If reduction cannot produce valid text, the target remains active and no invalid summary is appended.

The first later real Session mutation after No Carry creates a branch naturally. Browsing alone is never a durable branch operation.

### Transfer provenance is structured

`branch_summary.summary` remains bounded plain text. Optional transfer metadata records `sourceTipEntryId`, `targetEntryId`, `commonAncestorEntryId`, exact `coveredEntryIds`, and prior transfer Entry references. Existing summary-only Branch Summary Entries remain valid.

Coverage is incremental: covered Entry IDs are subtracted only when the prior transfer Entry itself lies on the requested target path, so deduplication is applied only when the target Context actually contains that transferred knowledge. A prior Branch Summary is itself semantic input, allowing knowledge to survive multiple branch hops without rewriting old Entries.

### Reduction and Context integration

Branch Summary has its own reducer contract and fixed Key Findings / Decisions / Artifacts / Failures and Lessons / Pending Work format. V1 caps output at `min(4096 tokens, 4% of effective input budget)` and applies the existing Tool Result Working Set projection before reduction. Reducer failure uses a bounded deterministic fallback.

Active-path Branch Summary text is projected as a historical canonical Context record, not a synthetic chat Message or Compaction checkpoint. Old Branch Summary records may later be absorbed by normal historical Compaction. Generic compacted/retained record IDs prevent an absorbed Branch Summary from being projected again after checkpoint reuse, while all source Session Entries remain append-only.

## Consequences

- Cross-branch navigation can preserve useful discoveries without turning every browse action into a branch mutation.
- Target model/mode/config state remains authoritative for the target path and is never overwritten by transfer metadata.
- Branch Summary, Tool Result Pruning, and Compaction keep separate purposes and failure domains.
- Session persistence remains backward compatible with older summary-only Branch Summary Entries.
- Automatic semantic merge/conflict resolution, branch ranking, and collaborative branch merging remain deferred.
