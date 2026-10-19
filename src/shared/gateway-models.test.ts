import { expect, test } from "bun:test";

import { cleanupRequest } from "./cleanup";
import payload from "./fixtures/gateway-models.json" with { type: "json" };
import { chatCompletionBody } from "./gateway-api";
import {
  CLEANUP_RECOMMENDED,
  catalogChoices,
  findModel,
  listModelChoices,
  minimumReasoning,
  modelSortPrice,
  parseGatewayModels,
  priceLabel,
  TRANSCRIBE_RECOMMENDED,
} from "./gateway-models";
import {
  DEFAULT_CLOUD_CLEANUP,
  DEFAULT_CLOUD_TRANSCRIBE,
} from "./speech-engines";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

test("the bundled snapshot is the public models list", () => {
  expect(isRecord(payload)).toBe(true);
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return;
  }
  const models = parseGatewayModels(payload);
  expect(models.length).toBe(payload.data.length);
  expect(models.some((model) => model.type === "language")).toBe(true);
  expect(models.some((model) => model.type === "transcription")).toBe(true);

  const cleanup = listModelChoices(models, "language");
  expect(
    cleanup.slice(0, CLEANUP_RECOMMENDED.length).map((choice) => choice.id)
  ).toEqual([...CLEANUP_RECOMMENDED]);
  expect(cleanup[0]?.id).toBe(DEFAULT_CLOUD_CLEANUP);
  expect(cleanup[0]?.group).toBe("recommended");
  const cleanupRest = cleanup.slice(CLEANUP_RECOMMENDED.length);
  expect(cleanupRest[0]?.group).toBe("rest");
  const cleanupPrices = cleanupRest.map((choice) =>
    modelSortPrice(findModel(models, choice.id) ?? models[0], "language")
  );
  for (let index = 1; index < cleanupPrices.length; index += 1) {
    expect(cleanupPrices[index] ?? 0).toBeGreaterThanOrEqual(
      cleanupPrices[index - 1] ?? 0
    );
  }

  const speech = listModelChoices(models, "transcription");
  expect(speech.slice(0, 3).map((choice) => choice.id)).toEqual(
    TRANSCRIBE_RECOMMENDED.slice(0, 3)
  );
  expect(speech[0]?.id).toBe(DEFAULT_CLOUD_TRANSCRIBE);
  expect(speech.map((choice) => choice.id)).not.toContain("spacexai/grok-stt");
  expect(speech.map((choice) => choice.id)).not.toContain(
    "google/gemini-3.5-transcribe-live"
  );
  expect(speech.map((choice) => choice.id)).not.toContain(
    "microsoft/mai-transcribe-2-streaming"
  );
  expect(speech.map((choice) => choice.id)).not.toContain(
    "openai/gpt-realtime-whisper"
  );
  const speechRest = speech.slice(3);
  const speechPrices = speechRest.map((choice) =>
    modelSortPrice(findModel(models, choice.id) ?? models[0], "transcription")
  );
  for (let index = 1; index < speechPrices.length; index += 1) {
    expect(speechPrices[index] ?? 0).toBeGreaterThanOrEqual(
      speechPrices[index - 1] ?? 0
    );
  }

  expect(
    priceLabel(
      findModel(models, "alibaba/qwen3.7-flash") ?? models[0],
      "language"
    )
  ).toBe("$0.03 / $0.13");
  expect(
    priceLabel(
      findModel(models, "microsoft/mai-transcribe-2") ?? models[0],
      "transcription"
    )
  ).toBe("$0.0017/min");
  expect(
    priceLabel(
      findModel(models, "openai/whisper-1") ?? models[0],
      "transcription"
    )
  ).toBe("$0.006/min");
  expect(
    priceLabel(
      findModel(models, "openai/gpt-4o-mini-transcribe") ?? models[0],
      "transcription"
    )
  ).toBe("$1.25/1M audio");
});

