# UI Session Inspector Test Contract

**Status:** VERIFIED — 2026-08-29

**Design:** `docs/UI-SESSION-INSPECTOR-DESIGN.md`

## 1. Agreed test seams

Tests target public/pure seams rather than OpenTUI implementation details:

1. `projectInspectorContextView()` — Current Context -> UI view.
2. `projectInspectorUsageView()` — Runtime Usage summary -> UI view.
3. `projectInspectorTreeView()` — semantic Navigation Projection -> UI view.
4. `SessionUiStore` selector subscriptions — Inspector slices remain isolated.
5. `SessionCommandRouter` — `/tree` and `/inspect` resolve to Inspector intent while
   `/jump` remains a direct dialog.
6. Inspector section/keyboard helpers — deterministic cycling, filtering and
   selection without Session mutation.
7. Inspector component smoke — open/close/section content and narrow layout using
   the existing OpenTUI test renderer where feasible.

Navigation durability itself remains covered by existing SessionController and Branch
Summary tests; this stage does not duplicate those internals.

## 2. Red -> Green slices

### T1 — Context projection

- exact values remain exact;
- estimated quality remains explicit;
- unavailable Context is represented without secondary estimation;
- token/utilization formatting is deterministic.

### T2 — Usage projection

- missing fields render unavailable rather than zero;
- explicit zero remains zero;
- complete/partial/none Cost and Cache coverage remain distinct;
- invalid integrity is surfaced;
- persistence-incomplete state cannot present complete Cost/Cache.

### T3 — Tree projection

- visible semantic nodes preserve branch depth and active state;
- ToolUse label/status is semantic;
- non-selectable incomplete ToolUse remains non-selectable;
- previews are bounded;
- canonical navigation target IDs are preserved.

### T4 — Store isolation

- Context Inspector updates notify Context subscribers only;
- Usage Inspector updates notify Usage subscribers only;
- Tree Inspector updates notify Tree subscribers only;
- shell section changes do not notify Conversation/Activity/Status selectors.

### T5 — Command routing

- `tree` -> open Inspector Tree;
- `inspect` -> open Inspector Tree;
- `jump` -> existing jump dialog;
- unrelated commands preserve current behavior.

### T6 — Interaction helpers

- Tab and Shift+Tab cycle stable section order;
- deferred Runtime/Security sections can be selected but render explicit
  not-delivered state;
- Tree filtering is case-insensitive and stable;
- Up/Down clamps selection; Enter cannot navigate a non-selectable row.

### T7 — Component / integration smoke

- closed Inspector mounts no overlay content;
- open Tree/Context/Usage sections render expected headings;
- Escape closes Inspector without invoking Session interruption;
- narrow layout uses compact metadata without losing navigation identity.

## 3. Regression gates

Focused:

```text
bun test packages/cli/tests/session-inspector-projection.test.ts
bun test packages/cli/tests/session-inspector-interaction.test.ts
bun test packages/cli/tests/session-command-router.test.ts
bun test packages/cli/tests/session-ui-store.test.ts
```

Final:

```text
bun test packages/cli/tests
bun run --cwd packages/harness test
bunx tsc --noEmit -p packages/cli/tsconfig.json
bun run --cwd packages/harness typecheck
bun run --filter @more-more-code/cli build
bun run tui:stress
git diff --check
```

## 4. Failure rules

- A missing UI datum is a UI unavailable state, not justification for a bottom-layer
  schema change.
- If a test requires a new Harness semantic state, Runtime Event field, Session Entry,
  persistence migration, Provider request behavior or Usage authority change, stop
  implementation and escalate architecture instead of weakening this contract.
