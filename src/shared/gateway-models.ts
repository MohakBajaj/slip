export type ModelKind = "language" | "transcription";
export type ModelGroup = "recommended" | "rest";

export interface GatewayPricing {
  audio_input_token_cost?: string;
  input?: string;
  output?: string;
  transcription_duration_cost_per_second?: string;
}

export type ReasoningOption =
  | { max?: number; min?: number; type: "budget_tokens" }
  | { type: "effort"; values: string[] }
  | { type: "toggle" };

export interface GatewayModel {
  id: string;
  name: string;
  pricing: GatewayPricing;
  reasoning: ReasoningOption[];
  tags: string[];
  temperature: boolean;
  type: string;
}

export interface ModelChoice {
  group: ModelGroup;
  id: string;
  name: string;
  price: string;
}

export interface GatewayCatalog {
  cleanup: ModelChoice[];
  transcription: ModelChoice[];
}

export interface ReasoningRequest {
  effort?: string;
  enabled?: boolean;
  max_tokens?: number;
}

const WEBSOCKET_TAG = "websocket-transcription";
const SKIP_RECOMMENDED = new Set(["free", "stealth"]);

/**
 * Cleanup models that kept the note in gateway benches.
 * Mercury is first: fastest that did not summarize, with effort none.
 */
export const CLEANUP_RECOMMENDED = [
  "inception/mercury-2.5",
  "alibaba/qwen3.7-flash",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-oss-120b",
] as const;

/**
 * File transcription picks. `spacexai/grok-stt` stays in the list so it
 * appears if the catalog stops tagging it websocket-only.
 */
export const TRANSCRIBE_RECOMMENDED = [
  "microsoft/mai-transcribe-2",
  "openai/gpt-4o-mini-transcribe",
  "openai/whisper-1",
  "spacexai/grok-stt",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const priceNumber = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const priceString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

const parsePricing = (value: unknown): GatewayPricing => {
  if (!isRecord(value)) {
    return {};
  }
  const pricing: GatewayPricing = {};
  const audio = priceString(value.audio_input_token_cost);
  const input = priceString(value.input);
  const output = priceString(value.output);
  const duration = priceString(value.transcription_duration_cost_per_second);
  if (audio !== undefined) {
    pricing.audio_input_token_cost = audio;
  }
  if (input !== undefined) {
    pricing.input = input;
  }
  if (output !== undefined) {
    pricing.output = output;
  }
  if (duration !== undefined) {
    pricing.transcription_duration_cost_per_second = duration;
  }
  return pricing;
};

const parseReasoning = (value: unknown): ReasoningOption[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const options: ReasoningOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type === "toggle") {
      options.push({ type: "toggle" });
      continue;
    }
    if (
      item.type === "effort" &&
      Array.isArray(item.values) &&
      item.values.every((entry) => typeof entry === "string")
    ) {
      options.push({ type: "effort", values: item.values });
      continue;
    }
    if (item.type === "budget_tokens") {
      const option: {
        max?: number;
        min?: number;
        type: "budget_tokens";
      } = { type: "budget_tokens" };
      if (typeof item.min === "number") {
        option.min = item.min;
      }
      if (typeof item.max === "number") {
        option.max = item.max;
      }
      options.push(option);
    }
  }
  return options;
};

const parseModel = (value: unknown): GatewayModel | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    pricing: parsePricing(value.pricing),
    reasoning: parseReasoning(value.reasoning_options),
    tags: stringList(value.tags),
    temperature: value.temperature === true,
    type: value.type,
  };
};

export const parseGatewayModels = (payload: unknown): GatewayModel[] => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  const models: GatewayModel[] = [];
  for (const item of payload.data) {
    const model = parseModel(item);
    if (model !== null) {
      models.push(model);
    }
  }
  return models;
};

export const isFileTranscription = (model: GatewayModel): boolean =>
  model.type === "transcription" && !model.tags.includes(WEBSOCKET_TAG);

const poolFor = (
  models: readonly GatewayModel[],
  kind: ModelKind
): GatewayModel[] =>
  models.filter((model) =>
    kind === "language" ? model.type === "language" : isFileTranscription(model)
  );

/** Duration cost when the catalog has it, otherwise audio token cost. */
export const modelSortPrice = (
  model: GatewayModel,
  kind: ModelKind
): number => {
  if (kind === "language") {
    return (
      (priceNumber(model.pricing.input) ?? 0) +
      (priceNumber(model.pricing.output) ?? 0)
    );
  }
  return (
    priceNumber(model.pricing.transcription_duration_cost_per_second) ??
    priceNumber(model.pricing.audio_input_token_cost) ??
    priceNumber(model.pricing.input) ??
    Number.POSITIVE_INFINITY
  );
};

