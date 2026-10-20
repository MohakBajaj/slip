import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { drawShape, pageBounds, Store, themeOf } from "@quickdrawjs/core";

import {
  ANNOTATE_INK,
  ANNOTATE_TOOLBAR_W,
  annotateRetake,
  annotateWindowSize,
  appendAnnotatedImage,
  blankExportScale,
  cameraForFrame,
  displayToNative,
  EXPORT_MARGIN,
  fitContain,
  fitFrame,
  flattenBitmap,
  inkPlacement,
  paintFlatten,
} from "./annotate";
import type { Rect, Size } from "./annotate";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

const crc32 = (data: Uint8Array): number => {
  let c = 0xff_ff_ff_ff;
  for (const byte of data) {
    const mixed = CRC_TABLE[(c ^ byte) & 0xff] ?? 0;
    c = mixed ^ (c >>> 8);
  }
  return (c ^ 0xff_ff_ff_ff) >>> 0;
};

const adler32 = (data: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const zlibStore = (data: Uint8Array): Uint8Array => {
  const parts: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  let offset = 0;
  do {
    const take = Math.min(65_535, data.length - offset);
    const last = offset + take >= data.length;
    const block = new Uint8Array(5 + take);
    block[0] = last ? 1 : 0;
    block[1] = take & 0xff;
    block[2] = (take >>> 8) & 0xff;
    const nlen = take ^ 0xff_ff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >>> 8) & 0xff;
    block.set(data.subarray(offset, offset + take), 5);
    parts.push(block);
    offset += take;
  } while (offset < data.length);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler32(data));
  parts.push(tail);
  return concat(parts);
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const encodePng = (w: number, h: number, rgba: Uint8Array): Uint8Array => {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), row + 1);
  }
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStore(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
};

const decodeStoredPng = (
  png: Uint8Array
): { h: number; rgba: Uint8Array; w: number } => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let w = 0;
  let h = 0;
  const idats: Uint8Array[] = [];
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      w = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
        0
      );
      h = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
        4
      );
    }
    if (type === "IDAT") {
      idats.push(data);
    }
    offset += 12 + length;
  }
  const idat = concat(idats);
  const blocks = idat.subarray(2, idat.length - 4);
  const rawParts: Uint8Array[] = [];
  let at = 0;
  while (at < blocks.length) {
    const take = blocks[at + 1]! | (blocks[at + 2]! << 8);
    rawParts.push(blocks.subarray(at + 5, at + 5 + take));
    at += 5 + take;
  }
  const raw = concat(rawParts);
  const rgba = new Uint8Array(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y += 1) {
    rgba.set(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride
    );
  }
  return { h, rgba, w };
};

const pixel = (
  rgba: Uint8Array,
  w: number,
  x: number,
  y: number
): [number, number, number, number] => {
  const i = (y * w + x) * 4;
  return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0, rgba[i + 3] ?? 0];
};

const paint = (
  rgba: Uint8Array,
  size: Size,
  x: number,
  y: number,
  color: [number, number, number, number]
): void => {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= size.w || iy >= size.h) {
    return;
  }
  const i = (iy * size.w + ix) * 4;
  rgba[i] = color[0];
  rgba[i + 1] = color[1];
  rgba[i + 2] = color[2];
  rgba[i + 3] = color[3];
};

const disk = (
  rgba: Uint8Array,
  size: Size,
  x: number,
  y: number,
  radius: number,
  color: [number, number, number, number]
): void => {
  const r = Math.ceil(radius);
  for (let yy = -r; yy <= r; yy += 1) {
    for (let xx = -r; xx <= r; xx += 1) {
      if (xx * xx + yy * yy <= radius * radius) {
        paint(rgba, size, x + xx, y + yy, color);
      }
    }
  }
};

test("fitContain letterboxes and keeps aspect ratio", () => {
  expect(fitContain({ h: 100, w: 100 }, { h: 50, w: 200 })).toEqual({
    h: 25,
    w: 100,
    x: 0,
    y: 37.5,
  });
  expect(fitContain({ h: 80, w: 40 }, { h: 20, w: 10 })).toEqual({
    h: 80,
    w: 40,
    x: 0,
    y: 0,
  });
  expect(fitContain({ h: 0, w: 10 }, { h: 10, w: 10 })).toEqual({
    h: 0,
    w: 0,
    x: 0,
    y: 0,
  });
});

test("cameraForFrame matches the contain fit in Quickdraw camera space", () => {
  const frame: Rect = { h: 50, w: 100, x: 10, y: 0 };
  const cam = cameraForFrame({ h: 100, w: 200 }, frame);
  expect(cam).toEqual({ x: -10, y: 0, z: 2 });
  expect((frame.x + cam.x) * cam.z).toBe(0);
  expect((frame.y + cam.y) * cam.z).toBe(0);
});

