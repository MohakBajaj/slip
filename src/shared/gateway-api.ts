import type { CleanupRequest } from "./cleanup";
import type { GatewayModel } from "./gateway-models";
import { minimumReasoning } from "./gateway-models";

export const GATEWAY_CHAT_URL =
  "https://ai-gateway.vercel.sh/v1/chat/completions";
export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
export const GATEWAY_TRANSCRIBE_URL =
  "https://ai-gateway.vercel.sh/v4/ai/transcription-model";

const TRANSCRIBE_SPEC = "4";
const PROTOCOL = "0.0.1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isList = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

const ERROR_BODY_LIMIT = 180;

/** Reply cap: twice the input estimate, and at least 256 tokens. */
const completionCap = (request: CleanupRequest): number =>
  Math.max(
    256,
    Math.ceil((request.instructions.length + request.prompt.length) / 4) * 2
  );

export const gatewayErrorMessage = (
  label: string,
  status: number,
  body: string
): string => {
  const flat = body.trim().replaceAll(/\s+/gu, " ");
  if (flat.length === 0) {
    return `${label} returned ${status}`;
  }
  const detail =
    flat.length > ERROR_BODY_LIMIT
      ? `${flat.slice(0, ERROR_BODY_LIMIT)}…`
      : flat;
  return `${label} returned ${status}: ${detail}`;
};

const failure = async (label: string, response: Response): Promise<Error> => {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  return new Error(gatewayErrorMessage(label, response.status, body));
};

export const chatCompletionBody = (opts: {
  modelId: string;
  record: GatewayModel | undefined;
  request: CleanupRequest;
  stream: boolean;
}): Record<string, unknown> => {
  const reasoning = minimumReasoning(opts.record);
  const body: Record<string, unknown> = {
    max_tokens: completionCap(opts.request),
    messages: [
      { content: opts.request.instructions, role: "system" },
      { content: opts.request.prompt, role: "user" },
    ],
    model: opts.modelId,
    stream: opts.stream,
  };
  if (reasoning !== undefined) {
    body.reasoning = reasoning;
  }
  if (opts.record?.temperature === true) {
    body.temperature = 0;
  }
  return body;
};

export const parseChatCompletion = (payload: unknown): string | null => {
  if (!isRecord(payload) || !isList(payload.choices)) {
    return null;
  }
  const [first] = payload.choices;
  if (!isRecord(first) || !isRecord(first.message)) {
    return null;
  }
  const { content } = first.message;
  return typeof content === "string" ? content : null;
};

export const chatDelta = (payload: unknown): string | null => {
  if (!isRecord(payload) || !isList(payload.choices)) {
    return null;
  }
  const [first] = payload.choices;
  if (!isRecord(first) || !isRecord(first.delta)) {
    return null;
  }
  const { content } = first.delta;
  return typeof content === "string" ? content : null;
};

export const sseDelta = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }
  const data = trimmed.slice("data:".length).trim();
  if (data.length === 0 || data === "[DONE]") {
    return null;
  }
  try {
    return chatDelta(JSON.parse(data));
  } catch {
    return null;
  }
};

const appendDelta = (
  text: string,
  line: string,
  onDelta?: (chunk: string) => void
): string => {
  const piece = sseDelta(line);
  if (piece === null || piece.length === 0) {
    return text;
  }
  onDelta?.(piece);
  return text + piece;
};

export const readChatStream = async (
  body: ReadableStream<Uint8Array>,
  onDelta?: (chunk: string) => void
): Promise<string> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames arrive in order
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      text = appendDelta(text, line, onDelta);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    text = appendDelta(text, buffer, onDelta);
  }
  return text;
};

export const streamChatCompletion = async (opts: {
  apiKey: string;
  body: Record<string, unknown>;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
  url?: string;
}): Promise<string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.apiKey.length > 0) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  const response = await fetch(opts.url ?? GATEWAY_CHAT_URL, {
    body: JSON.stringify(opts.body),
    headers,
    method: "POST",
    signal: opts.signal,
  });
  if (!response.ok) {
    throw await failure("Cleanup endpoint", response);
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.body === null || type.includes("application/json")) {
    const text = parseChatCompletion(await response.json());
    if (text === null) {
      throw new Error("Cleanup endpoint returned nothing");
    }
    opts.onDelta?.(text);
    return text;
  }
  return await readChatStream(response.body, opts.onDelta);
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunk = 32_768;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

export const transcriptionText = (payload: unknown): string | null => {
  if (!isRecord(payload) || typeof payload.text !== "string") {
    return null;
  }
  const text = payload.text.trim();
  return text.length > 0 ? text : null;
};

export const transcribeAudio = async (opts: {
  apiKey: string;
  audio: Uint8Array;
  mediaType: string;
  model: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const response = await fetch(GATEWAY_TRANSCRIBE_URL, {
    body: JSON.stringify({
      audio: bytesToBase64(opts.audio),
      mediaType: opts.mediaType,
    }),
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "ai-gateway-protocol-version": PROTOCOL,
      "ai-model-id": opts.model,
      "ai-transcription-model-specification-version": TRANSCRIBE_SPEC,
    },
    method: "POST",
    signal: opts.signal,
  });
  if (!response.ok) {
    throw await failure("Transcription endpoint", response);
  }
  const text = transcriptionText(await response.json());
  if (text === null) {
    throw new Error("Transcription endpoint returned nothing");
  }
  return text;
};
