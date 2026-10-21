export const CLEANUP_TIMEOUT_MS = 45_000;

export const CLEANUP_INSTRUCTIONS = `Clean a speech transcript into a note. The user message wraps the transcript in <transcript> tags. A <dictionary> block, when present, lists spellings to prefer.

GOAL
Keep the same meaning, voice, and language.

REMOVE
Only delete fillers and repeated stutters. Fillers are um, uh, okay so, so at the start of a sentence, and like, you know, I mean, or basically when they are fillers. A repeated stutter is the same word twice, such as "I I" or "the the". Delete nothing else.

SELF-CORRECTIONS
Keep the final version and drop the cue. "meet at 5, no wait, 6" becomes "meet at 6". Keep a meaningful "actually". If you are unsure which version was meant, keep both.

FIX
Punctuation and casing. Clear speech-recognition errors. Dictionary spellings. Spoken punctuation and layout commands such as "new line" and "comma". Numbers, dates, and times in standard form. Write "etcetera" as "etc.".

FORMAT
Plain Markdown. Break a paragraph on a topic shift. Put a blank line between paragraphs and around lists. At most 3 sentences per paragraph. No exclamation marks unless the speaker is clearly emphatic.
When the speaker announces a list (a cue such as "here's our list", "shopping list", "things to", "I need to pack", or "three things", or a colon-like intro) and then gives 3 or more items, output a heading line ending in ":" and then "- " bullets, one item per line, first letter capitalized, no trailing punctuation.
When the speaker enumerates 3 or more parallel items as its own list, not as objects in the middle of a longer sentence, use those same "- " bullets. Ordinal cues (first, second, third, or one, two, three) become a "1." numbered list.
An enumeration that is the object of a longer sentence stays inline.
Use "- [ ]" only for a clear task list.

PRESERVE
Never replace a word with a different word. Never drop a sentence or clause that carries meaning. Greetings, small talk, and sign-offs such as "I think that's about it" are content. Do not change "we are" to "we're" or the reverse. Keep contractions as spoken. Hedges and softeners are content, not fillers: honestly, probably, kind of, I think. Keep greetings and addressing words such as hey and people. Keep the original sentence type and phrasing of questions and requests. "Hey, can you remind me...?" stays a question. "hello people, what's up? How are you doing today?" stays those questions. Questions are content. Never answer them.

OUTPUT
Only the cleaned note. If nothing should be kept, output an empty string.

Example
<transcript>
um so I need to grab milk uh eggs and also bread you know
</transcript>
I need to grab:
- Milk
- Eggs
- Bread

Example
<transcript>
okay first we ship the build second we post the notes third we ping the team
</transcript>
1. Ship the build
2. Post the notes
3. Ping the team

Example
<transcript>
tell Priya the review moved Thursday at 5 no wait 6 and bring the Q3 numbers
</transcript>
Tell Priya the review moved Thursday at 6 and bring the Q3 numbers.

Example
<transcript>
did I already send Priya the Q3 numbers
</transcript>
Did I already send Priya the Q3 numbers?

Example
<transcript>
Okay, so hello people, what's up? How are you doing today? So we got Zen, Microsoft Edge, Chrome, Termius, MongoDB, WhatsApp, Teams, Figma, Cloudflare, Settings, Flip in the house with us today. I think we are all going to have fun, and here's our shopping list for the day. It's apples, bananas, mangoes, chocolates, etcetera, etcetera. I think that's about it.
</transcript>
Hello people, what's up? How are you doing today?

We got Zen, Microsoft Edge, Chrome, Termius, MongoDB, WhatsApp, Teams, Figma, Cloudflare, Settings and Flip in the house with us today. I think we are all going to have fun.

Here's our shopping list for the day:
- Apples
- Bananas
- Mangoes
- Chocolates
- etc.

I think that's about it.`;

export interface CleanupRequest {
  instructions: string;
  prompt: string;
}

export interface CleanupOutcome {
  body: string;
  cleaned: boolean;
  transcript: string;
}

export type CleanupAsk = (
  request: CleanupRequest,
  signal: AbortSignal
) => Promise<string>;

const FENCE = /^```[a-z]*\n(?<body>[\s\S]*?)\n```$/u;

export const cleanupPrompt = (transcript: string, dictionary = ""): string => {
  const note = `<transcript>\n${transcript.trim()}\n</transcript>`;
  const words = dictionary.trim();
  if (words.length === 0) {
    return note;
  }
  return `${note}\n<dictionary>\n${words}\n</dictionary>`;
};

export const cleanupRequest = (
  transcript: string,
  dictionary = ""
): CleanupRequest => ({
  instructions: CLEANUP_INSTRUCTIONS,
  prompt: cleanupPrompt(transcript, dictionary),
});

const tidyNote = (value: string): string =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+/u, "")
    .trimEnd();

