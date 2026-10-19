import { IMAGE_EXT, extOf } from "./images";

export interface ClipSnap {
  files: string[];
  html: string;
  imagePng: Buffer | null;
  text: string;
}

export interface PasteFlavor {
  data: Uint8Array;
  type: string;
}

export interface PasteItem {
  flavors: PasteFlavor[];
}

export interface PasteSnap {
  items: PasteItem[];
}

export interface PlannedCopy {
  clip: ClipSnap | null;
  restore: PasteSnap | null;
}

export interface PasteboardPoll {
  before: number;
  intervalMs: number;
  now: () => number;
  readCount: () => number;
  settleMs: number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
}

const PRIVATE_TYPES = new Set([
  "org.nspasteboard.ConcealedType",
  "org.nspasteboard.TransientType",
]);

const TEXT_TYPES = ["public.utf8-plain-text", "NSStringPboardType"];
const HTML_TYPES = ["public.html", "NSHTMLPboardType", "text/html"];
const PNG_TYPES = ["public.png"];
const FILE_TYPES = new Set(["public.file-url", "text/uri-list"]);

const decodeText = (data: Uint8Array | null): string => {
  if (data === null || data.byteLength === 0) {
    return "";
  }
  const end = data.indexOf(0);
  const bytes = end === -1 ? data : data.subarray(0, end);
  return new TextDecoder().decode(bytes);
};

const firstFlavor = (
  snap: PasteSnap,
  types: readonly string[]
): Uint8Array | null => {
  const want = new Set(types);
  for (const item of snap.items) {
    for (const flavor of item.flavors) {
      if (want.has(flavor.type) && flavor.data.byteLength > 0) {
        return flavor.data;
      }
    }
  }
  return null;
};

const pathFromFileUrl = (raw: string): string | null => {
  const line = raw.trim();
  if (!line.startsWith("file://")) {
    return null;
  }
  try {
    const url = new URL(line);
    if (url.protocol !== "file:") {
      return null;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//u.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return null;
  }
};

const filesFrom = (snap: PasteSnap): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of snap.items) {
    for (const flavor of item.flavors) {
      if (!FILE_TYPES.has(flavor.type)) {
        continue;
      }
      for (const part of decodeText(flavor.data).split(/\s+/u)) {
        const filePath = pathFromFileUrl(part);
        if (
          filePath === null ||
          seen.has(filePath) ||
          !IMAGE_EXT.has(extOf(filePath))
        ) {
          continue;
        }
        seen.add(filePath);
        out.push(filePath);
      }
    }
  }
  return out;
};

export const isPrivatePaste = (snap: PasteSnap): boolean =>
  snap.items.some((item) =>
    item.flavors.some((flavor) => PRIVATE_TYPES.has(flavor.type))
  );

export const clipFromPaste = (snap: PasteSnap): ClipSnap => {
  const png = firstFlavor(snap, PNG_TYPES);
  return {
    files: filesFrom(snap),
    html: decodeText(firstFlavor(snap, HTML_TYPES)),
    imagePng: png === null ? null : Buffer.from(png),
    text: decodeText(firstFlavor(snap, TEXT_TYPES)).trim(),
  };
};

const hasPayload = (clip: ClipSnap): boolean =>
  clip.text.length > 0 ||
  clip.imagePng !== null ||
  clip.files.length > 0 ||
  clip.html.length > 0;

/**
 * A synthetic copy is real when the pasteboard change count moves, even if
 * the bytes match what was already there. Private markers are restored with
 * the previous clipboard and kept out of history. A timeout leaves the
 * pasteboard untouched so a late copy is not overwritten.
 */
export const planCopy = (
  before: PasteSnap,
  after: PasteSnap,
  changed: boolean
): PlannedCopy => {
  if (!changed) {
    return { clip: null, restore: null };
  }
  if (isPrivatePaste(after)) {
    return { clip: null, restore: before };
  }
  const clip = clipFromPaste(after);
  if (!hasPayload(clip)) {
    return { clip: null, restore: before };
  }
  return { clip, restore: before };
};

export const pollPasteboardChange = async (
  opts: PasteboardPoll
): Promise<{ changed: boolean; changeCount: number }> => {
  const deadline = opts.now() + opts.timeoutMs;
  let seen = opts.before;
  let stableSince: number | null = null;
  while (opts.now() < deadline) {
    const count = opts.readCount();
    const t = opts.now();
    if (count !== opts.before) {
      if (stableSince === null || count !== seen) {
        seen = count;
        stableSince = t;
      }
      if (t - stableSince >= opts.settleMs) {
        return { changeCount: seen, changed: true };
      }
    }
    const remaining = deadline - opts.now();
    if (remaining <= 0) {
      break;
    }
    // Each sample has to follow the previous one; the count is a time series.
    // oxlint-disable-next-line no-await-in-loop
    await opts.sleep(Math.min(opts.intervalMs, remaining));
  }
  return { changeCount: seen, changed: seen !== opts.before };
};
