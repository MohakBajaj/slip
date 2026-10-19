import { describe, expect, test } from "bun:test";

import {
  encodeWavPcm16,
  initialSpeechModel,
  isSilentPcm,
  modelFileReady,
  reduceSpeechModel,
  resampleLinear,
  SPEECH_MODEL_BYTES,
  SPEECH_RATE,
  transcriptToSlip,
  voiceSlipText,
  wavPcm16,
} from "./speech";

describe("transcript to slip", () => {
  test("keeps spoken words", () => {
    expect(transcriptToSlip("  hello   there  ")).toBe("hello there");
  });

  test("empty and silent text save nothing", () => {
    expect(transcriptToSlip("")).toBeNull();
    expect(transcriptToSlip("   \n")).toBeNull();
    expect(transcriptToSlip("... --- !!!")).toBeNull();
    expect(voiceSlipText([0, 0, 0, 0], "hello")).toBeNull();
    expect(voiceSlipText([0.2, -0.2, 0.2], "")).toBeNull();
    expect(voiceSlipText([0.2, -0.2, 0.2], "hello there")).toBe("hello there");
  });
});

describe("pcm", () => {
  test("silence is quiet and a tone is not", () => {
    expect(isSilentPcm([0, 0, 0, 0])).toBe(true);
    expect(isSilentPcm([0.2, -0.25, 0.2, -0.2])).toBe(false);
  });

  test("resample halves a double-rate ramp", () => {
    const input = Float32Array.from({ length: 8 }, (_, i) => i / 8);
    const out = resampleLinear(input, 32_000, SPEECH_RATE);
    expect(out.length).toBe(4);
  });

  test("wav round trip keeps the sample rate and the words gate", () => {
    const samples = Float32Array.from([0, 0.4, -0.4, 0.4, -0.4]);
    const wav = encodeWavPcm16(samples, SPEECH_RATE);
    const decoded = wavPcm16(wav);
    expect(decoded?.rate).toBe(SPEECH_RATE);
    expect(decoded?.samples.length).toBe(samples.length);
    expect(decoded === null ? null : voiceSlipText(decoded.samples, "hi")).toBe(
      "hi"
    );
    expect(
      wavPcm16(encodeWavPcm16(new Float32Array(8), SPEECH_RATE))
    ).not.toBeNull();
    expect(
      voiceSlipText(new Float32Array(8), "hello from the void")
    ).toBeNull();
  });
});

describe("model download state", () => {
  test("progress reaches ready and failure keeps the count", () => {
    const started = reduceSpeechModel(initialSpeechModel(), {
      total: SPEECH_MODEL_BYTES,
      type: "start",
    });
    expect(started.phase).toBe("downloading");
    const mid = reduceSpeechModel(started, {
      received: SPEECH_MODEL_BYTES + 10,
      total: SPEECH_MODEL_BYTES,
      type: "progress",
    });
    expect(mid.received).toBe(SPEECH_MODEL_BYTES);
    const ready = reduceSpeechModel(mid, { type: "ready" });
    expect(ready.phase).toBe("ready");
    expect(modelFileReady(ready.received)).toBe(true);
    const failed = reduceSpeechModel(mid, {
      error: "offline",
      type: "fail",
    });
    expect(failed.phase).toBe("error");
    expect(failed.error).toBe("offline");
    expect(failed.received).toBe(SPEECH_MODEL_BYTES);
    expect(reduceSpeechModel(failed, { type: "reset" }).phase).toBe("missing");
  });

  test("a short file is not the model", () => {
    expect(modelFileReady(0)).toBe(false);
    expect(modelFileReady(SPEECH_MODEL_BYTES)).toBe(true);
  });
});
