export type TokenCountAccuracy = "exact" | "estimated";

export type TokenCounter = {
  id: string;
  accuracy: TokenCountAccuracy;
  countText(text: string): number;
  countPayload(value: unknown): number;
};

export type ModelContextProfile = {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  retainedTailTurns: number;
  maxSummaryTokens: number;
  tokenCounter: TokenCounter;
};

type HeuristicTokenCounterOptions = {
  id: string;
  latinCharsPerToken: number;
  cjkCharsPerToken?: number;
  structuralOverheadTokens?: number;
};

function assertPositive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function isCjk(char: string) {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x3400 && code <= 0x9fff)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0xac00 && code <= 0xd7af);
}

/**
 * Provider-calibrated fallback counter. The adapter is intentionally explicit
 * about being estimated so an exact tokenizer can replace it without changing
 * ContextManager or model-profile APIs.
 */
export function createHeuristicTokenCounter(
  options: HeuristicTokenCounterOptions,
): TokenCounter {
  assertPositive(options.latinCharsPerToken, "latinCharsPerToken");
  assertPositive(options.cjkCharsPerToken ?? 1.5, "cjkCharsPerToken");
  const cjkCharsPerToken = options.cjkCharsPerToken ?? 1.5;
  const overhead = Math.max(0, Math.floor(options.structuralOverheadTokens ?? 4));

  const countText = (text: string) => {
    if (text.length === 0) return 0;
    let latin = 0;
    let cjk = 0;
    for (const char of text) {
      if (isCjk(char)) cjk += 1;
      else latin += 1;
    }
    return Math.max(
      1,
      Math.ceil(latin / options.latinCharsPerToken)
        + Math.ceil(cjk / cjkCharsPerToken),
    );
  };

  return {
    id: options.id,
    accuracy: "estimated",
    countText,
    countPayload(value: unknown) {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      return countText(serialized) + overhead;
    },
  };
}

export function createExactTokenCounter(options: {
  id: string;
  countText(text: string): number;
  serialize?: (value: unknown) => string;
  structuralOverheadTokens?: number;
}): TokenCounter {
  const overhead = Math.max(0, Math.floor(options.structuralOverheadTokens ?? 0));
  return {
    id: options.id,
    accuracy: "exact",
    countText: options.countText,
    countPayload(value: unknown) {
      const serialized = options.serialize
        ? options.serialize(value)
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
      return Math.max(0, Math.ceil(options.countText(serialized))) + overhead;
    },
  };
}
