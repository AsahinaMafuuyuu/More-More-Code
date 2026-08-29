import { describe, expect, test } from "bun:test";
import {
  INSPECTOR_SECTIONS,
  cycleInspectorSection,
  filterInspectorTreeEntries,
  moveInspectorSelection,
} from "../src/ui/session/inspector/inspector-model";

const entries = [
  {
    id: "1",
    label: "User",
    preview: "Add context inspector",
    depth: 0,
    createdAt: 1,
    navigationTargetEntryId: "entry-1",
    selectable: true,
    active: false,
    activePath: false,
  },
  {
    id: "2",
    label: "ToolUse",
    preview: "[readFile]",
    depth: 0,
    createdAt: 2,
    navigationTargetEntryId: "entry-2",
    selectable: false,
    active: true,
    activePath: true,
    status: "pending" as const,
  },
];

describe("Session Inspector interaction model", () => {
  test("cycles stable sections in both directions", () => {
    expect(INSPECTOR_SECTIONS.map((section) => section.id)).toEqual([
      "tree",
      "context",
      "usage",
      "runtime",
      "security",
    ]);
    expect(cycleInspectorSection("tree", 1)).toBe("context");
    expect(cycleInspectorSection("tree", -1)).toBe("security");
    expect(cycleInspectorSection("security", 1)).toBe("tree");
  });

  test("filters Tree entries case-insensitively without changing identity", () => {
    expect(filterInspectorTreeEntries(entries, "CONTEXT").map((entry) => entry.id)).toEqual(["1"]);
    expect(filterInspectorTreeEntries(entries, "tooluse").map((entry) => entry.id)).toEqual(["2"]);
    expect(filterInspectorTreeEntries(entries, "")).toBe(entries);
  });

  test("selection movement clamps to available rows", () => {
    expect(moveInspectorSelection(0, -1, entries.length)).toBe(0);
    expect(moveInspectorSelection(0, 1, entries.length)).toBe(1);
    expect(moveInspectorSelection(1, 1, entries.length)).toBe(1);
    expect(moveInspectorSelection(5, -1, 0)).toBe(0);
  });
});
