export const CLEANUP_TIMEOUT_MS = 45_000;
export const CLEANUP_CLOUD_MODEL = "gpt-4o-mini";

/** A cleanup has to keep at least half the tokens. Less is a summary. */
const MIN_KEPT_SHARE = 0.5;

export const CLEANUP_INSTRUCTIONS = `Clean this speech transcript. Keep every word the speaker said, verbatim and in order.
Remove only um, uh, er, ah, false starts, and immediate stutter repeats.
Remove like, you know, I mean, and sort of only when they carry no meaning.
Fix punctuation and capitalization. Paragraph breaks are fine.
Never substitute synonyms, reorder, merge or split ideas into new wording, change tense, expand or contract words, convert number words, or add words.
Reply with the cleaned transcript only, with no preamble and no quotes.`;

export interface CleanupRequest {
  instructions: string;
  prompt: string;
}

export interface CleanupOutcome {
  body: string;
  cleaned: boolean;
  transcript: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isList = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

const FENCE = /^```[a-z]*\n(?<body>[\s\S]*?)\n```$/u;

export const cleanupRequest = (transcript: string): CleanupRequest => ({
  instructions: CLEANUP_INSTRUCTIONS,
  prompt: transcript.trim(),
});

export const chatCompletionsUrl = (base: string): string => {
  const trimmed = base.trim().replace(/\/+$/u, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const parseCleanupResponse = (raw: string): string | null => {
  let text = raw.trim();
  const body = FENCE.exec(text)?.groups?.body;
  if (typeof body === "string" && body.length > 0) {
    text = body.trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.length > 0 ? text : null;
};

const CURLY_APOSTROPHE = /[‘’ʼ]/gu;
const NOT_A_WORD = /[^\p{L}\p{M}\p{N}']+/gu;

/** Lowercase words. Punctuation drops; apostrophes stay, so contractions don't split. */
const wordTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replaceAll(CURLY_APOSTROPHE, "'")
    .split(/\s+/u)
    .flatMap((word) => {
      const token = word.replaceAll(NOT_A_WORD, "");
      return token.length > 0 ? [token] : [];
    });

const deletionsOnly = (
  cleaned: readonly string[],
  transcript: readonly string[]
): boolean => {
  let next = 0;
  for (const token of transcript) {
    if (next < cleaned.length && token === cleaned[next]) {
      next += 1;
    }
  }
  return next === cleaned.length;
};

/** Deletions only: the speaker's words, in order, and at least half of them. */
export const acceptCleanup = (transcript: string, cleaned: string): boolean => {
  const before = wordTokens(transcript);
  const after = wordTokens(cleaned);
  if (before.length === 0 || after.length === 0) {
    return false;
  }
  if (after.length < before.length * MIN_KEPT_SHARE) {
    return false;
  }
  return deletionsOnly(after, before);
};

export const parseChatCompletion = (payload: unknown): string | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const { choices } = payload;
  if (!isList(choices)) {
    return null;
  }
  const [first] = choices;
  if (!isRecord(first)) {
    return null;
  }
  const { message } = first;
  if (!isRecord(message)) {
    return null;
  }
  const { content } = message;
  return typeof content === "string" ? content : null;
};

const rawOutcome = (transcript: string): CleanupOutcome => ({
  body: transcript,
  cleaned: false,
  transcript,
});

export const settleCleanup = async (
  transcript: string,
  ask: (request: CleanupRequest, signal: AbortSignal) => Promise<string>,
  timeoutMs: number,
  parent?: AbortSignal
): Promise<CleanupOutcome> => {
  const raw = transcript.trim();
  if (raw.length === 0) {
    return rawOutcome("");
  }
  const signal =
    parent === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([AbortSignal.timeout(timeoutMs), parent]);
  try {
    const reply = await ask(cleanupRequest(raw), signal);
    const cleaned = parseCleanupResponse(reply);
    if (cleaned === null || !acceptCleanup(raw, cleaned)) {
      return rawOutcome(raw);
    }
    return {
      body: cleaned,
      cleaned: cleaned !== raw,
      transcript: raw,
    };
  } catch {
    return rawOutcome(raw);
  }
};
