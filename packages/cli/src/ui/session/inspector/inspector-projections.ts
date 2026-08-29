import type { SessionUsageSummary } from "@more-more-code/harness";
import type { CurrentContextUsage } from "../../../lib/local-model-transport";
import type { SessionNavigationTree } from "../../../lib/session-navigation-projection";

export type InspectorContextView = Readonly<{
  available: boolean;
  currentInput: string;
  contextWindow: string;
  utilization: string;
  utilizationRatio: number | null;
  inputBudget: string;
  reservedOutput: string;
  safetyMargin: string;
  counterId: string;
  quality: "estimated" | "exact" | "unavailable";
}>;

export type InspectorUsageView = Readonly<{
  inputTotal: string;
  inputNoCache: string;
  cacheRead: string;
  cacheWrite: string;
  outputTotal: string;
  outputText: string;
  outputReasoning: string;
  cacheHit: string;
  cacheCoverage: "complete" | "partial" | "none";
  apiCost: string;
  costCoverage: "complete" | "partial" | "none";
  completedSteps: string;
  integrity: "valid" | "invalid";
  persistenceIncomplete: boolean;
}>;

export type InspectorTreeEntryView = Readonly<{
  id: string;
  label: string;
  preview: string;
  depth: number;
  createdAt: number;
  navigationTargetEntryId: string;
  selectable: boolean;
  active: boolean;
  activePath: boolean;
  status?: string;
}>;

export type InspectorTreeView = Readonly<{
  entries: readonly InspectorTreeEntryView[];
}>;

export function projectInspectorContextView(
  context: CurrentContextUsage | null,
): InspectorContextView {
  if (!context) {
    return {
      available: false,
      currentInput: "—",
      contextWindow: "—",
      utilization: "—",
      utilizationRatio: null,
      inputBudget: "—",
      reservedOutput: "—",
      safetyMargin: "—",
      counterId: "—",
      quality: "unavailable",
    };
  }

  return {
    available: true,
    currentInput: formatTokens(context.estimatedInputTokens),
    contextWindow: formatTokens(context.contextWindowTokens),
    utilization: `${(context.utilizationRatio * 100).toFixed(1)}%`,
    utilizationRatio: context.utilizationRatio,
    inputBudget: formatTokens(context.inputBudgetTokens),
    reservedOutput: formatTokens(context.reservedOutputTokens),
    safetyMargin: formatTokens(context.safetyMarginTokens),
    counterId: context.tokenCounterId,
    quality: context.tokenCountQuality,
  };
}

export function projectInspectorUsageView(input: {
  usage: SessionUsageSummary;
  usagePersistenceIncomplete: boolean;
}): InspectorUsageView {
  const { usage } = input;
  const cacheCoverage = degradeCoverage(
    usage.cache.coverage,
    input.usagePersistenceIncomplete,
  );
  const costCoverage = degradeCoverage(
    usage.cost.coverage,
    input.usagePersistenceIncomplete,
  );

  return {
    inputTotal: formatOptionalTokens(usage.tokens.inputTotal),
    inputNoCache: formatOptionalTokens(usage.tokens.inputNoCache),
    cacheRead: formatOptionalTokens(usage.tokens.cacheRead),
    cacheWrite: formatOptionalTokens(usage.tokens.cacheWrite),
    outputTotal: formatOptionalTokens(usage.tokens.outputTotal),
    outputText: formatOptionalTokens(usage.tokens.text),
    outputReasoning: formatOptionalTokens(usage.tokens.reasoning),
    cacheHit: usage.cache.hitRate === undefined
      ? "—"
      : `${(usage.cache.hitRate * 100).toFixed(1)}%`,
    cacheCoverage,
    apiCost: formatCost(usage.cost.totalUsd, costCoverage),
    costCoverage,
    completedSteps: String(usage.completedStepCount),
    integrity: usage.integrity,
    persistenceIncomplete: input.usagePersistenceIncomplete,
  };
}

export function projectInspectorTreeView(
  navigation: SessionNavigationTree,
): InspectorTreeView {
  const byId = new Map(navigation.nodes.map((node) => [node.id, node]));
  const activePathIds = new Set<string>();
  let cursor = navigation.nodes.find((node) => node.active) ?? null;
  while (cursor) {
    activePathIds.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) ?? null : null;
  }
  return {
    entries: navigation.nodes.map((node) => Object.freeze({
      id: node.id,
      label: semanticEntryLabel(node.type),
      preview: boundPreview(node.preview),
      depth: node.depth,
      createdAt: node.createdAt,
      navigationTargetEntryId: node.navigationTargetEntryId,
      selectable: node.selectable,
      active: node.active,
      activePath: activePathIds.has(node.id),
      ...(node.status ? { status: node.status } : {}),
    })),
  };
}

function degradeCoverage(
  coverage: "complete" | "partial" | "none",
  persistenceIncomplete: boolean,
) {
  if (!persistenceIncomplete || coverage === "none") return coverage;
  return "partial" as const;
}

function formatOptionalTokens(value: number | undefined) {
  return value === undefined ? "—" : formatTokens(value);
}

function formatTokens(value: number) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${stripTrailingZero((value / 1_000).toFixed(1))}k`;
  return `${stripTrailingZero((value / 1_000_000).toFixed(1))}m`;
}

function formatCost(
  value: number | undefined,
  coverage: "complete" | "partial" | "none",
) {
  if (value === undefined) return "—";
  return `$${value.toFixed(4)}${coverage === "partial" ? "+" : ""}`;
}

function stripTrailingZero(value: string) {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

function semanticEntryLabel(type: string) {
  switch (type) {
    case "user_message": return "User";
    case "assistant_message": return "Assistant";
    case "custom_message": return "Message";
    case "tool_use": return "ToolUse";
    case "compaction": return "Compaction";
    case "branch_summary": return "Branch Summary";
    case "error": return "Error";
    default: return type.replaceAll("_", " ");
  }
}

function boundPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 120)}...`;
}
