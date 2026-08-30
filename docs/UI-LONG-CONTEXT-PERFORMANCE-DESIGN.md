# UI Long-Context Performance Design

**Status:** Approved for implementation — 2026-08-29

**Scope:** CLI/OpenTUI presentation path only. Harness, Provider request semantics,
Session authority, Context compaction policy and durable persistence remain unchanged.

## 1. Problem

The current Session UI becomes increasingly expensive as conversation depth grows.
The dominant costs are not token counting itself; they are retained UI work that is
performed again for every streaming update:

1. `LocalChatRuntime.reduceChunk()` deep-clones the complete message history for
   each text/reasoning/tool stream chunk.
2. `SessionRuntimeBridge` reprojects ToolUse from the complete message history and
   active Session path whenever the chat message array changes.
3. `ConversationSurface` regroups every historical message into rounds on every
   Conversation update.
4. `ConversationPane` mounts the complete transcript in one retained OpenTUI tree.
5. Collapsed reasoning still passes the complete reasoning string into the renderer.
6. Collapsed ToolUse rows eagerly serialize output detail even when detail is hidden.

This makes high-frequency work proportional to historical depth. At 100K tokens the
cost is already visible; at 1M tokens it is structurally unacceptable.

## 2. External reference patterns

Public implementations point in the same direction:

- **OpenAI Codex CLI** separates committed transcript cells from the mutable active
  cell. Normal chat rendering keeps only the live tail in the retained frame and lets
  terminal scrollback own committed output. Its full transcript/reflow path applies
  row caps and is moving toward viewport-only materialization and width-keyed render
  caches.
- **Gemini CLI** exposes a terminal-buffer architecture and incremental rendering so
  unchanged terminal content is not repainted as one monolithic retained tree.
- **OpenCode** already virtualizes its timeline, but public performance reports show
  that virtualization alone is insufficient when timeline projection/indexing still
  scans all messages on streaming updates.

The transferable invariant is therefore:

> sealed history must be stable; high-frequency streaming work must touch only the
> active tail; the main retained renderer must materialize a bounded transcript.

OpenTUI does not currently provide a turnkey variable-height virtual list, so this
project will implement bounded transcript materialization on top of the existing
Session UI store rather than introducing another UI framework.

## 3. Target architecture

```text
Durable Session Tree
        |
        v
LocalChatRuntime message index
  - stable sealed history
  - copy-on-write changed message only
  - monotonic revision
        |
        +------------------------------+
        |                              |
        v                              v
Provider full-history snapshot      UI tail projection
(once per Model Step)               (bounded work)
                                       |
                                       v
                              Transcript materialization
                              - recent complete rounds
                              - bounded message count
                              - hidden-history marker
                              - OpenTUI viewport culling
```

## 4. Implementation slices

### ULP-1 — O(delta) chat streaming state

`LocalChatRuntime` will stop exposing a freshly deep-cloned complete `messages`
array as its reactive snapshot.

The runtime will own:

- ordered message storage;
- `messageId -> index` lookup;
- a monotonic `revision` in the external-store snapshot;
- copy-on-write replacement of only the changed assistant message/part;
- full-history materialization only when crossing the Provider boundary or an
  explicit diagnostic/test read.

Per text/reasoning delta, work becomes independent of historical message payload
size.

### ULP-2 — bounded live transcript projection

The Conversation UI will consume a recent materialized tail rather than all durable
messages. The window must:

- preserve complete visible conversation-round boundaries when practical;
- always include the active/latest round;
- cap retained message count independently of total Session history;
- expose how many older messages are not mounted;
- never delete or rewrite durable history.

Initial policy:

- maximum 160 materialized messages;
- expand backward to the nearest user-message boundary;
- at most 32 additional messages may be pulled in to preserve that boundary;
- older history is represented by one lightweight marker.

This is a main-view rendering policy only. Session Tree and persistence stay complete.

### ULP-3 — split canonical ToolUse indexing from live overlay

Canonical Session Tool Call/Result indexing must only rerun when `sessionTree`
changes. Streaming chat revisions may overlay live Tool parts, current Activity and
pending Approval state over that cached index without rescanning the full Session
path.

The live overlay is computed only from the bounded materialized transcript plus
current Activity/Approval facts.

### ULP-4 — hidden-content render guards

- Collapsed reasoning renders a bounded preview string, not the complete reasoning
  buffer clipped by height.
- ToolUse collapsed rendering computes only collapsed text/status; expensive output
  serialization is deferred until expansion.
- Individual user/assistant text parts above 16,384 characters render a bounded
  head/tail preview until explicitly expanded, so one megatext message cannot bypass
  transcript windowing.
- OpenTUI `viewportCulling` is enabled on the Conversation scrollbox.

### ULP-5 — regression/performance gates

Add deterministic tests that prove the architecture rather than relying only on wall
clock timing:

- finalized historical message object references stay unchanged across hundreds of
  streaming deltas;
- each streaming update changes only the active message revision;
- materialized transcript size remains bounded for synthetic 10K-message / ~1M-token
  history;
- canonical ToolUse path projection does not rerun for chat-only revisions;
- collapsed ToolUse does not stringify hidden large output;
- collapsed reasoning does not send the complete large reasoning string to OpenTUI.

Existing native TUI stress remains the final renderer stability gate.

## 5. Non-goals for this stage

- No Session DB pagination/lazy hydration yet.
- No Context compaction changes.
- No Provider request format/cache changes.
- No migration away from OpenTUI.
- No deletion of old transcript/session content.

If 1M-session startup itself remains slow after this stage, the next isolated stage is
lazy Session hydration by `LocalSessionEntry.sequence`; it must not be mixed into the
high-frequency rendering fix.

## 6. Acceptance criteria

1. Streaming output no longer deep-clones complete history per chunk.
2. Main Conversation retained tree is bounded independently of total Session depth.
3. Streaming revisions do not rescan the complete Session ToolUse path.
4. Hidden reasoning/tool detail does not perform full hidden-content render work.
5. Sticky-bottom/manual-scroll behavior remains valid for the materialized window.
6. Focused UI tests, full CLI tests, CLI build/typecheck, native TUI stress and
   `git diff --check` pass before delivery.