test("blank drawings stay within the 4096 side cap and retina does not grow them", () => {
  expect(blankExportScale({ h: 10, w: 10 })).toBe(2);
  const huge = { h: 10_000, w: 10_000 };
  const scale = blankExportScale(huge);
  const side = (huge.w + EXPORT_MARGIN * 2) * scale;
  expect(side).toBeLessThanOrEqual(4096 + 1e-6);
  expect(side).toBeGreaterThan(4096 - 1);
});

test("ink placement is native pixels and ignores device pixel ratio", () => {
  const frame: Rect = { h: 60, w: 80, x: 10, y: 5 };
  const exported: Rect = { h: 10, w: 20, x: 30, y: 25 };
  const native: Size = { h: 120, w: 160 };
  const placed = { h: 20, w: 40, x: 40, y: 40 };
  expect(inkPlacement(frame, exported, native)).toEqual(placed);
  expect(inkPlacement(frame, exported, native, 2)).toEqual(placed);
  const capped = inkPlacement(
    { h: 50, w: 100, x: 0, y: 0 },
    { h: 50, w: 100, x: 0, y: 0 },
    { h: 5000, w: 10_000 },
    3
  );
  expect(capped).toEqual({ h: 4096, w: 8192, x: 0, y: 0 });
});

test("fitFrame refits a frozen frame without moving its world origin", () => {
  const frame: Rect = { h: 50, w: 100, x: 10, y: 0 };
  const placed = fitFrame({ h: 100, w: 200 }, frame);
  expect(placed.zoom).toBe(2);
  expect(placed.pan).toEqual([-20, 0]);
  const screenX = placed.pan[0] + frame.x * placed.zoom;
  const screenY = placed.pan[1] + frame.y * placed.zoom;
  expect(screenX).toBe(0);
  expect(screenY).toBe(0);
});

test("display points map to native pixels, including retina device pixels", () => {
  const native: Size = { h: 1000, w: 2000 };
  const display = fitContain({ h: 600, w: 800 }, native);
  expect(display).toEqual({ h: 400, w: 800, x: 0, y: 100 });

  const css = { x: 100, y: 200 };
  expect(displayToNative(css, display, native)).toEqual({ x: 250, y: 250 });
  expect(displayToNative({ x: 0, y: 100 }, display, native)).toEqual({
    x: 0,
    y: 0,
  });
  expect(displayToNative({ x: 800, y: 500 }, display, native)).toEqual({
    x: 2000,
    y: 1000,
  });

  const dpr = 2;
  const device = { x: css.x * dpr, y: css.y * dpr };
  expect(displayToNative(device, display, native, dpr)).toEqual(
    displayToNative(css, display, native, 1)
  );
  expect(flattenBitmap(native, dpr)).toEqual(native);
  expect(flattenBitmap({ h: 5000, w: 10_000 }, 2)).toEqual({
    h: 4096,
    w: 8192,
  });
});

test("appendAnnotatedImage keeps the original path and appends the new file", () => {
  const images = ["/vault/attachments/abc/original.png"];
  const next = appendAnnotatedImage(images, [
    "",
    "/vault/attachments/abc/annotated.png",
  ]);
  expect(images).toEqual(["/vault/attachments/abc/original.png"]);
  expect(next).toEqual([
    "/vault/attachments/abc/original.png",
    "/vault/attachments/abc/annotated.png",
  ]);
});

test("flatten paints a display-space stroke onto native pixels", () => {
  const native: Size = { h: 120, w: 160 };
  const display: Rect = { h: 60, w: 80, x: 20, y: 10 };
  const bitmap = flattenBitmap(native, 2);
  expect(bitmap).toEqual(native);

  const rgba = new Uint8Array(bitmap.w * bitmap.h * 4);
  const sky: [number, number, number, number] = [90, 150, 210, 255];
  const ground: [number, number, number, number] = [70, 140, 80, 255];
  for (let y = 0; y < bitmap.h; y += 1) {
    for (let x = 0; x < bitmap.w; x += 1) {
      paint(rgba, bitmap, x, y, y < bitmap.h / 2 ? sky : ground);
    }
  }
  const before = rgba.slice();

  const red: [number, number, number, number] = [220, 38, 38, 255];
  const steps = 48;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const css = { x: 30 + (90 - 30) * t, y: 20 + (60 - 20) * t };
    const at = displayToNative(css, display, bitmap, 1);
    const device = displayToNative(
      { x: css.x * 2, y: css.y * 2 },
      display,
      bitmap,
      2
    );
    expect(device.x).toBeCloseTo(at.x);
    expect(device.y).toBeCloseTo(at.y);
    disk(rgba, bitmap, at.x, at.y, 2.2, red);
  }

  const start = displayToNative({ x: 30, y: 20 }, display, bitmap);
  expect(start).toEqual({ x: 20, y: 20 });
  expect(pixel(rgba, bitmap.w, 4, 4)).toEqual(sky);
  expect(pixel(rgba, bitmap.w, 20, 20)).toEqual(red);
  expect(pixel(before, bitmap.w, 20, 20)).toEqual(sky);

  const png = encodePng(bitmap.w, bitmap.h, rgba);
  const decoded = decodeStoredPng(png);
  expect(decoded.w).toBe(bitmap.w);
  expect(decoded.h).toBe(bitmap.h);
  expect(pixel(decoded.rgba, decoded.w, 4, 4)).toEqual(sky);
  expect(pixel(decoded.rgba, decoded.w, 20, 20)).toEqual(red);
  expect(pixel(decoded.rgba, decoded.w, 150, 100)).toEqual(ground);

  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync("/opt/cursor/artifacts/annotate-flatten.png", png);
  } catch {
    // The pixel asserts above are the check. The file is only for the PR.
  }
});

