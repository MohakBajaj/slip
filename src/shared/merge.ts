import { sourcePrompt } from "./source";
import type { Slip } from "./types";

const CAPTION = /^(?:drawing|untitled|voice note)$/iu;

export const isMergeCaption = (content: string): boolean => {
  const text = content.trim();
  if (text.length === 0) {
    return true;
  }
  return CAPTION.test(text) && !text.includes("\n");
};

export interface MergeDraft {
  audio: string[];
  content: string;
  images: string[];
  page: string;
  pin: boolean;
  source: string;
  tags: string[];
  url: string;
}

const byCreated = (left: Slip, right: Slip): number =>
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

const sharedContext = (slips: Slip[]): boolean => {
  const [head] = slips;
  if (head === undefined) {
    return true;
  }
  return slips.every(
    (slip) =>
      slip.page === head.page &&
      slip.source === head.source &&
      slip.url === head.url
  );
};

const blockOf = (slip: Slip, shared: boolean): string => {
  const text = isMergeCaption(slip.content) ? "" : slip.content.trim();
  const from = shared ? "" : sourcePrompt(slip);
  if (text.length > 0 && from.length > 0) {
    return `${from}\n\n${text}`;
  }
  return text || from;
};

const joinBlocks = (blocks: string[]): string => {
  if (blocks.some((block) => block.includes("\n"))) {
    return blocks.join("\n\n---\n\n");
  }
  return blocks.join("\n\n");
};

export const mergeDraft = (items: Slip[]): MergeDraft => {
  const slips = [...items].toSorted(byCreated);
  const shared = sharedContext(slips);
  const [head] = slips;
  const blocks = slips.map((slip) => blockOf(slip, shared)).filter(Boolean);
  let content = joinBlocks(blocks);
  if (content.length === 0) {
    content = slips.find((slip) => slip.content.trim())?.content.trim() ?? "";
  }
  return {
    audio: slips.flatMap((slip) => slip.audio).filter(Boolean),
    content,
    images: slips.flatMap((slip) => slip.images).filter(Boolean),
    page: shared ? (head?.page ?? "") : "",
    pin: slips.some((slip) => slip.pin),
    source: shared ? (head?.source ?? "") : "",
    tags: [...new Set(slips.flatMap((slip) => slip.tags).filter(Boolean))],
    url: shared ? (head?.url ?? "") : "",
  };
};
