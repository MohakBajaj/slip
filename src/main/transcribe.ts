import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { app } from "electron";

import { mergeUsage, transcribeAudio } from "../shared/gateway-api";
import type { MeasuredUsage } from "../shared/gateway-api";
import {
  encodeWavPcm16,
  isSilentPcm,
  modelFileReady,
  reduceSpeechModel,
  SPEECH_MODEL_BYTES,
  SPEECH_MODEL_NAME,
  SPEECH_MODEL_SHA256,
  SPEECH_MODEL_URL,
  SPEECH_RATE,
  transcriptToSlip,
  wavPcm16,
} from "../shared/speech";
import type { SpeechModelState, VoiceStatus } from "../shared/speech";
import { PARAKEET_ID } from "../shared/speech-engines";
import type { TranscribeRoute } from "../shared/speech-engines";

export interface VoiceTranscript {
  model: string;
  onDevice: boolean;
  seconds: number;
  text: string;
  usage: MeasuredUsage;
}

export const TRANSCRIBE_TIMEOUT_MS = 120_000;

export class SpeechAbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "SpeechAbortedError";
  }
}

export const bundledBin = (name: string): string => {
  const candidates = [
    path.join(process.resourcesPath, "bin", name),
    path.join(app.getAppPath(), "resources", "bin", name),
    path.join(process.cwd(), "resources", "bin", name),
  ];
  return candidates.find((item) => existsSync(item)) ?? candidates[1] ?? name;
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new SpeechAbortedError();
  }
};

const downloadModel = async (
  dest: string,
  signal: AbortSignal,
  onState: (state: SpeechModelState) => void
): Promise<void> => {
  const part = `${dest}.part`;
  let state = reduceSpeechModel(
    { error: "", phase: "missing", received: 0, total: 0 },
    { total: SPEECH_MODEL_BYTES, type: "start" }
  );
  onState(state);
  const response = await fetch(SPEECH_MODEL_URL, {
    headers: { "User-Agent": "slip" },
    signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error("Could not download the speech model");
  }
  const total = Number(
    response.headers.get("content-length") ?? SPEECH_MODEL_BYTES
  );
  state = reduceSpeechModel(state, { total, type: "start" });
  onState(state);
  await rm(part, { force: true });
  const sink = createWriteStream(part);
  const hash = createHash("sha256");
  let received = 0;
  let last = 0;
  const count = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      const now = Date.now();
      if (now - last > 150) {
        last = now;
        state = reduceSpeechModel(state, {
          received,
          total,
          type: "progress",
        });
        onState(state);
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as Parameters<typeof Readable.fromWeb>[0]
      ),
      count,
      sink,
      { signal }
    );
  } catch (error) {
    sink.destroy();
    await rm(part, { force: true });
    throw error;
  }
  if (hash.digest("hex") !== SPEECH_MODEL_SHA256) {
    await rm(part, { force: true });
    throw new Error("Speech model download was incomplete");
  }
  await rename(part, dest);
  onState(reduceSpeechModel(state, { type: "ready" }));
};

const ensureModel = async (
  dir: string,
  signal: AbortSignal,
  onState: (state: SpeechModelState) => void
): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, SPEECH_MODEL_NAME);
  if (existsSync(dest) && modelFileReady(statSync(dest).size)) {
    return dest;
  }
  await rm(dest, { force: true });
  try {
    await downloadModel(dest, signal, onState);
  } catch (error) {
    if (error instanceof SpeechAbortedError || signal.aborted) {
      throw new SpeechAbortedError();
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpeechAbortedError();
    }
    const message =
      error instanceof Error && error.message.startsWith("Speech model")
        ? error.message
        : "Could not download the speech model";
    onState(
      reduceSpeechModel(
        {
          error: "",
          phase: "downloading",
          received: 0,
          total: SPEECH_MODEL_BYTES,
        },
        { error: message, type: "fail" }
      )
    );
    throw new Error(message, { cause: error });
  }
  return dest;
};

