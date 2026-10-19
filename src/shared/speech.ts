export const VOICE_SOURCE = "voice";
export const SPEECH_RATE = 16_000;
export const SPEECH_MODEL_NAME = "redux-packed.gguf";
export const SPEECH_MODEL_BYTES = 213_319_296;
export const SPEECH_MODEL_SHA256 =
  "574614b9a4d9f72ab202877a7ad6a1f4bf819dd1d27b9d42dfe8cd429fcebdd5";
export const SPEECH_MODEL_URL =
  "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/redux-packed.gguf";
export const SILENCE_RMS = 0.008;

export type SpeechModelPhase = "missing" | "downloading" | "ready" | "error";

export interface SpeechModelState {
  error: string;
  phase: SpeechModelPhase;
  received: number;
  total: number;
}

export type SpeechModelEvent =
  | { error: string; type: "fail" }
  | { received: number; total: number; type: "progress" }
  | { type: "ready" }
  | { type: "reset" }
  | { total: number; type: "start" };

export interface VoiceStatus {
  error: string;
  phase: "cleaning" | "downloading" | "error" | "transcribing";
  received: number;
  total: number;
}

export const initialSpeechModel = (): SpeechModelState => ({
  error: "",
  phase: "missing",
  received: 0,
  total: 0,
});

export const reduceSpeechModel = (
  state: SpeechModelState,
  event: SpeechModelEvent
): SpeechModelState => {
  switch (event.type) {
    case "fail": {
      return {
        error: event.error,
        phase: "error",
        received: state.received,
        total: state.total,
      };
    }
    case "progress": {
      const total = event.total > 0 ? event.total : state.total;
      const received = Math.max(0, event.received);
      return {
        error: "",
        phase: "downloading",
        received: total > 0 ? Math.min(received, total) : received,
        total,
      };
    }
    case "ready": {
      const total = state.total > 0 ? state.total : state.received;
      return {
        error: "",
        phase: "ready",
        received: total,
        total,
      };
    }
    case "reset": {
      return initialSpeechModel();
    }
    case "start": {
      return {
        error: "",
        phase: "downloading",
        received: 0,
        total: Math.max(0, event.total),
      };
    }
    default: {
      return state;
    }
  }
};

export const modelFileReady = (size: number): boolean =>
  size === SPEECH_MODEL_BYTES;

type Pcm = Iterable<number> & { readonly length: number };

export const pcmRms = (samples: Pcm): number => {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
};

export const isSilentPcm = (samples: Pcm, floor = SILENCE_RMS): boolean =>
  pcmRms(samples) < floor;

/** Blank, whitespace, or punctuation-only text is not a slip. */
export const transcriptToSlip = (text: string): string | null => {
  const collapsed = text.replaceAll(/\s+/gu, " ").trim();
  if (collapsed.length === 0 || !/\p{L}|\p{N}/u.test(collapsed)) {
    return null;
  }
  return collapsed;
};

export const voiceSlipText = (
  samples: Pcm,
  transcript: string
): string | null => {
  if (isSilentPcm(samples)) {
    return null;
  }
  return transcriptToSlip(transcript);
};

export const resampleLinear = (
  input: ArrayLike<number>,
  fromRate: number,
  toRate: number
): Float32Array => {
  if (input.length === 0 || fromRate <= 0 || toRate <= 0) {
    return new Float32Array();
  }
  if (fromRate === toRate) {
    return Float32Array.from(input);
  }
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const scale = fromRate / toRate;
  const last = input.length - 1;
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * scale;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, last);
    const frac = pos - left;
    const start = input[left] ?? 0;
    const end = input[right] ?? start;
    out[i] = start + (end - start) * frac;
  }
  return out;
};

const writeAscii = (view: DataView, offset: number, value: string): void => {
  let index = offset;
  for (const char of value) {
    view.setUint8(index, char.codePointAt(0) ?? 0);
    index += 1;
  }
};

export const encodeWavPcm16 = (
  samples: ArrayLike<number>,
  sampleRate: number
): Uint8Array => {
  const count = samples.length;
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(
      44 + i * 2,
      sample < 0 ? sample * 0x80_00 : sample * 0x7f_ff,
      true
    );
  }
  return bytes;
};

const readAscii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCodePoint(...bytes.subarray(offset, offset + length));

export const wavPcm16 = (
  bytes: Uint8Array
): { rate: number; samples: Float32Array } | null => {
  if (bytes.byteLength < 44) {
    return null;
  }
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1) {
    return null;
  }
  if (view.getUint16(34, true) !== 16) {
    return null;
  }
  const rate = view.getUint32(24, true);
  const count = Math.floor((bytes.byteLength - 44) / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = view.getInt16(44 + i * 2, true) / 0x80_00;
  }
  return { rate, samples };
};
