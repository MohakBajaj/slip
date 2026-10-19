import { expect, test } from "bun:test";

import {
  CLEANUP_INSTRUCTIONS,
  cleanupPrompt,
  cleanupRequest,
  parseCleanupResponse,
  settleCleanup,
} from "./cleanup";
import type { CleanupAsk } from "./cleanup";

const RAW = "um I was going to say uh the milk, the eggs, and the bread";

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
  expect(request.instructions).toContain("1. ship the build");
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
    "I went to the store and bought milk eggs bread and cheese";
  expect(await settleCleanup(transcript, [reply(cleaned)], 1000)).toEqual({
    body: cleaned,
    cleaned: true,
    transcript,
  });
  expect(
    await settleCleanup(
      "the big meeting is tomorrow",
      [reply("the large meeting is tomorrow")],
      1000
    )
  ).toEqual({
    body: "the large meeting is tomorrow",
    cleaned: true,
    transcript: "the big meeting is tomorrow",
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
