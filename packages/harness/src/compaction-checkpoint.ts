import { createHash } from "node:crypto";
import type {
  CompactionCheckpointFact,
  CompactionCheckpointState,
  CompactionCheckpointV2,
  CompactionPlan,
} from "./context";

const SECTION_ORDER: ReadonlyArray<{
  key: keyof CompactionCheckpointState;
  heading: string;
}> = [
  { key: "currentGoal", heading: "Current Goal" },
  { key: "currentState", heading: "Current State" },
  { key: "decisions", heading: "Decisions" },
  { key: "constraints", heading: "Constraints" },
  { key: "artifacts", heading: "Artifacts" },
  { key: "failuresAndLessons", heading: "Failures and Lessons" },
  { key: "pendingWork", heading: "Pending Work" },
];

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function digest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createEmptyCompactionCheckpointState(): CompactionCheckpointState {
  return {
    currentGoal: [],
    currentState: [],
    decisions: [],
    constraints: [],
    artifacts: [],
    failuresAndLessons: [],
    pendingWork: [],
  };
}

/** Provider-visible rendering is derived from structured state, never authored independently. */
export function renderCompactionCheckpointState(state: CompactionCheckpointState): string {
  return SECTION_ORDER.map(({ key, heading }) => {
    const facts = state[key];
    const body = facts.length === 0
      ? "None"
      : facts.map((fact) => `- ${fact.text}`).join("\n");
    return `## ${heading}\n${body}`;
  }).join("\n\n");
}

function requiredAnchorIds(plan: CompactionPlan) {
  return plan.requiredAnchors
    .filter((anchor) => anchor.priority === "P0")
    .map((anchor) => anchor.id)
    .sort();
}

function checkpointIdentity(input: {
  planId: string;
  state: CompactionCheckpointState;
  quality: CompactionCheckpointV2["validation"]["quality"];
  requiredAnchorIds: readonly string[];
  coveredAnchorIds: readonly string[];
}) {
  return digest(input);
}

export function createCompactionCheckpointV2(input: {
  plan: CompactionPlan;
  state: CompactionCheckpointState;
  quality: CompactionCheckpointV2["validation"]["quality"];
  coveredAnchorIds: readonly string[];
}): CompactionCheckpointV2 {
  const requiredIds = requiredAnchorIds(input.plan);
  const coveredIds = [...new Set(input.coveredAnchorIds)].sort();
  const renderedSummary = renderCompactionCheckpointState(input.state);
  const checkpointId = checkpointIdentity({
    planId: input.plan.planId,
    state: input.state,
    quality: input.quality,
    requiredAnchorIds: requiredIds,
    coveredAnchorIds: coveredIds,
  });
  return {
    version: 2,
    checkpointId,
    baseCheckpointId: input.plan.baseCheckpointId,
    policyVersion: input.plan.policyVersion,
    source: {
      recordIds: [...input.plan.sourceRecordIds],
      firstRecordId: input.plan.sourceRecordIds[0]!,
      lastRecordId: input.plan.sourceRecordIds.at(-1)!,
      sourceDigest: input.plan.sourceDigest,
    },
    trigger: input.plan.trigger,
    compactedThroughRecordId: input.plan.compactedThroughRecordId,
    retainedFromRecordId: input.plan.retainedFromRecordId,
    splitGroup: input.plan.splitGroup,
    state: structuredClone(input.state),
    validation: {
      quality: input.quality,
      requiredAnchorIds: requiredIds,
      coveredAnchorIds: coveredIds,
      sourceDigestVerified: true,
    },
    renderedSummary,
  };
}

export type CompactionCheckpointValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

function validateFact(
  fact: CompactionCheckpointFact,
  seenFactIds: Set<string>,
  allowedSourceIds: Set<string>,
  errors: string[],
) {
  if (!fact.id.trim()) errors.push("checkpoint fact id must be non-empty");
  if (seenFactIds.has(fact.id)) errors.push(`duplicate checkpoint fact id: ${fact.id}`);
  seenFactIds.add(fact.id);
  if (!fact.text.trim()) errors.push(`checkpoint fact ${fact.id} has empty text`);
  if (fact.sourceRecordIds.length === 0) {
    errors.push(`checkpoint fact ${fact.id} has no source provenance`);
  }
  for (const sourceRecordId of fact.sourceRecordIds) {
    if (!allowedSourceIds.has(sourceRecordId)) {
      errors.push(`checkpoint fact ${fact.id} references unknown source: ${sourceRecordId}`);
    }
  }
}

