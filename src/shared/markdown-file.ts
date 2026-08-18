import matter from "gray-matter";

import type { Slip } from "./types";

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const leadingNewlines = /^\n+/u;
const markdownExt = /\.md$/u;

export const serializeSlip = (slip: Slip): string =>
  matter.stringify(slip.content.replace(leadingNewlines, ""), {
    archived: slip.archived,
    created: slip.createdAt,
    done: slip.done,
    id: slip.id,
    images: slip.images,
    pin: slip.pin,
    section: slip.section,
    source: slip.source,
    tags: slip.tags,
    updated: slip.updatedAt,
  });

export const parseSlip = (filename: string, raw: string): Slip | null => {
  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const id = asString(data.id, filename.replace(markdownExt, "").slice(-6));
    const created = asString(data.created, new Date().toISOString());
    return {
      archived: Boolean(data.archived),
      content: asString(parsed.content, "").replace(leadingNewlines, ""),
      createdAt: created,
      done: Boolean(data.done),
      filename,
      id,
      images: Array.isArray(data.images)
        ? data.images.map((item) => asString(item, ""))
        : [],
      pin: Boolean(data.pin),
      section: asString(data.section, ""),
      source: asString(data.source, ""),
      tags: Array.isArray(data.tags)
        ? data.tags.map((item) => asString(item, ""))
        : [],
      updatedAt: asString(data.updated, created),
    };
  } catch {
    return null;
  }
};
