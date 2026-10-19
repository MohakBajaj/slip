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
const RAW_NOTE = "I was going to say the milk, the eggs, and the bread.";

const STANDUP =
  "um so I was thinking uh we should like you know move the the standup to ten because uh half the team is is in a different time zone and um yeah that's that's kind of it";
const STANDUP_PREPARED =
  "so I was thinking we should like you know move the standup to ten because half the team is in a different time zone and yeah that's kind of it";
const STANDUP_BODY =
  "I was thinking we should move the standup to ten because half the team is in a different time zone.";

const TODOS =
  "okay so things to do tomorrow um buy milk uh call the bank about the the card and also uh finish the slip release notes";
const TODOS_PREPARED =
  "okay so things to do tomorrow buy milk call the bank about the card and also finish the slip release notes";
const TODOS_BODY = `Things to do tomorrow:
- Buy milk.
- Call the bank about the card.
- Finish the slip release notes.`;

const FLOW =
  "I mean the thing is it's it's not really working I think we need to uh rethink the onboarding flow basically";
const FLOW_PREPARED =
  "I mean the thing is it's not really working I think we need to rethink the onboarding flow basically";
const FLOW_BODY =
  "The thing is, it's not really working. I think we need to rethink the onboarding flow.";

const settle = (transcript: string, reply: string) =>
  settleCleanup(transcript, () => Promise.resolve(reply), 1000);

test("the prompt deletes fillers up front and shows the note shape", () => {
  const request = cleanupRequest(RAW);
  expect(request.instructions).toBe(CLEANUP_INSTRUCTIONS);
  expect(request.instructions).toContain(
    "Never add, substitute, reorder, expand, or contract words"
  );
  expect(request.instructions).toContain("never convert number words");
  expect(request.instructions).toContain("false starts");
  expect(request.instructions).toContain("bullet list");
  expect(request.instructions).toContain("blank line between topics");
  expect(request.instructions).toContain(STANDUP_PREPARED);
  expect(request.instructions).toContain(STANDUP_BODY);
  expect(request.instructions).toContain(TODOS_BODY);
  expect(request.instructions).toContain(FLOW_BODY);
  expect(request.prompt).toBe(
    "I was going to say the milk, the eggs, and the bread"
  );
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

test("spoken notes come back capitalized, punctuated, and stutter-free", async () => {
  const standup = await settleCleanup(
    STANDUP,
    (request) => {
      expect(request.prompt).toBe(STANDUP_PREPARED);
      return Promise.resolve(
        "i was thinking we should move the standup to ten because half the team is in a different time zone"
      );
    },
    1000
  );
  expect(standup).toEqual({
    body: STANDUP_BODY,
    cleaned: true,
    transcript: STANDUP,
  });
  expect(await settle(STANDUP, STANDUP_BODY)).toEqual({
    body: STANDUP_BODY,
    cleaned: true,
    transcript: STANDUP,
  });

  const todos = await settleCleanup(
    TODOS,
    (request) => {
      expect(request.prompt).toBe(TODOS_PREPARED);
      return Promise.resolve(`things to do tomorrow:
- buy milk
- call the bank about the card
- finish the slip release notes`);
    },
    1000
  );
  expect(todos).toEqual({
    body: TODOS_BODY,
    cleaned: true,
    transcript: TODOS,
  });
  expect(await settle(TODOS, TODOS_BODY)).toEqual({
    body: TODOS_BODY,
    cleaned: true,
    transcript: TODOS,
  });

  const flow = await settleCleanup(
    FLOW,
    (request) => {
      expect(request.prompt).toBe(FLOW_PREPARED);
      return Promise.resolve(
        "the thing is, it's not really working. i think we need to rethink the onboarding flow"
      );
    },
    1000
  );
  expect(flow).toEqual({
    body: FLOW_BODY,
    cleaned: true,
    transcript: FLOW,
  });
  expect(await settle(FLOW, FLOW_BODY)).toEqual({
    body: FLOW_BODY,
    cleaned: true,
    transcript: FLOW,
  });
});

test("a rejected or missing model still leaves a readable note", async () => {
  const offline = await settleCleanup(
    STANDUP,
    () => Promise.reject(new Error("offline")),
    1000
  );
  expect(offline).toEqual({
    body: "So I was thinking we should like you know move the standup to ten because half the team is in a different time zone and yeah that's kind of it.",
    cleaned: false,
    transcript: STANDUP,
  });

  const todos = await settleCleanup(TODOS, () => Promise.resolve("   "), 1000);
  expect(todos).toEqual({
    body: "Okay so things to do tomorrow buy milk call the bank about the card and also finish the slip release notes.",
    cleaned: false,
    transcript: TODOS,
  });

  const flow = await settleCleanup(
    FLOW,
    () => Promise.reject(new Error("offline")),
    1000
  );
  expect(flow.body).toBe(
    "I mean the thing is it's not really working I think we need to rethink the onboarding flow basically."
  );
  expect(flow.cleaned).toBe(false);
});

test("stutters collapse and legit doubles stay", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["the the standup", "The standup."],
    ["is is working", "Is working."],
    ["that's that's it", "That's it."],
    ["it's it's not", "It's not."],
    ["I I need the report", "I need the report."],
    ["I had had enough", "I had had enough."],
    ["know that that is true", "Know that that is true."],
    ["that that that is true", "That that is true."],
    ["gave her her keys", "Gave her her keys."],
    ["it is very very good", "It is very very good."],
    ["it is really really good", "It is really really good."],
    ["no no stop", "No no stop."],
    ["yes yes come", "Yes yes come."],
    ["move move the date", "Move the date."],
    ["the um the date", "The date."],
    ["we should we should move", "We should move."],
    ["I was going I was going to say", "I was going to say."],
  ];
  for (const [transcript, body] of cases) {
    const outcome = await settle(transcript, "not the speaker's words at all");
    expect({ body: outcome.body, transcript }).toEqual({ body, transcript });
    expect(outcome.cleaned).toBe(false);
  }
});