const usd = (amount: number): string => {
  if (amount === 0) {
    return "$0";
  }
  const digits = amount >= 0.01 ? 2 : 4;
  const fixed = amount.toFixed(digits).replace(/\.?0+$/u, "");
  return `$${fixed}`;
};

export const priceLabel = (model: GatewayModel, kind: ModelKind): string => {
  if (kind === "language") {
    const input = priceNumber(model.pricing.input);
    const output = priceNumber(model.pricing.output);
    if (input === null && output === null) {
      return "";
    }
    return `${usd((input ?? 0) * 1_000_000)} / ${usd((output ?? 0) * 1_000_000)}`;
  }
  const duration = priceNumber(
    model.pricing.transcription_duration_cost_per_second
  );
  if (duration !== null) {
    return `${usd(duration * 60)}/min`;
  }
  const audio =
    priceNumber(model.pricing.audio_input_token_cost) ??
    priceNumber(model.pricing.input);
  if (audio === null) {
    return "";
  }
  return `${usd(audio * 1_000_000)}/1M audio`;
};

const byPrice =
  (kind: ModelKind) =>
  (left: GatewayModel, right: GatewayModel): number => {
    const delta = modelSortPrice(left, kind) - modelSortPrice(right, kind);
    if (delta !== 0) {
      return delta;
    }
    if (left.id === right.id) {
      return 0;
    }
    return left.id < right.id ? -1 : 1;
  };

const toChoice = (
  model: GatewayModel,
  kind: ModelKind,
  group: ModelGroup
): ModelChoice => ({
  group,
  id: model.id,
  name: model.name,
  price: priceLabel(model, kind),
});

const recommendedFor = (model: GatewayModel): boolean =>
  !model.tags.some((tag) => SKIP_RECOMMENDED.has(tag));

export const listModelChoices = (
  models: readonly GatewayModel[],
  kind: ModelKind,
  recommended: readonly string[] = kind === "language"
    ? CLEANUP_RECOMMENDED
    : TRANSCRIBE_RECOMMENDED
): ModelChoice[] => {
  const pool = poolFor(models, kind);
  const byId = new Map(pool.map((model) => [model.id, model]));
  const picked = recommended.flatMap((id) => {
    const model = byId.get(id);
    return model !== undefined && recommendedFor(model) ? [model] : [];
  });
  const pickedIds = new Set(picked.map((model) => model.id));
  const rest = pool
    .filter((model) => !pickedIds.has(model.id))
    .toSorted(byPrice(kind));
  return [
    ...picked.map((model) => toChoice(model, kind, "recommended")),
    ...rest.map((model) => toChoice(model, kind, "rest")),
  ];
};

export const catalogChoices = (
  models: readonly GatewayModel[]
): GatewayCatalog => ({
  cleanup: listModelChoices(models, "language"),
  transcription: listModelChoices(models, "transcription"),
});

export const findModel = (
  models: readonly GatewayModel[],
  id: string
): GatewayModel | undefined => models.find((model) => model.id === id);

const CHAT_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const effortValues = (model: GatewayModel): string[] => {
  const effort = model.reasoning.find(
    (option): option is { type: "effort"; values: string[] } =>
      option.type === "effort"
  );
  return effort?.values ?? [];
};

/** Catalog "instant" is not a chat effort. The endpoint accepts "none". */
const chatEfforts = (values: readonly string[]): string[] => {
  const mapped = new Set(
    values.map((value) => (value === "instant" ? "none" : value))
  );
  return CHAT_EFFORTS.filter((value) => mapped.has(value));
};

/** Smallest reasoning control the chat endpoint accepts. */
export const minimumReasoning = (
  model: GatewayModel | undefined
): ReasoningRequest | undefined => {
  if (model === undefined || model.reasoning.length === 0) {
    return undefined;
  }
  const efforts = chatEfforts(effortValues(model));
  if (efforts.includes("none")) {
    return { effort: "none" };
  }
  if (model.reasoning.some((option) => option.type === "toggle")) {
    return { enabled: false };
  }
  const [soft] = efforts;
  if (soft !== undefined) {
    return { effort: soft };
  }
  const budget = model.reasoning.find(
    (option): option is { max?: number; min?: number; type: "budget_tokens" } =>
      option.type === "budget_tokens"
  );
  if (budget !== undefined) {
    return { max_tokens: budget.min ?? 0 };
  }
  return undefined;
};
