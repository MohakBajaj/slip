export interface Size {
  h: number;
  w: number;
}

export interface Rect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface DrawTarget {
  imagePath: string;
  slipId: string;
}

export interface DrawSession {
  mode: "attach" | "slip";
  target: DrawTarget | null;
}

export const FLATTEN_MAX = 8192;

const emptyRect = (): Rect => ({ h: 0, w: 0, x: 0, y: 0 });

/** Fit `image` inside `viewport`, centered, keeping aspect ratio. */
export const fitContain = (viewport: Size, image: Size): Rect => {
  if (!(viewport.w > 0 && viewport.h > 0 && image.w > 0 && image.h > 0)) {
    return emptyRect();
  }
  const scale = Math.min(viewport.w / image.w, viewport.h / image.h);
  const w = image.w * scale;
  const h = image.h * scale;
  return {
    h,
    w,
    x: (viewport.w - w) / 2,
    y: (viewport.h - h) / 2,
  };
};

/**
 * Pan and zoom that place a fixed world-space `frame` inside `viewport`
 * with contain fitting. The frame itself does not change, so strokes stored
 * in that space stay glued to the image across resizes.
 */
export const fitFrame = (
  viewport: Size,
  frame: Rect
): { pan: [number, number]; zoom: number } => {
  const next = fitContain(viewport, { h: frame.h, w: frame.w });
  if (!(frame.w > 0 && frame.h > 0 && next.w > 0)) {
    return { pan: [0, 0], zoom: 1 };
  }
  const zoom = next.w / frame.w;
  return {
    pan: [next.x - frame.x * zoom, next.y - frame.y * zoom],
    zoom,
  };
};

/** Scale from a display rectangle to a native bitmap. */
export const nativeScale = (
  display: Rect,
  native: Size
): { x: number; y: number } => ({
  x: display.w === 0 ? 0 : native.w / display.w,
  y: display.h === 0 ? 0 : native.h / display.h,
});

/**
 * Map a point onto native image pixels.
 * `display` is the image rectangle in CSS pixels.
 * `point` is in that same CSS space when `dpr` is 1.
 * A retina point in device pixels is converted with `dpr` first
 * (`device / dpr` → CSS → native). The image file is not scaled by `dpr`.
 */
export const displayToNative = (
  point: { x: number; y: number },
  display: Rect,
  native: Size,
  dpr = 1
): { x: number; y: number } => {
  const screen = dpr > 0 ? dpr : 1;
  const scale = nativeScale(display, native);
  return {
    x: (point.x / screen - display.x) * scale.x,
    y: (point.y / screen - display.y) * scale.y,
  };
};

/**
 * Pixel size of a flattened annotation. This is the image's own pixels,
 * capped so a huge photo cannot allocate an unbounded canvas.
 * `dpr` is the screen scale; it does not change the file.
 */
export const flattenBitmap = (
  native: Size,
  dpr = 1,
  max = FLATTEN_MAX
): Size => {
  if (!(native.w > 0 && native.h > 0 && dpr > 0 && max > 0)) {
    return { h: 0, w: 0 };
  }
  const scale = Math.min(1, max / native.w, max / native.h);
  return {
    h: Math.max(1, Math.round(native.h * scale)),
    w: Math.max(1, Math.round(native.w * scale)),
  };
};

/** Append annotation files. Earlier paths, including the original, stay. */
export const appendAnnotatedImage = (
  images: readonly string[],
  added: readonly string[]
): string[] => [...images, ...added.filter((item) => item.length > 0)];
