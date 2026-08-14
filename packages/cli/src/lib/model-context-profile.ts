import {
  createHeuristicTokenCounter,
  type ModelContextProfile,
  type TokenCounter,
} from "@more-more-code/harness";
import {
  findSupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@more-more-code/shared";

const providerCounters: Record<SupportedProvider, TokenCounter> = {
  openai: createHeuristicTokenCounter({
    id: "openai-estimator-v1",
    latinCharsPerToken: 3.8,
    cjkCharsPerToken: 1.35,
  }),
  anthropic: createHeuristicTokenCounter({
    id: "anthropic-estimator-v1",
    latinCharsPerToken: 3.6,
    cjkCharsPerToken: 1.3,
  }),
  deepseek: createHeuristicTokenCounter({
    id: "deepseek-estimator-v1",
    latinCharsPerToken: 3.5,
    cjkCharsPerToken: 1.25,
  }),
  google: createHeuristicTokenCounter({
    id: "google-estimator-v1",
    latinCharsPerToken: 3.8,
    cjkCharsPerToken: 1.35,
  }),
  mistral: createHeuristicTokenCounter({
    id: "mistral-estimator-v1",
    latinCharsPerToken: 3.7,
    cjkCharsPerToken: 1.35,
  }),
};

type StaticProfile = Omit<ModelContextProfile, "tokenCounter">;

const DEFAULT_CONTEXT_REDUCTION_POLICY = {
  compactionSoftLimitRatio: 0.8,
  compactionHardLimitRatio: 0.92,
  postCompactionTargetRatio: 0.7,
  toolResultWorkingSetRatio: 0.25,
  toolResultFullThresholdRatio: 0.06,
  toolResultReferenceRatio: 0.006,
} as const;

// These are conservative application policies, not claims about a provider's
// absolute maximum. Keeping them here makes model-specific budgeting explicit
// and easy to override when an exact provider/model limit is configured.
const MODEL_CONTEXT_POLICIES: Record<SupportedChatModelId, StaticProfile> = {
  "gpt-5.5": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 16_384,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "gpt-5.4-mini": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 12_288,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "claude-sonnet-5": {
    contextWindowTokens: 200_000,
    reservedOutputTokens: 16_384,
    safetyMarginTokens: 6_144,
    retainedTailTurns: 3,
    maxSummaryTokens: 3_072,
  },
  "claude-haiku-4-5": {
    contextWindowTokens: 200_000,
    reservedOutputTokens: 12_288,
    safetyMarginTokens: 6_144,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "mistral-medium-latest": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 12_288,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "mistral-small-latest": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 8_192,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "gemini-2.5-flash": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 16_384,
    safetyMarginTokens: 6_144,
    retainedTailTurns: 3,
    maxSummaryTokens: 3_072,
  },
  "gemini-2.5-flash-lite": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 12_288,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "deepseek-v4-flash": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 12_288,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
  "deepseek-v4-pro": {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 16_384,
    safetyMarginTokens: 4_096,
    retainedTailTurns: 3,
    maxSummaryTokens: 2_048,
  },
};

export function resolveModelContextProfile(modelId: SupportedChatModelId): ModelContextProfile {
  const definition = findSupportedChatModel(modelId);
  if (!definition) throw new Error(`Unsupported chat model: ${modelId}`);
  const policy = MODEL_CONTEXT_POLICIES[modelId];
  return {
    ...DEFAULT_CONTEXT_REDUCTION_POLICY,
    ...policy,
    tokenCounter: providerCounters[definition.provider],
  };
}
