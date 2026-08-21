export interface HtmlImage {
  height: number | null;
  src: string;
  width: number | null;
}

export interface EmbedImage {
  bytes: Uint8Array;
  mime: string;
}

const IMG_TAG = /<img\b[^>]*>/giu;
const TINY = 32;
const DATA_IMAGE =
  /^data:(?<mime>image\/[a-z0-9.+-]+)(?:;charset=[^;]+)?;base64,(?<data>[\s\S]+)$/iu;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const decodeEntities = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const attr = (tag: string, name: string): string => {
  const quoted = new RegExp(
    `\\b${name}\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s>]+))`,
    "iu"
  );
  const match = quoted.exec(tag);
  const value =
    match?.groups?.double ?? match?.groups?.single ?? match?.groups?.bare;
  if (value === undefined) {
    return "";
  }
  return decodeEntities(value);
};

const asDim = (raw: string): number | null => {
  if (!raw) {
    return null;
  }
  const n = Number(raw.replace(/px$/iu, "").trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const textToHtml = (text: string): string =>
  text
    .split(/\n{2,}/u)
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br>")}</p>`)
    .join("");

export const bundleHtml = (text: string, images: EmbedImage[]): string => {
  const body = `${text.trim() ? textToHtml(text) : ""}${images
    .map((image) => {
      const data = Buffer.from(image.bytes).toString("base64");
      return `<img src="data:${image.mime};base64,${data}">`;
    })
    .join("")}`;
  return `<html><body><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
};

export const htmlImages = (html: string): HtmlImage[] => {
  const images: HtmlImage[] = [];
  for (const match of html.matchAll(IMG_TAG)) {
    const [tag] = match;
    const src = attr(tag, "src");
    if (!src) {
      continue;
    }
    images.push({
      height: asDim(attr(tag, "height")),
      src,
      width: asDim(attr(tag, "width")),
    });
  }
  return images;
};

export const isTinyHtmlImage = (image: HtmlImage): boolean => {
  if (image.width === null || image.height === null) {
    return false;
  }
  return image.width < TINY && image.height < TINY;
};

export const parseDataImage = (
  src: string
): { bytes: Buffer; mime: string } | null => {
  const match = DATA_IMAGE.exec(src.trim());
  const mime = match?.groups?.mime;
  const data = match?.groups?.data;
  if (mime === undefined || mime.length === 0 || data === undefined) {
    return null;
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength === 0) {
    return null;
  }
  return { bytes, mime: mime.toLowerCase() };
};