test("a Quickdraw snapshot export flattens onto native image pixels", async () => {
  const native: Size = { h: 120, w: 160 };
  const frame: Rect = { h: 60, w: 80, x: 0, y: 0 };
  const shape = {
    id: "stroke",
    props: {
      color: "red",
      dash: "solid",
      done: true,
      pts: [0, 0, 0.5, 24, 0, 0.5],
      size: "l",
    },
    rot: 0,
    type: "draw",
    typeName: "shape",
    x: 30,
    y: 40,
    z: 1,
  };
  const store = new Store();
  store.put(shape);
  const snap = store.getSnapshot();
  const fresh = new Store();
  fresh.loadSnapshot(snap, "remote");
  const loaded = fresh.get(shape.id);
  if (!loaded || loaded.typeName !== "shape") {
    throw new Error("snapshot dropped the stroke");
  }
  const exported = pageBounds(loaded);
  const scale = native.w / frame.w;
  const inkCanvas = createCanvas(
    Math.max(1, Math.round(exported.w * scale)),
    Math.max(1, Math.round(exported.h * scale))
  );
  const inkCtx = inkCanvas.getContext("2d");
  inkCtx.setTransform(
    scale,
    0,
    0,
    scale,
    -exported.x * scale,
    -exported.y * scale
  );
  drawShape(inkCtx, loaded, {
    store: fresh,
    theme: themeOf("light"),
    zoom: scale,
  });

  const plate = createCanvas(native.w, native.h);
  const plateCtx = plate.getContext("2d");
  const sky: [number, number, number, number] = [90, 150, 210, 255];
  const ground: [number, number, number, number] = [70, 140, 80, 255];
  for (let y = 0; y < native.h; y += 1) {
    plateCtx.fillStyle =
      y < native.h / 2 ? "rgb(90, 150, 210)" : "rgb(70, 140, 80)";
    plateCtx.fillRect(0, y, native.w, 1);
  }

  const flat = createCanvas(native.w, native.h);
  const flatCtx = flat.getContext("2d");
  const bitmap = paintFlatten(
    (slot, x, y, w, h) => {
      flatCtx.drawImage(slot === "plate" ? plate : inkCanvas, x, y, w, h);
    },
    frame,
    exported,
    native,
    2
  );
  expect(bitmap).toEqual(native);
  expect(paintFlatten(() => undefined, frame, exported, native, 1)).toEqual(
    bitmap
  );

  const png = flat.toBuffer("image/png");
  const image = await loadImage(png);
  const encoded = createCanvas(image.width, image.height);
  const encodedCtx = encoded.getContext("2d");
  encodedCtx.drawImage(image, 0, 0);
  const at = (
    ctx: ReturnType<typeof encoded.getContext>,
    x: number,
    y: number
  ): [number, number, number, number] => {
    const data = ctx.getImageData(x, y, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
  };
  expect(image.width).toBe(native.w);
  expect(image.height).toBe(native.h);
  expect(at(encodedCtx, 2, 2)).toEqual(sky);
  expect(at(encodedCtx, 150, 110)).toEqual(ground);
  const mark = at(encodedCtx, 84, 80);
  expect(mark[0]).toBeGreaterThan(180);
  expect(mark[1]).toBeLessThan(90);
  expect(mark[2]).toBeLessThan(90);
  expect(mark[3]).toBe(255);
  expect(at(plateCtx, 84, 80)).toEqual(ground);
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync("/opt/cursor/artifacts/quickdraw-flatten.png", png);
  } catch {
    // Pixel asserts above are the check.
  }
});

test("a second annotate keeps a sketch and replaces a blank one", () => {
  expect(annotateRetake(false)).toBe("replace");
  expect(annotateRetake(true)).toBe("keep");
});

test("annotate window fits the toolbar and stays on the screen", () => {
  expect(ANNOTATE_INK).toBe("red");
  expect(annotateWindowSize({ height: 900, width: 1400 })).toEqual({
    height: 680,
    width: ANNOTATE_TOOLBAR_W,
  });
  expect(annotateWindowSize({ height: 500, width: 700 }).width).toBe(700);
});
