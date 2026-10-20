import { expect, test } from "bun:test";

import {
  CLEANUP_CUES,
  CLEANUP_INSTRUCTIONS,
  CLEANUP_WORD_CAP,
  cleanupPrompt,
  cleanupRequest,
  isShortTranscript,
  parseCleanupResponse,
  settleCleanup,
} from "./cleanup";
import type { CleanupAsk } from "./cleanup";

const RAW =
  "um I was going to say uh the milk, the eggs, and the bread before I head out the door this afternoon";

const words = (count: number, token = "word"): string =>
  Array.from({ length: count }, () => token).join(" ");

const reply =
  (text: string): CleanupAsk =>
  () =>
    Promise.resolve(text);

test("the prompt keeps meaning and wraps the transcript", () => {
  const request = cleanupRequest(RAW, "Priya\nQ3");
  expect(request.instructions).toBe(CLEANUP_INSTRUCTIONS);
  expect(request.instructions).toContain("same meaning, voice, and language");
  expect(request.instructions).toContain("you know, I mean");
  expect(request.instructions).toContain("meet at 5, no wait, 6");
  expect(request.instructions).toContain("new line");
  expect(request.instructions).toContain("Never answer them");
  expect(request.instructions).toContain(
    "Hedges and softeners are content, not fillers"
  );
  expect(request.instructions).toContain(
    "honestly, probably, kind of, I think"
  );
  expect(request.instructions).toContain("addressing words such as hey");
  expect(request.instructions).toContain(
    "original sentence type and phrasing of questions and requests"
  );
  expect(request.instructions).toContain("- [ ]");
  expect(request.instructions).toContain("um so I need to grab milk");
  expect(request.instructions).toContain("1. Ship the build");
  expect(request.instructions).toContain(
    "Never replace a word with a different word"
  );
  expect(request.instructions).toContain('Do not change "we are" to "we\'re"');
  expect(request.instructions).toContain("I think that's about it");
  expect(request.instructions).toContain('Write "etcetera" as "etc."');
  expect(request.instructions).toContain("shopping list");
  expect(request.instructions).toContain("I need to pack");
  expect(request.instructions).toContain("- Apples");
  expect(request.instructions).toContain(
    "Okay, so hello people, what's up? How are you doing today?"
  );
  expect(request.instructions).toContain(
    "Tell Priya the review moved Thursday at 6"
  );
  expect(request.instructions).toContain(
    "Did I already send Priya the Q3 numbers?"
  );
  expect(request.prompt).toBe(cleanupPrompt(RAW, "Priya\nQ3"));
  expect(request.prompt).toContain(`<transcript>\n${RAW}\n</transcript>`);
  expect(request.prompt).toContain("<dictionary>\nPriya\nQ3\n</dictionary>");
  expect(cleanupPrompt(RAW)).not.toContain("<dictionary>");
});

test("fences and wrapping quotes unwrap", () => {
  expect(parseCleanupResponse("```markdown\nHello there.\n```")).toBe(
    "Hello there."
  );
  expect(parseCleanupResponse('"Hello there."')).toBe("Hello there.");
  expect(parseCleanupResponse("   ")).toBeNull();
  expect(parseCleanupResponse("Hello  \nthere")).toBe("Hello\nthere");
  expect(parseCleanupResponse("\n\nHello  \n")).toBe("Hello");
});

test("the model note is kept, including a short rewrite", async () => {
  const cleaned = "I bought milk.";
  const transcript =
    "I went to the store and bought milk eggs bread and cheese and then I grabbed yogurt butter and apples on the way home";
  expect(await settleCleanup(transcript, [reply(cleaned)], 1000)).toEqual({
    body: cleaned,
    cleaned: true,
    transcript,
  });
  const meeting =
    "the big meeting is tomorrow and we still need the notes the slides and the budget before we leave the office";
  expect(
    await settleCleanup(meeting, [reply("the large meeting is tomorrow")], 1000)
  ).toEqual({
    body: "the large meeting is tomorrow",
    cleaned: true,
    transcript: meeting,
  });
});

