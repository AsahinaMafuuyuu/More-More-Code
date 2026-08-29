import type {
  InspectorTreeEntryView,
} from "./inspector-projections";

export type InspectorSectionId = "tree" | "context" | "usage" | "runtime" | "security";

export const INSPECTOR_SECTIONS: ReadonlyArray<Readonly<{
  id: InspectorSectionId;
  label: string;
  delivered: boolean;
}>> = Object.freeze([
  Object.freeze({ id: "tree", label: "Tree", delivered: true }),
  Object.freeze({ id: "context", label: "Context", delivered: true }),
  Object.freeze({ id: "usage", label: "Usage", delivered: true }),
  Object.freeze({ id: "runtime", label: "Runtime", delivered: false }),
  Object.freeze({ id: "security", label: "Security", delivered: false }),
]);

export function cycleInspectorSection(
  current: InspectorSectionId,
  delta: -1 | 1,
): InspectorSectionId {
  const index = Math.max(0, INSPECTOR_SECTIONS.findIndex((section) => section.id === current));
  const next = (index + delta + INSPECTOR_SECTIONS.length) % INSPECTOR_SECTIONS.length;
  return INSPECTOR_SECTIONS[next]!.id;
}

export function filterInspectorTreeEntries<T extends Pick<InspectorTreeEntryView, "id" | "label" | "preview" | "status">>(
  entries: readonly T[],
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => (
    entry.id.toLowerCase().includes(needle)
    || entry.label.toLowerCase().includes(needle)
    || entry.preview.toLowerCase().includes(needle)
    || entry.status?.toLowerCase().includes(needle)
  ));
}

export function moveInspectorSelection(
  currentIndex: number,
  delta: -1 | 1,
  itemCount: number,
) {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(itemCount - 1, currentIndex + delta));
}
