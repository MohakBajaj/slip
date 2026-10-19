export const CLEANUP_TIMEOUT_MS = 45_000;
export const CLEANUP_CLOUD_MODEL = "gpt-4o-mini";

/** A cleanup has to keep at least half the tokens. Less is a summary. */
const MIN_KEPT_SHARE = 0.5;

/**
 * Short on purpose: the on-device model follows a few imperatives and
 * copies examples, and a long list of prohibitions makes it delete less.
 * Examples are the transcript after the pre-pass, which is what the model sees.
 */
export const CLEANUP_INSTRUCTIONS = `Clean this transcript into a note. Delete words only. Never add, substitute, reorder, expand, or contract words, and never convert number words.

- Drop a filler when it adds nothing: okay so, I mean, like, you know, sort of, basically, or a trailing yeah that's kind of it. Drop false starts.
- Capitalize sentences and the word I. Add periods and commas.
- Split run-on sentences.
- Use a markdown bullet list when the speaker lists items.
- Put a blank line between topics.

Input: so I was thinking we should like you know move the standup to ten because half the team is in a different time zone and yeah that's kind of it
Output: I was thinking we should move the standup to ten because half the team is in a different time zone.

Input: okay so things to do tomorrow buy milk call the bank about the card and also finish the slip release notes
Output:
Things to do tomorrow:
- Buy milk.
- Call the bank about the card.
- Finish the slip release notes.

Input: I mean the thing is it's not really working I think we need to rethink the onboarding flow basically
Output: The thing is, it's not really working. I think we need to rethink the onboarding flow.

Reply with the note only, with no preamble and no quotes.`;

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

const CURLY_APOSTROPHE = /[‘’ʼ]/gu;
const NOT_A_WORD = /[^\p{L}\p{M}\p{N}']+/gu;
const EDGE_PUNCT = /^[^\p{L}\p{M}\p{N}']+|[^\p{L}\p{M}\p{N}']+$/gu;

/**
 * Pure fillers and stretched spellings. Not real words: a, am, him, hum, error, mum.
 * uh-huh and mm-hmm stay hyphenated; wordKey only strips punctuation at the edges.
 */
const FILLER =
  /^(?:u+h+m*|u+m+|u+h+u+h+|e+r+m*|a+h+|hm+|m{2,}|m+h+m+|uh-huh|uh-uh|mm-hmm|mmm-hmm|mm-hm)$/iu;

/**
 * Immediate repeats collapse ("the the", "that's that's", "we should we should").
 * These stay, because dropping one changes the sentence:
 * "had had", "that that", "gave her her", plus emphasis ("very very", "no no").
 * A third copy still drops, so "that that that" becomes "that that".
 */
const KEEP_DOUBLED = new Set([
  "had",
  "her",
  "no",
  "really",
  "that",
  "very",
  "yes",
]);

const PHRASE_SIZES = [3, 2] as const;

/** Line-start list markers. A spoken "1" in the middle of a line stays. */
const LIST_MARKER = /^[ \t]*(?:[-*+][ \t]+|\d{1,3}[.)][ \t]*)/gmu;

