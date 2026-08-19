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

export const imageTitle = (name: string): string =>
  name.replace(EXT, "").trim() || "Untitled";

export const slipImgSrc = (filePath: string): string =>
  `slip-img://img${filePath}`;

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
