import matter from "gray-matter";

import { slipSpeechCost } from "./speech-cost";
import type { SpeechStepCost } from "./speech-cost";
import type { Slip } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asStep = (value: unknown): SpeechStepCost | null => {
  if (
    !isRecord(value) ||
    typeof value.model !== "string" ||
    value.model.length === 0
  ) {
    return null;
  }
  const cost = typeof value.cost === "number" ? value.cost : Number(value.cost);
  if (!Number.isFinite(cost)) {
    return null;
  }
  return { cost, model: value.model };
};

const asSpeechCost = (
  value: unknown
): ReturnType<typeof slipSpeechCost> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const transcription = asStep(value.transcription);
  const cleanup = asStep(value.cleanup);
  if (transcription === null && cleanup === null) {
    return null;
  }
  return slipSpeechCost({
    ...(cleanup === null ? {} : { cleanup }),
    ...(transcription === null ? {} : { transcription }),
  });
};

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const asPaths = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item, "")).filter(Boolean);
  }
  const one = asString(value, "");
  return one ? [one] : [];
};

const leadingNewlines = /^\n+/u;
const markdownExt = /\.md$/u;

export const serializeSlip = (slip: Slip): string =>
  matter.stringify(slip.content.replace(leadingNewlines, ""), {
    archived: slip.archived,
    ...(slip.audio.length > 0 ? { audio: slip.audio } : {}),
    ...(slip.cost ? { cost: slip.cost } : {}),
    created: slip.createdAt,
    done: slip.done,
    id: slip.id,
    images: slip.images,
    pin: slip.pin,
    section: slip.section,
    source: slip.source,
    ...(slip.url ? { url: slip.url } : {}),
    ...(slip.page ? { page: slip.page } : {}),
    tags: slip.tags,
    ...(slip.transcript ? { transcript: slip.transcript } : {}),
    updated: slip.updatedAt,
  });

export const parseSlip = (filename: string, raw: string): Slip | null => {
  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const id = asString(data.id, filename.replace(markdownExt, "").slice(-6));
    const created = asString(data.created, new Date().toISOString());
    const cost = asSpeechCost(data.cost);
    return {
      archived: Boolean(data.archived),
      audio: asPaths(data.audio),
      content: asString(parsed.content, "").replace(leadingNewlines, ""),
      ...(cost ? { cost } : {}),
      createdAt: created,
      done: Boolean(data.done),
      filename,
      id,
      images: Array.isArray(data.images)
        ? data.images.map((item) => asString(item, ""))
        : [],
      page: asString(data.page, ""),
      pin: Boolean(data.pin),
      section: asString(data.section, ""),
      source: asString(data.source, ""),
      tags: Array.isArray(data.tags)
        ? data.tags.map((item) => asString(item, ""))
        : [],
      transcript: asString(data.transcript, ""),
      updatedAt: asString(data.updated, created),
      url: asString(data.url, ""),
    };
  } catch {
    return null;
  }
};