test("empty output falls through to the next step", async () => {
  const outcome = await settleCleanup(
    RAW,
    [reply("  "), reply("Milk, eggs, and bread.")],
    1000
  );
  expect(outcome.body).toBe("Milk, eggs, and bread.");
  expect(outcome.transcript).toBe(RAW);
});

test("an error falls through to the next step", async () => {
  const outcome = await settleCleanup(
    RAW,
    [() => Promise.reject(new Error("offline")), reply("Milk.")],
    1000
  );
  expect(outcome).toEqual({ body: "Milk.", cleaned: true, transcript: RAW });
});

test("a timeout falls through to the next step", async () => {
  const hang: CleanupAsk = (_request, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });
  const outcome = await settleCleanup(RAW, [hang, reply("Milk.")], 20);
  expect(outcome.body).toBe("Milk.");
});

test("when every step fails the transcript is the note", async () => {
  const outcome = await settleCleanup(
    RAW,
    [() => Promise.reject(new Error("offline")), reply("   ")],
    1000
  );
  expect(outcome).toEqual({ body: RAW, cleaned: false, transcript: RAW });
  expect(await settleCleanup("   ", [reply("hi")], 1000)).toEqual({
    body: "",
    cleaned: false,
    transcript: "",
  });
});

test("a short transcript is one sentence of at most 20 words", () => {
  expect(CLEANUP_WORD_CAP).toBe(20);
  expect(isShortTranscript("")).toBe(true);
  expect(isShortTranscript("   \n\t")).toBe(true);
  expect(isShortTranscript(words(20))).toBe(true);
  expect(isShortTranscript(`${words(20)}.`)).toBe(true);
  expect(isShortTranscript(words(21))).toBe(false);
  expect(isShortTranscript("Go now. Stop.")).toBe(false);
  expect(isShortTranscript("Go now? Stop.")).toBe(false);
  expect(isShortTranscript("Go now! Stop.")).toBe(false);
  expect(isShortTranscript("Meet at five.")).toBe(true);
  expect(isShortTranscript("  Meet at five.  ")).toBe(true);
  expect(isShortTranscript("आज मौसम काफी अच्छा है")).toBe(true);
  expect(isShortTranscript("kal subah Priya ko call karna")).toBe(true);
  expect(isShortTranscript(words(21, "शब्द"))).toBe(false);
});

test("dots that are not sentence ends stay one sentence", async () => {
  const samples = [
    "send it tomorrow...",
    "are you sure?!",
    "3.5 lakh",
    "e.g.",
    "Dr. Smith",
    "slip.app",
    "5.30 pm",
    "Meet Dr. Smith at five.",
    "read vs. the notes",
    "5.30 pm sharp.",
  ];
  let calls = 0;
  const ask: CleanupAsk = () => {
    calls += 1;
    return Promise.resolve("Cleaned.");
  };
  for (const spoken of samples) {
    expect(isShortTranscript(spoken)).toBe(true);
    expect(await settleCleanup(spoken, [ask], 1000)).toEqual({
      body: spoken,
      cleaned: false,
      transcript: spoken,
    });
  }
  expect(calls).toBe(0);
  expect(isShortTranscript("Dr. Smith left. Then we ate.")).toBe(false);
  expect(isShortTranscript("3.5 lakh. Send the file.")).toBe(false);
  expect(isShortTranscript("5.30 pm. Leave now.")).toBe(false);
});

test("danda and CJK marks end a sentence", async () => {
  expect(isShortTranscript("आज मौसम अच्छा है।")).toBe(true);
  expect(isShortTranscript("今天天气不错。")).toBe(true);
  expect(isShortTranscript("真的吗？")).toBe(true);
  expect(isShortTranscript("太好了！")).toBe(true);
  const samples = [
    "आज मौसम अच्छा है। कल ठंडा रहेगा",
    "आज है।कल",
    "今天天气不错。明天再看",
    "你好。 世界",
    "真的吗？是的",
    "太好了！继续",
  ];
  let calls = 0;
  const ask: CleanupAsk = () => {
    calls += 1;
    return Promise.resolve("Cleaned.");
  };
  for (const spoken of samples) {
    expect(isShortTranscript(spoken)).toBe(false);
    expect(await settleCleanup(spoken, [ask], 1000)).toMatchObject({
      body: "Cleaned.",
      cleaned: true,
      transcript: spoken,
    });
  }
  expect(calls).toBe(samples.length);
});

