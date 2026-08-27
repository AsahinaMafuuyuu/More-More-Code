export type MentionMatch = {
  start: number;
  end: number;
  query: string;
};

export type MentionCandidate = {
  path: string;
  kind: "file" | "directory";
};

const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;

function isMentionQueryCharacter(char: string): boolean {
  return MENTION_QUERY_CHARACTER.test(char);
}

export function findActiveMention(text: string, cursorOffset: number): MentionMatch | null {
  const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));
  let start = safeOffset;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1;

  let end = safeOffset;
  while (end < text.length && !/\s/.test(text[end]!)) end += 1;

  const token = text.slice(start, end);
  const relativeCursor = safeOffset - start;
  const mentionStart = token.lastIndexOf("@", relativeCursor);
  if (mentionStart === -1) return null;

  const previous = token[mentionStart - 1];
  if (previous && isMentionQueryCharacter(previous)) return null;

  let mentionEnd = mentionStart + 1;
  while (mentionEnd < token.length && isMentionQueryCharacter(token[mentionEnd]!)) {
    mentionEnd += 1;
  }
  if (relativeCursor < mentionStart || relativeCursor > mentionEnd) return null;

  return {
    start: start + mentionStart,
    end: start + mentionEnd,
    query: token.slice(mentionStart + 1, mentionEnd),
  };
}

export function replaceActiveMention(input: {
  text: string;
  mention: MentionMatch;
  candidate: MentionCandidate;
}) {
  const insertion = input.candidate.kind === "directory"
    ? input.candidate.path
    : `${input.candidate.path} `;
  const text = `${input.text.slice(0, input.mention.start)}@${insertion}${input.text.slice(input.mention.end)}`;
  return {
    text,
    cursorOffset: input.mention.start + insertion.length + 1,
  };
}
