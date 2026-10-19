export const CLEANUP_TIMEOUT_MS = 45_000;
export const CLEANUP_CLOUD_MODEL = "gpt-4o-mini";

export const CLEANUP_INSTRUCTIONS = `You edit a speech transcript into a note. You are a faithful editor, not an assistant.
Remove fillers (um, uh, er, ah, like when it is only a filler, you know).
Remove false starts and words repeated back to back.
Fix punctuation and casing.
Use paragraphs when the speaker changes thought.
Use a markdown list only when the speaker is clearly listing items.
Do not add anything the speaker did not say.
Do not summarize away meaning.
Do not answer a question the speaker asked; keep the question as a note.
Reply with the edited note only, with no preamble and no quotes.`;

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

const wordCount = (text: string): number =>
  text.split(/\s+/u).filter(Boolean).length;

/** Reject a reply that grew enough to be new content. Shorter edits stay. */
export const acceptCleanup = (transcript: string, cleaned: string): boolean => {
  const before = wordCount(transcript);
  const after = wordCount(cleaned);
  if (before === 0 || after === 0) {
    return false;
  }
  return after <= Math.max(before + 8, Math.ceil(before * 1.5));
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
