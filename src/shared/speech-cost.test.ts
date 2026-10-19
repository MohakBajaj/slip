import { expect, test } from "bun:test";

import {
  costTip,
  estimateTokens,
  formatUsd,
  languageSpend,
  slipSpeechCost,
  transcriptionSpend,
} from "./speech-cost";

test("chat cost prefers a reported dollar amount, then token counts", () => {
  const pricing = { input: "0.00000004", output: "0.00000015" };
  expect(
    languageSpend({
      completionText: "hi",
      pricing,
      promptText: "hello",
      usage: { completionTokens: 20, cost: 0.0003, promptTokens: 1000 },
    })
  ).toBe(0.0003);
  expect(
    languageSpend({
      completionText: "hi",
      pricing,
      promptText: "hello",
      usage: { completionTokens: 20, promptTokens: 1000 },
    })
  ).toBe(0.000043);
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("abcde")).toBe(2);
  expect(
    languageSpend({
      completionText: "abcd",
      pricing,
      promptText: "abcdefgh",
      usage: {},
    })
  ).toBe(0.00000023);
});

test("transcription cost uses duration, otherwise audio tokens", () => {
  expect(
    transcriptionSpend({
      pricing: { transcription_duration_cost_per_second: "0.00002778" },
      seconds: 10,
      usage: {},
    })
  ).toBe(0.0002778);
  expect(
    transcriptionSpend({
      pricing: { transcription_duration_cost_per_second: "0.00002778" },
      seconds: 10,
      usage: { seconds: 4 },
    })
  ).toBe(0.00011112);
  expect(
    transcriptionSpend({
      pricing: {
        audio_input_token_cost: "0.00000125",
        output: "0.000005",
      },
      seconds: 10,
      usage: { audioTokens: 1000, completionTokens: 10 },
    })
  ).toBe(0.0013);
  expect(
    transcriptionSpend({
      pricing: { audio_input_token_cost: "0.00000125" },
      seconds: 10,
      usage: { cost: 0.02 },
    })
  ).toBe(0.02);
});

test("a voice slip adds the two steps, and on-device is free", () => {
  const cost = slipSpeechCost({
    cleanup: { cost: 0.0002, model: "inception/mercury-2.5" },
    transcription: { cost: 0, model: "Parakeet" },
  });
  expect(cost.total).toBe(0.0002);
  expect(formatUsd(cost.total)).toBe("$0.0002");
  expect(formatUsd(0)).toBe("$0");
  expect(formatUsd(0.00008)).toBe("$0.00008");
  expect(costTip(cost)).toBe(
    "Transcription Parakeet $0\nCleanup inception/mercury-2.5 $0.0002"
  );
  expect(
    slipSpeechCost({
      cleanup: { cost: 0.00015, model: "inception/mercury-2.5" },
      transcription: { cost: 0.00015, model: "microsoft/mai-transcribe-2" },
    }).total
  ).toBe(0.0003);
});