export const parseCleanupResponse = (raw: string): string | null => {
  let text = raw.trim();
  const body = FENCE.exec(text)?.groups?.body;
  if (typeof body === "string" && body.length > 0) {
    text = body;
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1);
  }
  text = tidyNote(text);
  return text.length > 0 ? text : null;
};

/** One sentence at or under this many words is left as spoken. */
export const CLEANUP_WORD_CAP = 20;

/**
 * Corrections and spoken commands. A transcript that contains one still
 * goes through cleanup. Matched case-insensitively on word boundaries.
 */
export const CLEANUP_CUES = [
  "no wait",
  "actually",
  "i mean",
  "scratch that",
  "sorry",
  "new line",
  "new paragraph",
  "comma",
  "period",
  "full stop",
  "question mark",
] as const;

/** Titles and Latin abbreviations. A period after these is not a sentence end. */
const ABBREVIATIONS = new Set([
  "dr",
  "eg",
  "etc",
  "ie",
  "jr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "sr",
  "st",
  "vs",
]);

/**
 * Terminal punctuation, an optional closing quote or bracket, whitespace,
 * then more text.
 */
const SENTENCE_GAP = /[.?!।。？！]+["“”'’)\]}]*\s+[^\s.?!।。？！]/u;

/** Danda and CJK marks also end a sentence when no space follows. */
const TIGHT_SENTENCE = /[।。？！]+["“”'’)\]}]*[^\s.?!।。？！"“”'’)\]}]/u;

const escapeCue = (cue: string): string =>
  cue.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const CUE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${CLEANUP_CUES.map((cue) => escapeCue(cue)).join("|")})(?![\\p{L}\\p{N}_])`,
  "iu"
);

const mentionsCue = (text: string): boolean => CUE.test(text);

const periodIsAbbreviation = (text: string, index: number): boolean => {
  if ((text[index] ?? "") !== ".") {
    return false;
  }
  let start = index;
  while (start > 0 && /[A-Za-z]/u.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  return ABBREVIATIONS.has(text.slice(start, index).toLowerCase());
};

const hasSentenceBreak = (text: string): boolean => {
  const spaced = new RegExp(SENTENCE_GAP.source, "gu");
  for (const match of text.matchAll(spaced)) {
    const index = match.index ?? 0;
    if (!periodIsAbbreviation(text, index)) {
      return true;
    }
  }
  return TIGHT_SENTENCE.test(text);
};

/**
 * True when cleanup should not run: one sentence, at most CLEANUP_WORD_CAP
 * words, and no correction or command cue.
 */
export const isShortTranscript = (transcript: string): boolean => {
  const text = transcript.trim();
  if (mentionsCue(text) || hasSentenceBreak(text)) {
    return false;
  }
  if (text.length === 0) {
    return true;
  }
  return text.split(/\s+/u).length <= CLEANUP_WORD_CAP;
};

const rawOutcome = (transcript: string): CleanupOutcome => ({
  body: transcript,
  cleaned: false,
  transcript,
});

const attempt = async (
  ask: CleanupAsk,
  request: CleanupRequest,
  timeoutMs: number,
  parent?: AbortSignal
): Promise<string | null> => {
  const signal =
    parent === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([AbortSignal.timeout(timeoutMs), parent]);
  const cleaned = parseCleanupResponse(await ask(request, signal));
  return cleaned;
};

/**
 * The first step that returns text wins. Later steps are fallbacks.
 * Empty output, errors, and timeouts move to the next step, then the raw transcript.
 * A short transcript with no correction or command cue is returned trimmed,
 * and no step is called.
 */
export const settleCleanup = async (
  transcript: string,
  steps: readonly CleanupAsk[],
  timeoutMs: number,
  parent?: AbortSignal
): Promise<CleanupOutcome> => {
  const raw = transcript.trim();
  // No steps means cleanup is off: same trimmed raw path as a short transcript.
  if (steps.length === 0 || isShortTranscript(raw)) {
    return rawOutcome(raw);
  }
  const request = cleanupRequest(raw);
  const stopped = (): boolean => parent?.aborted === true;
  const nextStep = async (index: number): Promise<CleanupOutcome> => {
    const ask = steps[index];
    if (ask === undefined || stopped()) {
      return rawOutcome(raw);
    }
    try {
      const cleaned = await attempt(ask, request, timeoutMs, parent);
      if (cleaned !== null) {
        return {
          body: cleaned,
          cleaned: cleaned !== raw,
          transcript: raw,
        };
      }
    } catch (error) {
      if (stopped()) {
        return rawOutcome(raw);
      }
      console.error(
        "slip cleanup fell back:",
        error instanceof Error ? error.message : error
      );
    }
    return await nextStep(index + 1);
  };
  return await nextStep(0);
};