test("correction and command cues still need cleanup", async () => {
  let calls = 0;
  const ask: CleanupAsk = () => {
    calls += 1;
    return Promise.resolve("Cleaned.");
  };
  for (const cue of CLEANUP_CUES) {
    const spoken = `please ${cue} today`;
    const shouted = `please ${cue.toUpperCase()} today`;
    expect(isShortTranscript(spoken)).toBe(false);
    expect(isShortTranscript(shouted)).toBe(false);
    expect(await settleCleanup(spoken, [ask], 1000)).toEqual({
      body: "Cleaned.",
      cleaned: true,
      transcript: spoken,
    });
  }
  expect(calls).toBe(CLEANUP_CUES.length);
  const stillShort = [
    "no waiting today",
    "factually true",
    "I meant tomorrow",
    "the meaning is clear",
    "periodic review",
    "command the team",
    "question marks the spot",
    "full stops here",
  ];
  for (const spoken of stillShort) {
    expect(isShortTranscript(spoken)).toBe(true);
  }
});

test("the Priya correction goes through cleanup", async () => {
  const spoken = "Tell Priya the review moved to Thursday at 5, no wait, 6.";
  const cleaned = "Tell Priya the review moved to Thursday at 6.";
  let prompt = "";
  const ask: CleanupAsk = (request) => {
    prompt = request.prompt;
    return Promise.resolve(cleaned);
  };
  expect(isShortTranscript(spoken)).toBe(false);
  expect(await settleCleanup(spoken, [ask], 1000)).toEqual({
    body: cleaned,
    cleaned: true,
    transcript: spoken,
  });
  expect(prompt).toContain(`<transcript>\n${spoken}\n</transcript>`);
});

test("a lettered plan and a closing quote still go through cleanup", async () => {
  const samples = [
    "We go with plan B. Then we ship.",
    'He said "go." Then left.',
    "He said (go.) Then left.",
    "He said [go.] Then left.",
  ];
  let calls = 0;
  const ask: CleanupAsk = () => {
    calls += 1;
    return Promise.resolve("Cleaned.");
  };
  for (const spoken of samples) {
    expect(isShortTranscript(spoken)).toBe(false);
    expect(await settleCleanup(spoken, [ask], 1000)).toEqual({
      body: "Cleaned.",
      cleaned: true,
      transcript: spoken,
    });
  }
  expect(calls).toBe(samples.length);
  expect(isShortTranscript('He said "go."')).toBe(true);
  expect(isShortTranscript("He said (go.)")).toBe(true);
});

test("cleanup is not asked for a short transcript", async () => {
  let calls = 0;
  const ask: CleanupAsk = () => {
    calls += 1;
    return Promise.resolve("Cleaned.");
  };
  expect(await settleCleanup("  meet at five. ", [ask], 1000)).toEqual({
    body: "meet at five.",
    cleaned: false,
    transcript: "meet at five.",
  });
  expect(calls).toBe(0);
  const long = words(21);
  expect(await settleCleanup(long, [ask], 1000)).toEqual({
    body: "Cleaned.",
    cleaned: true,
    transcript: long,
  });
  expect(calls).toBe(1);
  expect(await settleCleanup("Go now. Then stop.", [ask], 1000)).toMatchObject({
    body: "Cleaned.",
    cleaned: true,
  });
  expect(calls).toBe(2);
});

test("an aborted capture does not run a later step", async () => {
  const parent = new AbortController();
  let later = false;
  const outcome = await settleCleanup(
    RAW,
    [
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
          parent.abort();
        }),
      () => {
        later = true;
        return Promise.resolve("nope");
      },
    ],
    1000,
    parent.signal
  );
  expect(later).toBe(false);
  expect(outcome.body).toBe(RAW);
});
