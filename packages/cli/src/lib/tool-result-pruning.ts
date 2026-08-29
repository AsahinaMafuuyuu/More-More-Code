import { getToolName, isToolUIPart } from "./chat-types";
import {
  ToolResultWorkingSetManager,
  type ModelContextProfile,
  type ToolResultFreshness,
  type ToolResultProjection,
  type ToolResultProjectionCandidate,
  type ToolResultProjectionMode,
  type ToolResultPruningReason,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";

export type ToolResultPruningStats = {
  budgetTokens: number;
  originalTokens: number;
  projectedTokens: number;
  prunedResults: number;
  overBudget: boolean;
};

export type ToolResultWorkingSetOutput = {
  messages: Message[];
  stats: ToolResultPruningStats;
};

type ToolPartLocation = {
  candidate: ToolResultProjectionCandidate<unknown>;
  messageIndex: number;
  partIndex: number;
  state: "output-available" | "output-error";
};

type ProjectionEnvelope = {
  type: "more-more-code.tool-result-projection";
  mode: Exclude<ToolResultProjectionMode, "full">;
  toolName: string;
  toolCallId: string;
  status?: string;
  source: string;
  originalTokens: number;
  content: string;
};

function serialize(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getSourceReference(candidate: ToolResultProjectionCandidate<unknown>) {
  // A Session Entry lookup may become available after this result has already
  // crossed the provider boundary. Keep the model-visible source handle stable
  // so warming that lookup cannot rewrite a cached conversation prefix.
  return `tool-call:${candidate.toolCallId}`;
}

function createEnvelope(
  candidate: ToolResultProjectionCandidate<unknown>,
  mode: Exclude<ToolResultProjectionMode, "full">,
  content: string,
): ProjectionEnvelope {
  return {
    type: "more-more-code.tool-result-projection",
    mode,
    toolName: candidate.toolName,
    toolCallId: candidate.toolCallId,
    ...(candidate.status ? { status: candidate.status } : {}),
    source: getSourceReference(candidate),
    originalTokens: candidate.estimatedTokens,
    content,
  };
}

function fitEnvelope(input: {
  candidate: ToolResultProjectionCandidate<unknown>;
  mode: Exclude<ToolResultProjectionMode, "full">;
  content: string;
  targetTokens: number;
  profile: ModelContextProfile;
}) {
  const direct = createEnvelope(input.candidate, input.mode, input.content);
  const directTokens = input.profile.tokenCounter.countPayload(direct);
  if (directTokens <= input.targetTokens) {
    return { payload: direct as unknown, tokens: directTokens };
  }

  const suffix = "\n[… tool result projection truncated …]";
  let low = 0;
  let high = input.content.length;
  let best: { payload: unknown; tokens: number } | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const content = `${input.content.slice(0, middle).trimEnd()}${suffix}`;
    const payload = createEnvelope(input.candidate, input.mode, content);
    const tokens = input.profile.tokenCounter.countPayload(payload);
    if (tokens <= input.targetTokens) {
      best = { payload, tokens };
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best) return best;

  const reference = `[tool ${input.candidate.toolName} status=${input.candidate.status ?? "unknown"} result omitted; source=${getSourceReference(input.candidate)}]`;
  const referenceTokens = input.profile.tokenCounter.countPayload(reference);
  if (referenceTokens <= input.targetTokens) {
    return { payload: reference as unknown, tokens: referenceTokens };
  }

  // This path is only relevant for unrealistically tiny synthetic budgets. The
  // empty projection is explicit and bounded; the durable Session source still exists.
  return { payload: "" as unknown, tokens: input.profile.tokenCounter.countPayload("") };
}

function selectLines(text: string, matcher: RegExp, maxMatches: number) {
  return text
    .split(/\r?\n/)
    .filter((line) => matcher.test(line))
    .slice(0, maxMatches);
}

function headTail(text: string, headLines: number, tailLines: number) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= headLines + tailLines) return lines;
  return [
    ...lines.slice(0, headLines),
    `[… ${Math.max(0, lines.length - headLines - tailLines)} lines omitted …]`,
    ...lines.slice(-tailLines),
  ];
}

function classifyTool(candidate: ToolResultProjectionCandidate<unknown>) {
  if (candidate.toolName === "bash") {
    const command = typeof candidate.input === "object" && candidate.input !== null
      ? String((candidate.input as { command?: unknown }).command ?? "")
      : "";
    if (/\b(test|vitest|jest|pytest|bun\s+test|npm\s+(run\s+)?test|build|tsc|typecheck|lint)\b/i.test(command)) {
      return "test-build" as const;
    }
    return "shell" as const;
  }
  if (["grep", "glob", "listDirectory"].includes(candidate.toolName)) return "search" as const;
  if (["readFile", "loadSkill"].includes(candidate.toolName)) return "file" as const;
  return "generic" as const;
}