const runCli = (
  bin: string,
  model: string,
  wavPath: string,
  signal: AbortSignal
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new SpeechAbortedError());
      return;
    }
    const child = spawn(
      bin,
      [
        "transcribe",
        "--model",
        model,
        "--input",
        wavPath,
        "--decoder",
        "tdt",
        "--vad",
        "--drop-punct-only",
      ],
      { env: { ...process.env, PARAKEET_DEVICE: "cpu" } }
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Transcription timed out"));
    }, TRANSCRIBE_TIMEOUT_MS);
    const stop = (): void => {
      clearTimeout(timer);
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) {
        reject(new SpeechAbortedError());
        return;
      }
      if (code !== 0) {
        const detail = err.trim().slice(0, 180);
        reject(new Error(detail || "Could not transcribe"));
        return;
      }
      resolve(out);
    });
  });

export const transcribeCapture = async (opts: {
  bin: string;
  modelDir: string;
  onStatus: (status: VoiceStatus) => void;
  signal: AbortSignal;
  tempDir: string;
  wav: Uint8Array;
}): Promise<string | null> => {
  const decoded = wavPcm16(opts.wav);
  if (decoded === null || decoded.rate !== SPEECH_RATE) {
    throw new Error("Could not read the recording");
  }
  if (isSilentPcm(decoded.samples)) {
    return null;
  }
  if (!existsSync(opts.bin)) {
    throw new Error("Speech engine is missing");
  }
  const model = await ensureModel(opts.modelDir, opts.signal, (state) => {
    opts.onStatus({
      error: state.error,
      phase: state.phase === "error" ? "error" : "downloading",
      received: state.received,
      total: state.total,
    });
  });
  throwIfAborted(opts.signal);
  opts.onStatus({
    error: "",
    phase: "transcribing",
    received: 0,
    total: 0,
  });
  const wavPath = path.join(
    opts.tempDir,
    `slip-voice-${Date.now().toString(36)}.wav`
  );
  await writeFile(wavPath, encodeWavPcm16(decoded.samples, decoded.rate));
  try {
    const spoken = await runCli(opts.bin, model, wavPath, opts.signal);
    return transcriptToSlip(spoken);
  } finally {
    await rm(wavPath, { force: true });
  }
};

const aborted = (error: unknown, signal: AbortSignal): boolean =>
  signal.aborted || (error instanceof Error && error.name === "AbortError");

export const transcribeVoice = async (opts: {
  bin: string;
  key: string;
  model: string;
  modelDir: string;
  onStatus: (status: VoiceStatus) => void;
  route: TranscribeRoute;
  signal: AbortSignal;
  tempDir: string;
  wav: Uint8Array;
}): Promise<VoiceTranscript | null> => {
  const decoded = wavPcm16(opts.wav);
  if (decoded === null || decoded.rate !== SPEECH_RATE) {
    throw new Error("Could not read the recording");
  }
  if (isSilentPcm(decoded.samples)) {
    return null;
  }
  const seconds = decoded.samples.length / decoded.rate;
  if (opts.route === "cloud" && opts.key.trim().length > 0) {
    opts.onStatus({
      error: "",
      phase: "transcribing",
      received: 0,
      total: 0,
    });
    try {
      const spoken = await transcribeAudio({
        apiKey: opts.key,
        audio: opts.wav,
        mediaType: "audio/wav",
        model: opts.model,
        signal: opts.signal,
      });
      const text = transcriptToSlip(spoken.text);
      if (text !== null) {
        return {
          model: opts.model,
          onDevice: false,
          seconds,
          text,
          usage: mergeUsage({ seconds }, spoken.usage),
        };
      }
      console.error("slip transcription fell back: empty transcript");
    } catch (error) {
      if (aborted(error, opts.signal)) {
        throw new SpeechAbortedError();
      }
      console.error(
        "slip transcription fell back:",
        error instanceof Error ? error.message : error
      );
      if (!existsSync(opts.bin)) {
        throw error;
      }
    }
    if (!existsSync(opts.bin)) {
      throw new Error("Transcription endpoint returned nothing");
    }
  }
  const text = await transcribeCapture(opts);
  if (text === null) {
    return null;
  }
  return {
    model: opts.route === "device" ? opts.model : PARAKEET_ID,
    onDevice: true,
    seconds,
    text,
    usage: { seconds },
  };
};
