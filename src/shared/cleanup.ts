export const CLEANUP_TIMEOUT_MS = 45_000;

export const CLEANUP_INSTRUCTIONS = `Clean a speech transcript into a note. The user message wraps the transcript in <transcript> tags. A <dictionary> block, when present, lists spellings to prefer.

GOAL
Keep the same meaning, voice, and language.

REMOVE
Fillers and tics: um, uh, like, you know, I mean, and basically when they are fillers. Stutters. False starts. Hedges and softeners are content, not fillers: honestly, probably, kind of, I think.

SELF-CORRECTIONS
Keep the final version and drop the cue. "meet at 5, no wait, 6" becomes "meet at 6". Keep a meaningful "actually". If you are unsure which version was meant, keep both.

FIX
Punctuation, casing, and grammar. Clear speech-recognition errors. Dictionary spellings. Spoken punctuation and layout commands such as "new line" and "comma". Numbers, dates, and times in standard form.

FORMAT
Short notes stay one line. Paragraphs are at most 3 sentences. Three or more enumerated items, or first, second, and third, become a "-" or "1." list. Use "- [ ]" only for a clear task list. Plain Markdown.

PRESERVE
The speaker's words, order, tone, slang, and contractions. Keep greetings and addressing words such as hey. Do not substitute synonyms. Do not summarize. Keep the original sentence type and phrasing of questions and requests. "Hey, can you remind me...?" stays a question. Questions are content. Never answer them.

OUTPUT
Only the cleaned note. If nothing should be kept, output an empty string.

Example
<transcript>
um so I need to grab milk uh eggs and also bread you know
</transcript>
- milk
- eggs
- bread

Example
<transcript>
okay first we ship the build second we post the notes third we ping the team
</transcript>
1. ship the build
2. post the notes
3. ping the team

Example
<transcript>
tell Priya the review moved Thursday at 5 no wait 6 and bring the Q3 numbers
</transcript>
Tell Priya the review moved Thursday at 6 and bring the Q3 numbers.

Example
<transcript>
did I already send Priya the Q3 numbers
</transcript>
Did I already send Priya the Q3 numbers?`;

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
 */
export const settleCleanup = async (
  transcript: string,
  steps: readonly CleanupAsk[],
  timeoutMs: number,
  parent?: AbortSignal,
  dictionary = ""
): Promise<CleanupOutcome> => {
  const raw = transcript.trim();
  if (raw.length === 0) {
    return rawOutcome("");
  }
  const request = cleanupRequest(raw, dictionary);
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
