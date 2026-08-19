export const IMAGE_EXT = new Set([
  ".bmp",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

const AUDIO_MIME: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const IMAGE_MIME: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};

const EXT = /\.[^.]+$/u;

export const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  if (i <= 0) {
    return "";
  }
  return name.slice(i).toLowerCase();
};

export const isImageName = (name: string): boolean =>
  IMAGE_EXT.has(extOf(name));

export const imageExt = (name: string): string => {
  const ext = extOf(name);
  return IMAGE_EXT.has(ext) ? ext : "";
};

export const audioExt = (name: string): string => {
  const ext = extOf(name);
  return AUDIO_MIME[ext] === undefined ? "" : ext;
};

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export const imageTitle = (name: string): string =>
  name.replace(EXT, "").trim() || "Untitled";

export const slipImgSrc = (filePath: string): string =>
  `slip-img://img${filePath}`;

export const attachmentType = (filePath: string): string =>
  AUDIO_MIME[extOf(filePath)] ??
  IMAGE_MIME[extOf(filePath)] ??
  "application/octet-stream";

export const extFromMime = (mime: string): string => {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "image/jpg") {
    return ".jpg";
  }
  for (const [ext, kind] of Object.entries(IMAGE_MIME)) {
    if (kind === type) {
      return ext;
    }
  }
  return "";
};

export const moveItem = <T>(items: T[], from: number, to: number): T[] => {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) {
    return items;
  }
  next.splice(to, 0, item);
  return next;
};

export interface ImagePayload {
  bytes?: Uint8Array;
  name: string;
  path?: string;
}

export interface PreviewState {
  index: number;
  slipId: string;
}
