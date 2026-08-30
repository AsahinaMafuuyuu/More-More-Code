import {
  createHeuristicTokenCounter,
  type ModelContextProfile,
  type TokenCounter,
} from "@more-more-code/harness";
import {
  findSupportedChatModel,
  type ModelRef,
  type ProviderKind,
} from "@more-more-code/shared";

const providerCounters: Record<ProviderKind, TokenCounter> = {
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
  custom: createHeuristicTokenCounter({
    id: "openai-compatible-estimator-v1",
    latinCharsPerToken: 3.8,
    cjkCharsPerToken: 1.35,
  }),
};

type StaticProfile = Omit<ModelContextProfile, "tokenCounter">;

const DEFAULT_CONTEXT_REDUCTION_POLICY = {
  compactionSoftLimitRatio: 0.8,
  compactionHardLimitRatio: 0.92,
  postCompactionTargetRatio: 0.7,
  retainRecentMinTokens: 8_192,
  retainRecentRatio: 0.1,
  allowSplitCompactionGroup: true,
  toolResultWorkingSetRatio: 0.25,
  toolResultFullThresholdRatio: 0.06,
  toolResultReferenceRatio: 0.006,
} as const;

const DEFAULT_MODEL_CONTEXT_POLICY: StaticProfile = {
  contextWindowTokens: 128_000,
  reservedOutputTokens: 12_288,
  safetyMarginTokens: 4_096,
  retainedTailTurns: 3,
  maxSummaryTokens: 2_048,
};

const PROVIDER_DEFAULT_POLICIES: Record<ProviderKind, StaticProfile> = {
  openai: { ...DEFAULT_MODEL_CONTEXT_POLICY, reservedOutputTokens: 16_384 },
  anthropic: {
    ...DEFAULT_MODEL_CONTEXT_POLICY,
    contextWindowTokens: 200_000,
    reservedOutputTokens: 16_384,
    safetyMarginTokens: 6_144,
    maxSummaryTokens: 3_072,
  },
  google: {
    ...DEFAULT_MODEL_CONTEXT_POLICY,
    reservedOutputTokens: 16_384,
    safetyMarginTokens: 6_144,
    maxSummaryTokens: 3_072,
  },
  deepseek: { ...DEFAULT_MODEL_CONTEXT_POLICY },
  custom: { ...DEFAULT_MODEL_CONTEXT_POLICY },
};

const MODEL_CONTEXT_POLICIES: Record<string, StaticProfile> = {
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
  "deepseek-v4-flash": { ...DEFAULT_MODEL_CONTEXT_POLICY },
  "deepseek-v4-pro": {
    ...DEFAULT_MODEL_CONTEXT_POLICY,
    reservedOutputTokens: 16_384,
  },
};

/**
 * Resolve a deterministic Context budget for any configured model. Recommended
 * model metadata sharpens the defaults, while unknown configured model IDs use
 * a conservative provider-level fallback instead of becoming unsupported.
 */
export function resolveModelContextProfile(
  modelRef: ModelRef,
  providerKind: ProviderKind,
): ModelContextProfile {
  const recommended = findSupportedChatModel(modelRef.modelId);
  const policy = recommended && recommended.provider === providerKind
    ? MODEL_CONTEXT_POLICIES[modelRef.modelId] ?? PROVIDER_DEFAULT_POLICIES[providerKind]
    : PROVIDER_DEFAULT_POLICIES[providerKind];
  return {
    ...DEFAULT_CONTEXT_REDUCTION_POLICY,
    ...policy,
    tokenCounter: providerCounters[providerKind],
  };
}
