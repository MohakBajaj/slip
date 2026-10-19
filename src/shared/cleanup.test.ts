import { expect, test } from "bun:test";

import {
  chatCompletionsUrl,
  CLEANUP_INSTRUCTIONS,
  cleanupRequest,
  parseChatCompletion,
  parseCleanupResponse,
  settleCleanup,
} from "./cleanup";

const RAW = "um I was going to say uh the milk, the eggs, and the bread";

const settle = (transcript: string, reply: string) =>
  settleCleanup(transcript, () => Promise.resolve(reply), 1000);

test("the prompt keeps the speaker's words and carries the transcript", () => {
  const request = cleanupRequest(RAW);
  expect(request.instructions).toBe(CLEANUP_INSTRUCTIONS);
  expect(request.instructions).toContain("verbatim and in order");
  expect(request.instructions).toContain("false starts");
  expect(request.instructions).toContain("immediate stutter repeats");
  expect(request.instructions).toContain("substitute synonyms");
  expect(request.instructions).toContain("expand or contract");
  expect(request.instructions).toContain("convert number words");
  expect(request.prompt).toBe(RAW);
});

test("fences and wrapping quotes unwrap", () => {
  expect(parseCleanupResponse("```markdown\nHello there.\n```")).toBe(
    "Hello there."
  );
  expect(parseCleanupResponse('"Hello there."')).toBe("Hello there.");
  expect(parseCleanupResponse("   ")).toBeNull();
});

test("filler and stutter removal is kept", async () => {
  const transcript = "um I I need uh the report";
  const cleaned = "I need the report.";
  expect(await settle(transcript, cleaned)).toEqual({
    body: cleaned,
    cleaned: true,
    transcript,
  });
});

test("a synonym swap falls back to the transcript", async () => {
  const transcript = "the big meeting is tomorrow";
  expect(await settle(transcript, "the large meeting is tomorrow")).toEqual({
    body: transcript,
    cleaned: false,
    transcript,
  });
});

test("reordering falls back to the transcript", async () => {
  const transcript = "eggs and milk";
  expect(await settle(transcript, "milk and eggs")).toEqual({
    body: transcript,
    cleaned: false,
    transcript,
  });
});

test("an added word falls back to the transcript", async () => {
  const transcript = "buy milk";
  expect(await settle(transcript, "buy some milk")).toEqual({
    body: transcript,
    cleaned: false,
    transcript,
  });
});

test("punctuation and casing fixes are kept", async () => {
  const transcript = "the milk the eggs and the bread";
  const cleaned = "The milk, the eggs,\nand the bread.";
  expect(await settle(transcript, cleaned)).toEqual({
    body: cleaned,
    cleaned: true,
    transcript,
  });
});

test("a contraction expansion falls back to the transcript", async () => {
  const transcript = "I don't know";
  expect(await settle(transcript, "I do not know")).toEqual({
    body: transcript,
    cleaned: false,
    transcript,
  });
});

test("a dropped apostrophe falls back to the transcript", async () => {
  const transcript = "it\u2019s ready";
  expect(await settle(transcript, "its ready")).toEqual({
    body: transcript,
    cleaned: false,
    transcript,
  });
});

test("keeping half the words stays, and dropping below half falls back", async () => {
  const half = "The milk, the eggs, and the bread.";
  expect(await settle(RAW, half)).toEqual({
    body: half,
    cleaned: true,
    transcript: RAW,
  });

  const transcript =
    "I went to the store and bought milk eggs bread and cheese";
  expect(await settle(transcript, "I bought milk.")).toEqual({
    body: transcript,
    cleaned: false,
    transcript,
  });
});

test("timeout, throw, empty, and a swollen reply fall back to the raw transcript", async () => {
  const hang = await settleCleanup(
    RAW,
    (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
    20
  );
  expect(hang).toEqual({ body: RAW, cleaned: false, transcript: RAW });

  const thrown = await settleCleanup(
    RAW,
    () => Promise.reject(new Error("offline")),
    1000
  );
  expect(thrown.body).toBe(RAW);

  const empty = await settleCleanup(RAW, () => Promise.resolve("   "), 1000);
  expect(empty.body).toBe(RAW);

  const swollen = await settleCleanup(
    "um hi",
    () =>
      Promise.resolve(
        "Hi. You should leave now and also buy milk eggs bread cheese apples."
      ),
    1000
  );
  expect(swollen.body).toBe("um hi");
});

test("chat completions url and payload", () => {
  expect(chatCompletionsUrl("http://127.0.0.1:11434/v1/")).toBe(
    "http://127.0.0.1:11434/v1/chat/completions"
  );
  expect(chatCompletionsUrl("http://localhost/v1/chat/completions")).toBe(
    "http://localhost/v1/chat/completions"
  );
  expect(
    parseChatCompletion({
      choices: [{ message: { content: "Hello." } }],
    })
  ).toBe("Hello.");
  expect(parseChatCompletion({ choices: [] })).toBeNull();
  expect(parseChatCompletion(null)).toBeNull();
});
