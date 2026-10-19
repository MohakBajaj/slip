import type { CleanupRequest } from "./cleanup";
import type { GatewayModel } from "./gateway-models";
import { minimumReasoning } from "./gateway-models";

export const GATEWAY_CHAT_URL =
  "https://ai-gateway.vercel.sh/v1/chat/completions";
export const GATEWAY_GENERATION_URL =
  "https://ai-gateway.vercel.sh/v1/generation";
export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
export const GATEWAY_TRANSCRIBE_URL =
  "https://ai-gateway.vercel.sh/v4/ai/transcription-model";

export interface MeasuredUsage {
  audioTokens?: number;
  completionTokens?: number;
  cost?: number;
  generationId?: string;
  promptTokens?: number;
  seconds?: number;
}

const TRANSCRIBE_SPEC = "4";
const PROTOCOL = "0.0.1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isList = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

const finite = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const nested = (
  value: unknown,
  key: string
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const child = value[key];
  return isRecord(child) ? child : undefined;
};

const generationIdOf = (
  payload: Record<string, unknown>,
  gateway: Record<string, unknown> | undefined
): string | undefined => {
  const fromGateway = gateway?.generationId ?? gateway?.generation_id;
  if (typeof fromGateway === "string" && fromGateway.startsWith("gen_")) {
    return fromGateway;
  }
  return typeof payload.id === "string" && payload.id.startsWith("gen_")
    ? payload.id
    : undefined;
};

const firstFinite = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const parsed = finite(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
};

const reportedCost = (
  body: Record<string, unknown>,
  usage: Record<string, unknown> | undefined,
  gateway: Record<string, unknown> | undefined
): number | undefined =>
  firstFinite(
    body.total_cost,
    body.gateway_cost,
    body.cost,
    typeof body.usage === "number" ? body.usage : undefined,
    usage?.cost,
    usage?.total_cost,
    gateway?.totalCost,
    gateway?.total_cost,
    gateway?.cost
  );

const compactUsage = (usage: MeasuredUsage): MeasuredUsage => {
  const next: MeasuredUsage = {};
  if (usage.audioTokens !== undefined) {
    next.audioTokens = usage.audioTokens;
  }
  if (usage.completionTokens !== undefined) {
    next.completionTokens = usage.completionTokens;
  }
  if (usage.cost !== undefined) {
    next.cost = usage.cost;
  }
  if (usage.generationId !== undefined) {
    next.generationId = usage.generationId;
  }
  if (usage.promptTokens !== undefined) {
    next.promptTokens = usage.promptTokens;
  }
  if (usage.seconds !== undefined) {
    next.seconds = usage.seconds;
  }
  return next;
};

/** Tokens, duration, dollar cost, and generation id from a gateway payload. */
export const measureUsage = (payload: unknown): MeasuredUsage => {
  const root = isRecord(payload) ? payload : undefined;
  const body = nested(root, "data") ?? root;
  if (body === undefined) {
    return {};
  }
  const usage = nested(body, "usage");
  const details = nested(usage, "input_token_details");
  const gateway =
    nested(nested(body, "providerMetadata"), "gateway") ??
    nested(nested(body, "provider_metadata"), "gateway");
  const generationId = generationIdOf(body, gateway);
  return compactUsage({
    audioTokens: firstFinite(details?.audio_tokens, usage?.audio_tokens),
    completionTokens: firstFinite(
      usage?.completion_tokens,
      usage?.output_tokens,
      usage?.tokens_completion,
      body.tokens_completion
    ),
    cost: reportedCost(body, usage, gateway),
    generationId,
    promptTokens: firstFinite(
      usage?.prompt_tokens,
      usage?.input_tokens,
      usage?.tokens_prompt,
      body.tokens_prompt
    ),
    seconds: firstFinite(
      body.durationInSeconds,
      body.duration_in_seconds,
      usage?.type === "duration" ? usage.seconds : undefined,
      usage?.seconds
    ),
  });
};

export const mergeUsage = (
  current: MeasuredUsage,
  next: MeasuredUsage
): MeasuredUsage => ({
  audioTokens: next.audioTokens ?? current.audioTokens,
  completionTokens: next.completionTokens ?? current.completionTokens,
  cost: next.cost ?? current.cost,
  generationId: next.generationId ?? current.generationId,
  promptTokens: next.promptTokens ?? current.promptTokens,
  seconds: next.seconds ?? current.seconds,
});

export const lookupGeneration = async (opts: {
  apiKey: string;
  id: string;
  signal?: AbortSignal;
}): Promise<MeasuredUsage | null> => {
  if (!opts.id.startsWith("gen_")) {
    return null;
  }
  try {
    const response = await fetch(
      `${GATEWAY_GENERATION_URL}?id=${encodeURIComponent(opts.id)}`,
      {
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        signal: opts.signal,
      }
    );
    if (!response.ok) {
      return null;
    }
    return measureUsage(await response.json());
  } catch {
    return null;
  }
};

const pricedUsage = async (
  usage: MeasuredUsage,
  apiKey: string,
  signal?: AbortSignal
): Promise<MeasuredUsage> => {
  if (
    usage.cost !== undefined ||
    usage.generationId === undefined ||
    apiKey.length === 0
  ) {
    return usage;
  }
  const looked = await lookupGeneration({
    apiKey,
    id: usage.generationId,
    signal,
  });
  return looked === null ? usage : mergeUsage(usage, looked);
};

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

const ssePayload = (line: string): unknown => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }
  const data = trimmed.slice("data:".length).trim();
  if (data.length === 0 || data === "[DONE]") {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const takeLine = (
  text: string,
  usage: MeasuredUsage,
  line: string,
  onDelta?: (chunk: string) => void
): { text: string; usage: MeasuredUsage } => {
  const payload = ssePayload(line);
  if (payload === null) {
    return { text, usage };
  }
  const piece = chatDelta(payload);
  if (piece !== null && piece.length > 0) {
    onDelta?.(piece);
    return {
      text: text + piece,
      usage: mergeUsage(usage, measureUsage(payload)),
    };
  }
  return { text, usage: mergeUsage(usage, measureUsage(payload)) };
};

export const readChatStream = async (
  body: ReadableStream<Uint8Array>,
  onDelta?: (chunk: string) => void
): Promise<{ text: string; usage: MeasuredUsage }> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: MeasuredUsage = {};
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
      ({ text, usage } = takeLine(text, usage, line, onDelta));
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    ({ text, usage } = takeLine(text, usage, buffer, onDelta));
  }
  return { text, usage };
};

export const streamChatCompletion = async (opts: {
  apiKey: string;
  body: Record<string, unknown>;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
  url?: string;
}): Promise<{ text: string; usage: MeasuredUsage }> => {
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
    const payload: unknown = await response.json();
    const text = parseChatCompletion(payload);
    if (text === null) {
      throw new Error("Cleanup endpoint returned nothing");
    }
    opts.onDelta?.(text);
    return {
      text,
      usage: await pricedUsage(measureUsage(payload), opts.apiKey, opts.signal),
    };
  }
  const streamed = await readChatStream(response.body, opts.onDelta);
  return {
    text: streamed.text,
    usage: await pricedUsage(streamed.usage, opts.apiKey, opts.signal),
  };
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
}): Promise<{ text: string; usage: MeasuredUsage }> => {
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
  const payload: unknown = await response.json();
  const text = transcriptionText(payload);
  if (text === null) {
    throw new Error("Transcription endpoint returned nothing");
  }
  return { text, usage: measureUsage(payload) };
};