function shellProjection(candidate: ToolResultProjectionCandidate<unknown>) {
  const record = typeof candidate.payload === "object" && candidate.payload !== null
    ? candidate.payload as Record<string, unknown>
    : null;
  if (!record) return headTail(serialize(candidate.payload), 12, 12).join("\n");

  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const exitCode = record.exitCode;
  const errorLines = selectLines(`${stderr}\n${stdout}`, /error|fail|fatal|panic|exception|denied|timed?\s*out/i, 24);
  return [
    `exitCode=${String(exitCode ?? "unknown")}`,
    errorLines.length > 0 ? `important:\n${errorLines.join("\n")}` : "",
    stdout ? `stdout:\n${headTail(stdout, 10, 10).join("\n")}` : "",
    stderr ? `stderr:\n${headTail(stderr, 10, 10).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

function testBuildProjection(candidate: ToolResultProjectionCandidate<unknown>) {
  const record = typeof candidate.payload === "object" && candidate.payload !== null
    ? candidate.payload as Record<string, unknown>
    : null;
  const stdout = record && typeof record.stdout === "string" ? record.stdout : "";
  const stderr = record && typeof record.stderr === "string" ? record.stderr : "";
  const text = stdout || stderr
    ? [stdout, stderr].filter(Boolean).join("\n")
    : serialize(candidate.payload);
  const important = selectLines(
    text,
    /fail|failed|error|warning|warn|not ok|exception|panic|×|✗|ts\d{4}/i,
    48,
  );
  return [
    `exitCode=${String(record?.exitCode ?? "unknown")}`,
    important.length > 0 ? "important failures/warnings:" : "",
    ...important,
    "context:",
    ...headTail(text, 8, 8),
  ].filter(Boolean).join("\n");
}

function searchProjection(candidate: ToolResultProjectionCandidate<unknown>) {
  const record = typeof candidate.payload === "object" && candidate.payload !== null
    ? candidate.payload as Record<string, unknown>
    : null;
  if (record && Array.isArray(record.matches)) {
    const matches = record.matches.slice(0, 32).map((match) => {
      const value = match as Record<string, unknown>;
      return `${String(value.file ?? "?")}:${String(value.line ?? "?")}: ${String(value.content ?? "")}`;
    });
    return [
      `matches=${record.matches.length}`,
      ...matches,
      record.matches.length > matches.length ? "[… additional matches omitted …]" : "",
    ].filter(Boolean).join("\n");
  }
  return headTail(serialize(candidate.payload), 24, 8).join("\n");
}

function fileProjection(candidate: ToolResultProjectionCandidate<unknown>) {
  const record = typeof candidate.payload === "object" && candidate.payload !== null
    ? candidate.payload as Record<string, unknown>
    : null;
  const content = record && typeof record.content === "string"
    ? record.content
    : serialize(candidate.payload);
  return headTail(content, 20, 12).join("\n");
}

function genericProjection(candidate: ToolResultProjectionCandidate<unknown>) {
  return headTail(serialize(candidate.payload), 16, 12).join("\n");
}

export function projectToolResultCandidate(input: {
  candidate: ToolResultProjectionCandidate<unknown>;
  targetTokens: number;
  reason: Exclude<ToolResultPruningReason, "within-budget">;
  profile: ModelContextProfile;
}): ToolResultProjection<unknown> {
  const strategy = classifyTool(input.candidate);
  const content = strategy === "shell"
    ? shellProjection(input.candidate)
    : strategy === "test-build"
      ? testBuildProjection(input.candidate)
      : strategy === "search"
        ? searchProjection(input.candidate)
        : strategy === "file"
          ? fileProjection(input.candidate)
          : genericProjection(input.candidate);
  const preferredMode: Exclude<ToolResultProjectionMode, "full"> = input.reason === "reference-eligible"
    ? "reference"
    : strategy === "shell" || strategy === "test-build" || strategy === "search"
      ? "summary"
      : "truncated";
  const referenceContent = input.reason === "reference-eligible"
    ? `Durable result available at ${getSourceReference(input.candidate)}.`
    : content;
  const fitted = fitEnvelope({
    candidate: input.candidate,
    mode: preferredMode,
    content: referenceContent,
    targetTokens: input.targetTokens,
    profile: input.profile,
  });

  return {
    ...input.candidate,
    mode: preferredMode,
    projectedPayload: fitted.payload,
    projectedTokens: fitted.tokens,
    reason: input.reason,
  };
}

function resultFreshness(messageIndex: number, resultMessageIndexes: readonly number[]): ToolResultFreshness {
  const position = resultMessageIndexes.indexOf(messageIndex);
  if (position === resultMessageIndexes.length - 1) return "fresh";
  if (position === resultMessageIndexes.length - 2) return "warm";
  return "cold";
}

function collectToolResultLocations(input: {
  messages: readonly Message[];
  profile: ModelContextProfile;
  resolveSourceEntryId?: (toolCallId: string) => string | undefined;
}) {
  const resultMessageIndexes = input.messages
    .map((message, messageIndex) => ({
      messageIndex,
      hasResult: message.parts.some((part) => {
        if (!isToolUIPart(part)) return false;
        const state = (part as unknown as { state?: string }).state;
        return state === "output-available" || state === "output-error";
      }),
    }))
    .filter(({ hasResult }) => hasResult)
    .map(({ messageIndex }) => messageIndex);
  const locations: ToolPartLocation[] = [];

  input.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      if (!isToolUIPart(part)) return;
      const record = part as unknown as Record<string, unknown>;
      const state = record.state;
      if (state !== "output-available" && state !== "output-error") return;
      const toolCallId = String(record.toolCallId ?? "");
      const toolName = getToolName(part);
      const payload = state === "output-available"
        ? record.output
        : { error: String(record.errorText ?? "Tool execution failed") };
      const freshness = resultFreshness(messageIndex, resultMessageIndexes);
      locations.push({
        messageIndex,
        partIndex,
        state,
        candidate: {
          id: `${message.id}:${toolCallId}`,
          toolCallId,
          toolName,
          status: state === "output-available" ? "completed" : "failed",
          input: record.input,
          payload,
          estimatedTokens: input.profile.tokenCounter.countPayload(payload),
          freshness,
          required: freshness === "fresh",
          ...(input.resolveSourceEntryId?.(toolCallId)
            ? { sourceEntryId: input.resolveSourceEntryId(toolCallId) }
            : {}),
        },
      });
    });
  });
  return locations;
}

/**
 * Creates a model-facing Tool Result working set without changing the durable
 * UI-message/Session payloads supplied by the caller.
 */
export function projectToolResultWorkingSet(input: {
  messages: readonly Message[];
  profile: ModelContextProfile;
  inputBudgetTokens: number;
  resolveSourceEntryId?: (toolCallId: string) => string | undefined;
}): ToolResultWorkingSetOutput {
  const locations = collectToolResultLocations(input);
  if (locations.length === 0) {
    return {
      messages: structuredClone(input.messages) as Message[],
      stats: {
        budgetTokens: Math.floor(input.inputBudgetTokens * (input.profile.toolResultWorkingSetRatio ?? 0.25)),
        originalTokens: 0,
        projectedTokens: 0,
        prunedResults: 0,
        overBudget: false,
      },
    };
  }

  const manager = new ToolResultWorkingSetManager<unknown>();
  const workingSet = manager.project(
    locations.map(({ candidate }) => candidate),
    input.inputBudgetTokens,
    {
      project(request) {
        return projectToolResultCandidate({ ...request, profile: input.profile });
      },
    },
    {
      maxWorkingSetRatio: input.profile.toolResultWorkingSetRatio,
      fullResultRatio: input.profile.toolResultFullThresholdRatio,
      referenceResultRatio: input.profile.toolResultReferenceRatio,
    },
  );

  const messages = structuredClone(input.messages) as Message[];
  workingSet.results.forEach((result, index) => {
    if (result.mode === "full") return;
    const location = locations[index]!;
    const part = messages[location.messageIndex]!.parts[location.partIndex] as unknown as Record<string, unknown>;
    if (location.state === "output-available") {
      part.output = result.projectedPayload;
    } else {
      part.errorText = serialize(result.projectedPayload);
    }
  });

  return {
    messages,
    stats: {
      budgetTokens: workingSet.budgetTokens,
      originalTokens: workingSet.originalTokens,
      projectedTokens: workingSet.projectedTokens,
      prunedResults: workingSet.results.filter((result) => result.mode !== "full").length,
      overBudget: workingSet.overBudget,
    },
  };
}
