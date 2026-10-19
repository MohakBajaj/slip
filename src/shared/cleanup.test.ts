import { expect, test } from "bun:test";

import {
  acceptCleanup,
  chatCompletionsUrl,
  CLEANUP_INSTRUCTIONS,
  cleanupRequest,
  parseChatCompletion,
  parseCleanupResponse,
  settleCleanup,
} from "./cleanup";

const RAW = "um I was going to say uh the milk, the eggs, and the bread";

test("the prompt forbids new content and carries the transcript", () => {
  const request = cleanupRequest(RAW);
  expect(request.instructions).toBe(CLEANUP_INSTRUCTIONS);
  expect(request.instructions).toContain("Do not add");
  expect(request.instructions).toContain("Do not answer");
  expect(request.instructions).toContain("markdown list");
  expect(request.prompt).toBe(RAW);
});

test("a fake model edits, and fences unwrap", () => {
  expect(parseCleanupResponse("```markdown\nHello there.\n```")).toBe(
    "Hello there."
  );
  expect(parseCleanupResponse('"Hello there."')).toBe("Hello there.");
  expect(parseCleanupResponse("   ")).toBeNull();
  expect(acceptCleanup(RAW, "The milk, the eggs, and the bread.")).toBe(true);
  expect(
    acceptCleanup(RAW, `${RAW} ${"and a long invented answer ".repeat(20)}`)
  ).toBe(false);
});

test("a fake model result becomes the body and keeps the transcript", async () => {
  const outcome = await settleCleanup(
    RAW,
    (request) => {
      expect(request.prompt).toBe(RAW);
      return Promise.resolve("- milk\n- eggs\n- bread");
    },
    1000
  );
  expect(outcome.body).toBe("- milk\n- eggs\n- bread");
  expect(outcome.cleaned).toBe(true);
  expect(outcome.transcript).toBe(RAW);
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
