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
  mode: "attach" | "out" | "slip";
  target: DrawTarget | null;
}

export const FLATTEN_MAX = 8192;

/** Longest side of a blank drawing export. */
export const BLANK_MAX = 4096;

/** Page-space padding around a blank drawing export. */
export const EXPORT_MARGIN = 24;

/** Annotate-anywhere pen. Dark-mode ink is too light on a screenshot. */
export const ANNOTATE_INK = "red";

/** Width the annotate toolbar needs, including the window chrome. */
export const ANNOTATE_TOOLBAR_W = 821;

export const annotateRetake = (hasStrokes: boolean): "keep" | "replace" =>
  hasStrokes ? "keep" : "replace";

export const annotateWindowSize = (area: {
  height: number;
  width: number;
}): { height: number; width: number } => ({
  height: Math.min(680, Math.max(420, area.height - 80)),
  width: Math.min(ANNOTATE_TOOLBAR_W, Math.max(0, area.width)),
});

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

/**
 * Camera that contain-fits a fixed page-space frame.
 * Quickdraw's camera is `screen = (page + camera) * zoom`.
 */
export const cameraForFrame = (
  viewport: Size,
  frame: Rect
): { x: number; y: number; z: number } => {
  const placed = fitFrame(viewport, frame);
  if (!(placed.zoom > 0)) {
    return { x: 0, y: 0, z: 1 };
  }
  return {
    x: placed.pan[0] / placed.zoom,
    y: placed.pan[1] / placed.zoom,
    z: placed.zoom,
  };
};

/**
 * Pixel density for a blank export. At most 2× page space, and neither side
 * of the padded bitmap may pass `max`.
 */
export const blankExportScale = (
  content: Size,
  margin = EXPORT_MARGIN,
  max = BLANK_MAX
): number => {
  const height = content.h + margin * 2;
  const width = content.w + margin * 2;
  if (!(width > 0 && height > 0 && max > 0)) {
    return 1;
  }
  return Math.min(2, max / width, max / height);
};

/**
 * Where a Quickdraw PNG export lands on the native bitmap.
 * `exported` is the page rect the PNG covers. `frame` is the image in that
 * same page space. The screen scale (`dpr`) does not change the file.
 */
export const inkPlacement = (
  frame: Rect,
  exported: Rect,
  native: Size,
  dpr = 1
): Rect => {
  const bitmap = flattenBitmap(native, dpr);
  const sx = frame.w === 0 ? 0 : bitmap.w / frame.w;
  const sy = frame.h === 0 ? 0 : bitmap.h / frame.h;
  return {
    h: exported.h * sy,
    w: exported.w * sx,
    x: (exported.x - frame.x) * sx,
    y: (exported.y - frame.y) * sy,
  };
};

/** Draw the original image, then a transparent ink export, at native size. */
export const paintFlatten = (
  draw: (
    slot: "ink" | "plate",
    x: number,
    y: number,
    w: number,
    h: number
  ) => void,
  frame: Rect,
  exported: Rect,
  native: Size,
  dpr = 1
): Size => {
  const bitmap = flattenBitmap(native, dpr);
  draw("plate", 0, 0, bitmap.w, bitmap.h);
  const dest = inkPlacement(frame, exported, native, dpr);
  draw("ink", dest.x, dest.y, dest.w, dest.h);
  return bitmap;
};
