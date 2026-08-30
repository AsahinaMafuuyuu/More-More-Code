# UI Transcript Disclosure — Design

**Status:** Accepted for implementation — 2026-08-28

## Scope

This slice reduces transcript noise without changing Session, Runtime Event,
AgentLoop, Tool terminal authority, or Provider execution semantics.

The main Conversation surface gains two progressive-disclosure primitives:

1. Reasoning is visually bounded to two terminal rows by default and expands
   in place on pointer activation.
2. Two or more consecutive ToolUse parts are represented by one aggregate
   disclosure row. The row reports total/success/failure counts and expands to
   the existing semantic ToolUse rows. A lone ToolUse stays as its normal
   one-row disclosure instead of adding a redundant `Tools 1` wrapper. Each
   ToolUse remains one row by default and can independently reveal its details.

## Presentation seam

`BotMessage` owns transcript part ordering only. It must not derive Tool
terminal truth. Tool status continues to come from `ToolUseView`, whose
canonical terminal precedence is unchanged.

Consecutive parts are grouped by **semantic presentation kind**, not by the
literal AI SDK part type:

```text
reasoning -> reasoning disclosure
tool-* / dynamic-tool -> one Tool group
text -> ordinary assistant text
```

Different Tool names therefore belong to the same group when they are adjacent
in the transcript. A reasoning/text part terminates the group so disclosure
does not reorder execution history.

## Reasoning disclosure

- Collapsed is the default for every reasoning block.
- Collapsed height is exactly two terminal rows; content is clipped rather
  than destructively rewritten.
- Expanded state removes the height constraint and renders the full reasoning
  text.
- The left reasoning rail and theme token remain the visual identity.
- A `▸` / `▾` affordance makes disclosure state explicit.

## Tool group disclosure

Collapsed example:

```text
▸ Tools 5 · ✓ 4 completed · × 1 failed
```

The aggregate uses semantic buckets:

- success: `completed`;
- failure: `failed | denied | timed_out | incomplete`;
- cancelled: `cancelled` (shown separately when non-zero);
- active: `requested | running | approval_waiting` (shown separately when
  non-zero).

The mandatory total/success/failure values are always shown. Optional active
and cancelled counts prevent those states from being mislabeled as failures.

Expanded groups render the existing `ToolUse` projection in execution order.
ToolUse remains collapsed by default and continues to expose input/output/error
and runtime diagnostics only on its own disclosure action.

## Visual hierarchy

- Tool group identity uses the theme's `sessionTool` token.
- Tool names are bold and use `sessionTool`.
- Status glyph/label use status-semantic colors (`success`, `error`, `info`,
  etc.).
- Secondary input/runtime detail remains dim so status and tool identity scan
  faster than payload text.
- No new hard-coded theme colors are introduced.

## Interaction and layout

- Disclosure is pointer-driven in this slice and does not introduce a new
  global keyboard layer.
- Collapsing content reduces layout height; ConversationPane remains the sole
  scroll authority and keeps its existing sticky/manual-scroll behavior.
- No timers or autonomous rendering are introduced.

## Non-goals

- No change to Tool call/result persistence.
- No new Agent Activity region.
- No Inspector implementation.
- No reasoning redaction or semantic summarization.
- No reordering of assistant/model parts.