test("reasoning is minimized and temperature is sent only when supported", () => {
  const models = parseGatewayModels(payload);
  const qwen = findModel(models, "alibaba/qwen3.7-flash");
  const oss = findModel(models, "openai/gpt-oss-20b");
  const mercury = findModel(models, "inception/mercury-2.5");
  const haiku = findModel(models, "anthropic/claude-haiku-4.5");
  const haiku55 = findModel(models, "anthropic/claude-haiku-5.5");
  expect(minimumReasoning(qwen)).toEqual({ effort: "none" });
  expect(minimumReasoning(oss)).toEqual({ effort: "low" });
  expect(minimumReasoning(mercury)).toEqual({ effort: "none" });
  expect(minimumReasoning(haiku)).toEqual({ enabled: false });
  expect(minimumReasoning(haiku55)).toEqual({ effort: "none" });
  expect(minimumReasoning(undefined)).toBeUndefined();

  const request = cleanupRequest("hello");
  const qwenBody = chatCompletionBody({
    modelId: "alibaba/qwen3.7-flash",
    record: qwen,
    request,
    stream: true,
  });
  expect(qwenBody.temperature).toBe(0);
  expect(qwenBody.reasoning).toEqual({ effort: "none" });
  expect(qwenBody.stream).toBe(true);
  expect(qwenBody.max_tokens).toBe(
    Math.max(
      256,
      Math.ceil((request.instructions.length + request.prompt.length) / 4) * 2
    )
  );
  const haikuBody = chatCompletionBody({
    modelId: "anthropic/claude-haiku-5.5",
    record: haiku55,
    request,
    stream: true,
  });
  expect(haikuBody.temperature).toBeUndefined();
  expect(haikuBody.reasoning).toEqual({ effort: "none" });
});

test("catalog instant effort is sent as none", () => {
  const allowed = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const instant = {
    id: "example/instant",
    name: "Instant",
    pricing: {},
    reasoning: [{ type: "effort" as const, values: ["instant", "low"] }],
    tags: [],
    temperature: true,
    type: "language",
  };
  expect(minimumReasoning(instant)).toEqual({ effort: "none" });
  expect(
    minimumReasoning({
      ...instant,
      reasoning: [{ type: "effort", values: ["turbo"] }],
    })
  ).toBeUndefined();
  const models = parseGatewayModels(payload);
  for (const model of models) {
    const effort = minimumReasoning(model)?.effort;
    if (effort !== undefined) {
      expect(allowed).toContain(effort);
    }
  }
});

test("recommended skips free and stealth, then price sorts the rest", () => {
  const models = parseGatewayModels({
    data: [
      {
        id: "alibaba/qwen3.7-flash",
        name: "Qwen",
        pricing: { input: "0.000009", output: "0.000009" },
        tags: ["free"],
        type: "language",
      },
      {
        id: "a/cheap",
        name: "Cheap",
        pricing: { input: "0.0000001", output: "0.0000001" },
        tags: [],
        type: "language",
      },
      {
        id: "z/dear",
        name: "Dear",
        pricing: { input: "0.000002", output: "0.000002" },
        tags: ["stealth"],
        type: "language",
      },
      {
        id: "spacexai/grok-stt",
        name: "Grok",
        pricing: { transcription_duration_cost_per_second: "0.000001" },
        tags: ["websocket-transcription"],
        type: "transcription",
      },
      {
        id: "b/late",
        name: "Late",
        pricing: { audio_input_token_cost: "0.0000002" },
        tags: [],
        type: "transcription",
      },
      {
        id: "a/early",
        name: "Early",
        pricing: { transcription_duration_cost_per_second: "0.00005" },
        tags: [],
        type: "transcription",
      },
      {
        id: "microsoft/mai-transcribe-2",
        name: "MAI",
        pricing: { transcription_duration_cost_per_second: "0.0002" },
        tags: [],
        type: "transcription",
      },
    ],
  });
  expect(
    listModelChoices(models, "language").map((choice) => choice.id)
  ).toEqual(["a/cheap", "z/dear", "alibaba/qwen3.7-flash"]);
  expect(
    listModelChoices(models, "language").every(
      (choice) => choice.group === "rest"
    )
  ).toBe(true);
  expect(
    listModelChoices(models, "transcription").map((choice) => choice.id)
  ).toEqual(["microsoft/mai-transcribe-2", "b/late", "a/early"]);
  const both = parseGatewayModels({
    data: [
      {
        id: "both",
        name: "Both",
        pricing: {
          audio_input_token_cost: "9",
          transcription_duration_cost_per_second: "0.00001",
        },
        type: "transcription",
      },
    ],
  });
  expect(modelSortPrice(both[0] ?? models[0], "transcription")).toBe(0.00001);
  expect(catalogChoices(models).transcription[0]?.group).toBe("recommended");
});

test("a malformed catalog is empty", () => {
  expect(parseGatewayModels(null)).toEqual([]);
  expect(
    parseGatewayModels({ data: [{ id: "", name: "x", type: "language" }] })
  ).toEqual([]);
  expect(parseGatewayModels({ data: [{ name: "x" }] })).toEqual([]);
});