const PRONOUN_I = /(?<lead>^|\s)i(?=$|\s|['’](?:[A-Za-z]|$)|[.!?](?!\p{L}))/gu;

const CLOSED = /[.!?…]["']?$/u;
const HANGS = /[,:;]["']?$/u;
const LIST_LINE = /^(?<marker>[-*+]|\d{1,3}[.)])\s+(?<rest>\S.*)$/u;
const SENTENCE_BREAK = /(?<=[.!?…])\s+/u;
const FIRST_LETTER = /^(?<prefix>[^\p{L}\p{N}]*)(?<letter>\p{L})/u;
const OPEN_ENDING = /[,:;](?<quote>["']?)$/u;

const wordKey = (word: string): string =>
  word
    .toLowerCase()
    .replaceAll(CURLY_APOSTROPHE, "'")
    .replaceAll(EDGE_PUNCT, "");

const contentWords = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/u)
    .filter((word) => {
      const key = wordKey(word);
      return key.length > 0 && !FILLER.test(key);
    });

const isBare = (token: string): boolean =>
  token.toLowerCase().replaceAll(CURLY_APOSTROPHE, "'") === wordKey(token);

/** Keep the copy without a trailing comma when one of the pair has one. */
const preferSurface = (current: string, next: string): string => {
  if (isBare(current)) {
    return current;
  }
  return next;
};

const collapseWordRepeats = (words: readonly string[]): string[] => {
  const kept: string[] = [];
  const keys: string[] = [];
  for (const word of words) {
    const key = wordKey(word);
    const previous = keys.at(-1);
    if (previous !== key) {
      kept.push(word);
      keys.push(key);
      continue;
    }
    if (KEEP_DOUBLED.has(key) && keys.at(-2) !== key) {
      kept.push(word);
      keys.push(key);
      continue;
    }
    const last = kept.at(-1);
    if (last !== undefined) {
      kept[kept.length - 1] = preferSurface(last, word);
    }
  }
  return kept;
};

const overlaps = (
  drop: ReadonlySet<number>,
  start: number,
  count: number
): boolean => {
  for (let offset = 0; offset < count; offset += 1) {
    if (drop.has(start + offset)) {
      return true;
    }
  }
  return false;
};

const phraseMatches = (
  keys: readonly string[],
  start: number,
  size: number
): boolean => {
  for (let offset = 0; offset < size; offset += 1) {
    const left = keys[start + offset];
    if (
      left === undefined ||
      left.length === 0 ||
      left !== keys[start + size + offset]
    ) {
      return false;
    }
  }
  return true;
};

/** A 2- or 3-word restart ("we should we should") drops the first copy. */
const collapsePhrase = (words: readonly string[], size: number): string[] => {
  const keys = words.map(wordKey);
  const drop = new Set<number>();
  const span = size * 2;
  for (let start = 0; start + span <= keys.length; start += 1) {
    if (overlaps(drop, start, span) || !phraseMatches(keys, start, size)) {
      continue;
    }
    for (let offset = 0; offset < size; offset += 1) {
      drop.add(start + offset);
    }
  }
  return words.filter((_, index) => !drop.has(index));
};

const prepareTranscript = (text: string): string => {
  let words = collapseWordRepeats(contentWords(text));
  for (const size of PHRASE_SIZES) {
    words = collapsePhrase(words, size);
  }
  return words.join(" ");
};

export const cleanupRequest = (transcript: string): CleanupRequest => ({
  instructions: CLEANUP_INSTRUCTIONS,
  prompt: prepareTranscript(transcript),
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

/** Lowercase words. List markers, colons, and other punctuation drop. */
const wordTokens = (text: string): string[] =>
  text
    .replaceAll(LIST_MARKER, "")
    .replaceAll(":", " ")
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

const capitalizePronounI = (text: string): string =>
  text.replaceAll(PRONOUN_I, (_match, lead: string) => `${lead}I`);

const capitalizeFirst = (text: string): string => {
  const match = FIRST_LETTER.exec(text);
  const prefix = match?.groups?.prefix;
  const letter = match?.groups?.letter;
  if (match === null || prefix === undefined || letter === undefined) {
    return text;
  }
  return `${prefix}${letter.toUpperCase()}${text.slice(match[0].length)}`;
};

const ensureTerminal = (text: string): string => {
  if (text.length === 0 || CLOSED.test(text) || HANGS.test(text)) {
    return text;
  }
  return `${text}.`;
};

/** "i.e." and "U.S." are not sentence ends. A period after a longer word is. */
const INITIAL = /(?:^|[^\p{L}\p{N}])[\p{L}]\.$/u;

const mergeInitials = (parts: readonly string[]): string[] => {
  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (previous !== undefined && INITIAL.test(previous)) {
      merged[merged.length - 1] = `${previous} ${part.trim()}`;
      continue;
    }
    merged.push(part);
  }
  return merged;
};

const polishSentences = (text: string, atSentenceStart: boolean): string => {
  const parts = mergeInitials(
    capitalizePronounI(text)
      .split(SENTENCE_BREAK)
      .filter((part) => part.trim().length > 0)
  );
  const last = parts.length - 1;
  return parts
    .map((part, index) => {
      const trimmed = part.trim();
      const capped =
        index > 0 || atSentenceStart ? capitalizeFirst(trimmed) : trimmed;
      if (index < last) {
        return capped;
      }
      return ensureTerminal(capped);
    })
    .join(" ");
};

interface ListItem {
  marker: string;
  rest: string;
}

const listItem = (line: string): ListItem | null => {
  const groups = LIST_LINE.exec(line)?.groups;
  const marker = groups?.marker;
  const rest = groups?.rest;
  if (marker === undefined || rest === undefined) {
    return null;
  }
  return { marker, rest: rest.trim() };
};

/** The last line of a note ends with a sentence, not a comma or a colon. */
const closeNote = (lines: readonly string[]): string[] => {
  let last = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line !== undefined && line.trim().length > 0) {
      last = index;
      break;
    }
  }
  if (last < 0) {
    return [...lines];
  }
  return lines.map((line, index) =>
    index === last ? line.replace(OPEN_ENDING, ".$<quote>") : line
  );
};

const polishNote = (text: string): string => {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const polished: string[] = [];
  let atSentenceStart = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      polished.push("");
      atSentenceStart = true;
      continue;
    }
    const item = listItem(trimmed);
    if (item !== null) {
      polished.push(`${item.marker} ${polishSentences(item.rest, true)}`);
      atSentenceStart = true;
      continue;
    }
    const sentence = polishSentences(trimmed, atSentenceStart);
    polished.push(sentence);
    atSentenceStart = !HANGS.test(sentence);
  }
  return closeNote(polished).join("\n").trim();
};

const readable = (raw: string, prepared: string): CleanupOutcome => ({
  body: polishNote(prepared.length > 0 ? prepared : raw),
  cleaned: false,
  transcript: raw,
});

export const settleCleanup = async (
  transcript: string,
  ask: (request: CleanupRequest, signal: AbortSignal) => Promise<string>,
  timeoutMs: number,
  parent?: AbortSignal
): Promise<CleanupOutcome> => {
  const raw = transcript.trim();
  if (raw.length === 0) {
    return readable("", "");
  }
  const request = cleanupRequest(raw);
  if (request.prompt.length === 0) {
    return readable(raw, request.prompt);
  }
  const signal =
    parent === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([AbortSignal.timeout(timeoutMs), parent]);
  try {
    const reply = await ask(request, signal);
    const cleaned = parseCleanupResponse(reply);
    if (cleaned === null || !acceptCleanup(raw, cleaned)) {
      return readable(raw, request.prompt);
    }
    const body = polishNote(cleaned);
    return {
      body,
      cleaned: body !== raw,
      transcript: raw,
    };
  } catch {
    return readable(raw, request.prompt);
  }
};
