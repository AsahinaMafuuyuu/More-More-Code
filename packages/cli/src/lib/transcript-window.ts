import type { Message } from "./chat-types";

export const DEFAULT_TRANSCRIPT_WINDOW_MESSAGES = 160;
export const DEFAULT_TRANSCRIPT_ROUND_BOUNDARY_ALLOWANCE = 32;

export type TranscriptMessageSource = {
  count: number;
  getMessage(index: number): Message | undefined;
};

export type TranscriptWindow = Readonly<{
  messages: readonly Message[];
  startIndex: number;
  endIndex: number;
  hiddenMessageCount: number;
}>;

/**
 * Materialize only a bounded recent suffix for the retained TUI tree.
 *
 * The projection scans backwards at most `maxMessages + boundaryAllowance`
 * entries regardless of total Session depth. If the default cut falls inside a
 * conversation round, it may pull a small bounded prefix backward to the
 * nearest user message so the visible suffix starts on a semantic boundary.
 */
export function projectTranscriptWindow(
  source: TranscriptMessageSource,
  options: {
    maxMessages?: number;
    boundaryAllowance?: number;
  } = {},
): TranscriptWindow {
  const maxMessages = normalizePositiveInteger(
    options.maxMessages,
    DEFAULT_TRANSCRIPT_WINDOW_MESSAGES,
  );
  const boundaryAllowance = normalizeNonNegativeInteger(
    options.boundaryAllowance,
    DEFAULT_TRANSCRIPT_ROUND_BOUNDARY_ALLOWANCE,
  );
  const count = Math.max(0, Math.floor(source.count));
  if (count === 0) {
    return {
      messages: [],
      startIndex: 0,
      endIndex: 0,
      hiddenMessageCount: 0,
    };
  }

  let startIndex = Math.max(0, count - maxMessages);
  if (startIndex > 0 && source.getMessage(startIndex)?.role !== "user") {
    const boundaryFloor = Math.max(0, startIndex - boundaryAllowance);
    for (let index = startIndex - 1; index >= boundaryFloor; index -= 1) {
      if (source.getMessage(index)?.role !== "user") continue;
      startIndex = index;
      break;
    }
  }

  const messages: Message[] = [];
  for (let index = startIndex; index < count; index += 1) {
    const message = source.getMessage(index);
    if (message) messages.push(message);
  }

  return {
    messages,
    startIndex,
    endIndex: count,
    hiddenMessageCount: startIndex,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.max(0, Math.floor(value));
}
