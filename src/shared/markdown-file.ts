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

const asTime = (value: unknown, fallback: string): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return asString(value, fallback);
};

const asFlag = (value: unknown): boolean => value === true;

const asStringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((item) => typeof item === "string")) {
    return null;
  }
  return value;
};

const SLIP_FILE = /^(?<date>\d{4}-\d{2}-\d{2})-(?<id>[0-9a-z]{6})\.md$/u;

const asPaths = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item, "")).filter(Boolean);
  }
  const one = asString(value, "");
  return one ? [one] : [];
};

const leadingNewlines = /^\n+/u;
const trailingNewline = /\n$/u;

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
  const id = SLIP_FILE.exec(filename)?.groups?.id;
  if (id === undefined) {
    return null;
  }
  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const created = asTime(data.created, new Date().toISOString());
    const cost = asSpeechCost(data.cost);
    return {
      archived: asFlag(data.archived),
      audio: asPaths(data.audio),
      content: asString(parsed.content, "")
        .replace(leadingNewlines, "")
        .replace(trailingNewline, ""),
      ...(cost ? { cost } : {}),
      createdAt: created,
      done: asFlag(data.done),
      filename,
      id,
      images: Array.isArray(data.images)
        ? data.images.map((item) => asString(item, ""))
        : [],
      page: asString(data.page, ""),
      pin: asFlag(data.pin),
      section: asString(data.section, ""),
      source: asString(data.source, ""),
      tags: Array.isArray(data.tags)
        ? data.tags.map((item) => asString(item, ""))
        : [],
      transcript: asString(data.transcript, ""),
      updatedAt: asTime(data.updated, created),
      url: asString(data.url, ""),
    };
  } catch {
    return null;
  }
};

const takeString = (
  record: Record<string, unknown>,
  key: string
): string | null => {
  if (!(key in record)) {
    return null;
  }
  return typeof record[key] === "string" ? record[key] : null;
};

const SLIP_STRINGS = [
  "content",
  "createdAt",
  "page",
  "section",
  "source",
  "transcript",
  "updatedAt",
  "url",
] as const;

type SlipStrings = Record<(typeof SLIP_STRINGS)[number], string>;

const slipStrings = (record: Record<string, unknown>): SlipStrings | null => {
  const content = takeString(record, "content");
  const createdAt = takeString(record, "createdAt");
  const page = takeString(record, "page");
  const section = takeString(record, "section");
  const source = takeString(record, "source");
  const transcript = takeString(record, "transcript");
  const updatedAt = takeString(record, "updatedAt");
  const url = takeString(record, "url");
  if (
    content === null ||
    createdAt === null ||
    page === null ||
    section === null ||
    source === null ||
    transcript === null ||
    updatedAt === null ||
    url === null
  ) {
    return null;
  }
  return {
    content,
    createdAt,
    page,
    section,
    source,
    transcript,
    updatedAt,
    url,
  };
};

export const slipPatch = (value: unknown): Partial<Slip> | null => {
  if (!isRecord(value) || Array.isArray(value)) {
    return null;
  }
  const patch: Partial<Slip> = {};
  for (const key of ["archived", "done", "pin"] as const) {
    if (!(key in value)) {
      continue;
    }
    if (typeof value[key] !== "boolean") {
      return null;
    }
    patch[key] = value[key];
  }
  for (const key of ["content", "section"] as const) {
    if (!(key in value)) {
      continue;
    }
    const text = takeString(value, key);
    if (text === null) {
      return null;
    }
    patch[key] = text;
  }
  for (const key of ["images", "tags"] as const) {
    if (!(key in value)) {
      continue;
    }
    const list = asStringList(value[key]);
    if (list === null) {
      return null;
    }
    patch[key] = list;
  }
  return patch;
};

export const slipRecord = (value: unknown): Slip | null => {
  if (!isRecord(value)) {
    return null;
  }
  const filename = takeString(value, "filename");
  const id = SLIP_FILE.exec(filename ?? "")?.groups?.id;
  if (filename === null || id === undefined || value.id !== id) {
    return null;
  }
  const flags = ["archived", "done", "pin"] as const;
  if (flags.some((key) => typeof value[key] !== "boolean")) {
    return null;
  }
  const audio = asStringList(value.audio);
  const images = asStringList(value.images);
  const tags = asStringList(value.tags);
  const text = slipStrings(value);
  if (audio === null || images === null || tags === null || text === null) {
    return null;
  }
  const cost = asSpeechCost(value.cost);
  if (value.cost !== undefined && cost === null) {
    return null;
  }
  return {
    archived: value.archived === true,
    audio,
    ...text,
    ...(cost ? { cost } : {}),
    done: value.done === true,
    filename,
    id,
    images,
    pin: value.pin === true,
    tags,
  };
};