export function validateCompactionCheckpointV2(input: {
  checkpoint: CompactionCheckpointV2;
  plan: CompactionPlan;
  countRenderedTokens?: (text: string) => number;
}): CompactionCheckpointValidationResult {
  const { checkpoint, plan } = input;
  const errors: string[] = [];
  if (checkpoint.version !== 2) errors.push("checkpoint version must be 2");
  if (checkpoint.baseCheckpointId !== plan.baseCheckpointId) errors.push("base checkpoint mismatch");
  if (checkpoint.policyVersion !== plan.policyVersion) errors.push("policy version mismatch");
  if (checkpoint.trigger !== plan.trigger) errors.push("compaction trigger mismatch");
  if (checkpoint.source.sourceDigest !== plan.sourceDigest) errors.push("source digest mismatch");
  if (checkpoint.source.recordIds.join("\0") !== plan.sourceRecordIds.join("\0")) {
    errors.push("source record ids mismatch");
  }
  if (checkpoint.source.firstRecordId !== plan.sourceRecordIds[0]) errors.push("source first-record mismatch");
  if (checkpoint.source.lastRecordId !== plan.sourceRecordIds.at(-1)) errors.push("source last-record mismatch");
  if (checkpoint.compactedThroughRecordId !== plan.compactedThroughRecordId) {
    errors.push("compacted-through boundary mismatch");
  }
  if (checkpoint.retainedFromRecordId !== plan.retainedFromRecordId) errors.push("retained boundary mismatch");
  if (checkpoint.splitGroup !== plan.splitGroup) errors.push("split-group marker mismatch");
  if (checkpoint.validation.sourceDigestVerified !== true) errors.push("source digest is not marked verified");

  const expectedRequired = requiredAnchorIds(plan);
  if (checkpoint.validation.requiredAnchorIds.join("\0") !== expectedRequired.join("\0")) {
    errors.push("required anchor set mismatch");
  }
  const knownAnchorIds = new Set(plan.requiredAnchors.map((anchor) => anchor.id));
  const covered = new Set(checkpoint.validation.coveredAnchorIds);
  for (const anchorId of checkpoint.validation.coveredAnchorIds) {
    if (!knownAnchorIds.has(anchorId)) errors.push(`unknown covered anchor: ${anchorId}`);
  }
  for (const anchorId of expectedRequired) {
    if (!covered.has(anchorId)) errors.push(`missing required anchor: ${anchorId}`);
  }

  const allowedSourceIds = new Set(plan.provenanceRecordIds);
  const seenFactIds = new Set<string>();
  for (const { key } of SECTION_ORDER) {
    const facts = checkpoint.state[key];
    if (!Array.isArray(facts)) {
      errors.push(`checkpoint section ${key} is invalid`);
      continue;
    }
    for (const fact of facts) validateFact(fact, seenFactIds, allowedSourceIds, errors);
  }

  const rendered = renderCompactionCheckpointState(checkpoint.state);
  if (checkpoint.renderedSummary !== rendered) errors.push("rendered summary is not deterministic state rendering");
  if (input.countRenderedTokens && input.countRenderedTokens(rendered) > plan.maxCheckpointTokens) {
    errors.push("rendered checkpoint exceeds token budget");
  }

  const expectedCheckpointId = checkpointIdentity({
    planId: plan.planId,
    state: checkpoint.state,
    quality: checkpoint.validation.quality,
    requiredAnchorIds: checkpoint.validation.requiredAnchorIds,
    coveredAnchorIds: checkpoint.validation.coveredAnchorIds,
  });
  if (checkpoint.checkpointId !== expectedCheckpointId) errors.push("checkpoint identity mismatch");

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function assertRehydratedCheckpointEquivalent(
  candidate: CompactionCheckpointV2,
  rehydrated: CompactionCheckpointV2,
) {
  if (candidate.checkpointId !== rehydrated.checkpointId) {
    throw new Error("Persisted compaction checkpoint identity mismatch");
  }
  if (candidate.source.sourceDigest !== rehydrated.source.sourceDigest) {
    throw new Error("Persisted compaction checkpoint source digest mismatch");
  }
  if (candidate.renderedSummary !== rehydrated.renderedSummary) {
    throw new Error("Persisted compaction checkpoint rendering mismatch");
  }
}