test("pure fillers drop and ordinary words stay", async () => {
  const transcript =
    "umm uh erm ahh hmm mm mhm uh-huh mm-hmm, I hum a him error mum ahoy and the umami";
  const outcome = await settle(transcript, "nope nope nope");
  expect(outcome.body).toBe("I hum a him error mum ahoy and the umami.");
  expect(outcome.cleaned).toBe(false);
});

test("a synonym swap falls back to the transcript", async () => {
  const transcript = "the big meeting is tomorrow";
  expect(await settle(transcript, "the large meeting is tomorrow")).toEqual({
    body: "The big meeting is tomorrow.",
    cleaned: false,
    transcript,
  });
});

test("reordering falls back to the transcript", async () => {
  const transcript = "eggs and milk";
  expect(await settle(transcript, "milk and eggs")).toEqual({
    body: "Eggs and milk.",
    cleaned: false,
    transcript,
  });
  expect(await settle(transcript, "- Milk.\n- Eggs.")).toEqual({
    body: "Eggs and milk.",
    cleaned: false,
    transcript,
  });
});

test("an added word falls back to the transcript", async () => {
  const transcript = "buy milk";
  expect(await settle(transcript, "buy some milk")).toEqual({
    body: "Buy milk.",
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
    body: "I don't know.",
    cleaned: false,
    transcript,
  });
});

test("a dropped apostrophe falls back to the transcript", async () => {
  const transcript = "it\u2019s ready";
  expect(await settle(transcript, "its ready")).toEqual({
    body: "It\u2019s ready.",
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
    body: "I went to the store and bought milk eggs bread and cheese.",
    cleaned: false,
    transcript,
  });
});

test("lists, colons, and paragraphs pass when the words stay in order", async () => {
  const transcript = "buy milk call the bank about the card";
  expect(
    await settle(transcript, "1. buy milk\n2. call the bank about the card")
  ).toEqual({
    body: "1. Buy milk.\n2. Call the bank about the card.",
    cleaned: true,
    transcript,
  });
  expect(
    await settle(transcript, "- buy milk\n* call the bank about the card")
  ).toEqual({
    body: "- Buy milk.\n* Call the bank about the card.",
    cleaned: true,
    transcript,
  });
  expect(await settle(transcript, "- buy some milk\n- call the bank")).toEqual({
    body: "Buy milk call the bank about the card.",
    cleaned: false,
    transcript,
  });

  const timed = "meet at ten move the standup";
  expect(await settle(timed, "meet at ten: move the standup")).toEqual({
    body: "Meet at ten: move the standup.",
    cleaned: true,
    transcript: timed,
  });
  expect(await settle(timed, "meet at ten:move the standup")).toEqual({
    body: "Meet at ten:move the standup.",
    cleaned: true,
    transcript: timed,
  });

  const topics = "move the standup to ten the notes are done";
  expect(
    await settle(topics, "move the standup to ten.\n\nthe notes are done")
  ).toEqual({
    body: "Move the standup to ten.\n\nThe notes are done.",
    cleaned: true,
    transcript: topics,
  });
});

test("standalone i is capitalized", async () => {
  const transcript = "then i think i'm done see i.e. the note";
  expect(await settle(transcript, transcript)).toEqual({
    body: "Then I think I'm done see i.e. the note.",
    cleaned: true,
    transcript,
  });
});

test("timeout, throw, empty, and a swollen reply fall back to a readable note", async () => {
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
  expect(hang).toEqual({ body: RAW_NOTE, cleaned: false, transcript: RAW });

  const thrown = await settleCleanup(
    RAW,
    () => Promise.reject(new Error("offline")),
    1000
  );
  expect(thrown.body).toBe(RAW_NOTE);

  const empty = await settleCleanup(RAW, () => Promise.resolve("   "), 1000);
  expect(empty.body).toBe(RAW_NOTE);

  const swollen = await settleCleanup(
    "um hi",
    () =>
      Promise.resolve(
        "Hi. You should leave now and also buy milk eggs bread cheese apples."
      ),
    1000
  );
  expect(swollen).toEqual({ body: "Hi.", cleaned: false, transcript: "um hi" });
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
