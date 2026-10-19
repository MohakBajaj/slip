import { expect, test } from "bun:test";

import {
  bytesToBase64,
  chatDelta,
  gatewayErrorMessage,
  measureUsage,
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

test("gateway errors keep a truncated body", () => {
  const detail = "Invalid option: expected one of none";
  expect(gatewayErrorMessage("Cleanup endpoint", 400, `  ${detail}\n`)).toBe(
    `Cleanup endpoint returned 400: ${detail}`
  );
  expect(gatewayErrorMessage("Transcription endpoint", 401, "")).toBe(
    "Transcription endpoint returned 401"
  );
  const long = "x".repeat(200);
  expect(gatewayErrorMessage("Cleanup endpoint", 400, long)).toBe(
    `Cleanup endpoint returned 400: ${"x".repeat(180)}…`
  );
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
      controller.enqueue(
        encoder.encode(
          'data: {"id":"gen_abc","usage":{"prompt_tokens":3,"completion_tokens":2},"choices":[]}\n'
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n"));
      controller.close();
    },
  });
  const parts: string[] = [];
  const result = await readChatStream(stream, (chunk) => parts.push(chunk));
  expect(result.text).toBe("Hi!");
  expect(result.usage).toEqual({
    completionTokens: 2,
    generationId: "gen_abc",
    promptTokens: 3,
  });
  expect(parts).toEqual(["Hi", "!"]);
});

test("usage reads chat tokens, generation cost, and transcription duration", () => {
  expect(
    measureUsage({
      id: "gen_01",
      usage: { completion_tokens: 28, prompt_tokens: 15 },
    })
  ).toEqual({
    completionTokens: 28,
    generationId: "gen_01",
    promptTokens: 15,
  });
  expect(
    measureUsage({
      data: {
        id: "gen_01",
        tokens_completion: 50,
        tokens_prompt: 100,
        total_cost: 0.00123,
      },
    }).cost
  ).toBe(0.00123);
  expect(
    measureUsage({
      durationInSeconds: 12.5,
      providerMetadata: { gateway: { totalCost: 0.004 } },
      text: "hello",
      usage: {
        input_token_details: { audio_tokens: 300 },
        input_tokens: 300,
        output_tokens: 4,
        type: "tokens",
      },
    })
  ).toEqual({
    audioTokens: 300,
    completionTokens: 4,
    cost: 0.004,
    promptTokens: 300,
    seconds: 12.5,
  });
});
