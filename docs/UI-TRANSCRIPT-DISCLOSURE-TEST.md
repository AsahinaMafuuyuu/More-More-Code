# UI Transcript Disclosure — Test Contract

**Status:** Red contract defined — 2026-08-28

## Focused regressions

### UI-TD-1 — Reasoning is bounded by default

Render a long reasoning part in a narrow terminal. The initial frame must show
the reasoning disclosure affordance and only the first two terminal rows; a
marker present late in the reasoning body must not be visible.

### UI-TD-2 — Consecutive tools collapse into one group

Render three adjacent Tool parts with two completed terminals and one failed
terminal. The initial frame must contain one `Tools 3` aggregate with
`2 completed` and `1 failed`; individual ToolUse labels must not be visible
until the group is expanded.

### UI-TD-3 — Existing ToolUse semantics remain intact

Direct ToolUse rendering still exposes a one-line collapsed row, semantic
status glyph, input summary where width permits, and detail disclosure without
creating a second terminal state.

### UI-TD-4 — Build/type safety

Focused UI tests, CLI typecheck/build, and whitespace checks must pass.

## Architecture assertions

- No Session Entry or Runtime Event schema changes.
- No Provider/Context policy changes are introduced by the UI files.
- No autonomous timer/render source is added.
