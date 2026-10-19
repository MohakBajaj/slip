import { expect, test } from "bun:test";

import {
  bytesToBase64,
  chatDelta,
  parseChatCompletion,
  readChatStream,
  sseDelta,
  transcriptionText,
} from "./gateway-api";

test("chat completions and transcription payloads parse", () => {
  expect(
    parseChatCompletion({
      choices: [{ message: { content: "Hello." } }],
    })
  ).toBe("Hello.");
  expect(parseChatCompletion({ choices: [] })).toBeNull();
  expect(parseChatCompletion(null)).toBeNull();
  expect(chatDelta({ choices: [{ delta: { content: "Hi" } }] })).toBe("Hi");
  expect(
    chatDelta({ choices: [{ delta: { content: null, reasoning: "think" } }] })
  ).toBeNull();
  expect(sseDelta("data: [DONE]")).toBeNull();
  expect(sseDelta('data: {"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
  expect(transcriptionText({ text: " hello " })).toBe("hello");
  expect(transcriptionText({ text: "  " })).toBeNull();
  expect(transcriptionText(null)).toBeNull();
  expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
});

test("a chat stream keeps answer text and skips reasoning", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
      );
      controller.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"reasoning":"x","content":"!"}}]}\n'
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n"));
      controller.close();
    },
  });
  const parts: string[] = [];
  expect(await readChatStream(stream, (chunk) => parts.push(chunk))).toBe(
    "Hi!"
  );
  expect(parts).toEqual(["Hi", "!"]);
});
