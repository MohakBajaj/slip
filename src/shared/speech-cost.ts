import type { MeasuredUsage } from "./gateway-api";
import type { GatewayPricing } from "./gateway-models";

export interface SpeechStepCost {
  cost: number;
  model: string;
}

/** Transcription plus cleanup for one voice slip. On-device steps are $0. */
export interface SlipSpeechCost {
  cleanup?: SpeechStepCost;
  total: number;
  transcription?: SpeechStepCost;
}

const rate = (value: string | undefined): number => {
  if (value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const roundUsd = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 1e8) / 1e8;
};

/** About four characters per token, used only when the gateway omits a count. */
export const estimateTokens = (text: string): number =>
  Math.max(0, Math.ceil(text.length / 4));

export const languageSpend = (opts: {
  completionText: string;
  pricing: GatewayPricing | undefined;
  promptText: string;
  usage: MeasuredUsage;
}): number => {
  if (opts.usage.cost !== undefined) {
    return roundUsd(opts.usage.cost);
  }
  const prompt = opts.usage.promptTokens ?? estimateTokens(opts.promptText);
  const completion =
    opts.usage.completionTokens ?? estimateTokens(opts.completionText);
  return roundUsd(
    prompt * rate(opts.pricing?.input) + completion * rate(opts.pricing?.output)
  );
};

export const transcriptionSpend = (opts: {
  pricing: GatewayPricing | undefined;
  seconds: number;
  usage: MeasuredUsage;
}): number => {
  if (opts.usage.cost !== undefined) {
    return roundUsd(opts.usage.cost);
  }
  const seconds = opts.usage.seconds ?? opts.seconds;
  const duration = rate(opts.pricing?.transcription_duration_cost_per_second);
  const output =
    (opts.usage.completionTokens ?? 0) * rate(opts.pricing?.output);
  if (duration > 0 && seconds > 0) {
    return roundUsd(seconds * duration + output);
  }
  const audio =
    rate(opts.pricing?.audio_input_token_cost) || rate(opts.pricing?.input);
  const tokens = opts.usage.audioTokens ?? opts.usage.promptTokens ?? 0;
  return roundUsd(tokens * audio + output);
};

export const slipSpeechCost = (steps: {
  cleanup?: SpeechStepCost;
  transcription?: SpeechStepCost;
}): SlipSpeechCost => {
  const cost: SlipSpeechCost = {
    total: roundUsd(
      (steps.transcription?.cost ?? 0) + (steps.cleanup?.cost ?? 0)
    ),
  };
  if (steps.transcription) {
    cost.transcription = {
      cost: roundUsd(steps.transcription.cost),
      model: steps.transcription.model,
    };
  }
  if (steps.cleanup) {
    cost.cleanup = {
      cost: roundUsd(steps.cleanup.cost),
      model: steps.cleanup.model,
    };
  }
  return cost;
};

export const formatUsd = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "$0";
  }
  if (amount >= 0.01) {
    const digits = amount >= 1 ? 2 : 4;
    return `$${amount.toFixed(digits).replace(/\.?0+$/u, "")}`;
  }
  const digits = amount >= 0.0001 ? 4 : 6;
  return `$${amount.toFixed(digits).replace(/0+$/u, "")}`;
};

export const costTip = (cost: SlipSpeechCost): string => {
  const lines: string[] = [];
  if (cost.transcription) {
    lines.push(
      `Transcription ${cost.transcription.model} ${formatUsd(cost.transcription.cost)}`
    );
  }
  if (cost.cleanup) {
    lines.push(`Cleanup ${cost.cleanup.model} ${formatUsd(cost.cleanup.cost)}`);
  }
  return lines.join("\n");
};
