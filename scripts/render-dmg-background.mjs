// Paper desk for the DMG window. Matches scripts/make-dmg-background.swift
// (wordmark, arrow, rule) so Linux can regenerate the PNG and TIFF.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const width1x = 660;
const height1x = 400;
const outDir = process.argv[2] ?? "build";
const shortValue = (n) => n * 65_536;

GlobalFonts.registerFromPath(
  "/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf",
  "Noto Serif"
);

const render = (scale) => {
  const w = width1x * scale;
  const h = height1x * scale;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(239, 232, 220)";
  ctx.fillRect(0, 0, w, h);

  const wash = ctx.createRadialGradient(
    w * 0.5,
    188 * scale,
    0,
    w * 0.5,
    200 * scale,
    340 * scale
  );
  wash.addColorStop(0, "rgba(254, 250, 242, 0.7)");
  wash.addColorStop(1, "rgba(239, 232, 220, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255, 252, 247, 0.22)";
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.moveTo(0, 70 * scale);
  ctx.lineTo(w, 360 * scale);
  ctx.stroke();
  ctx.strokeStyle = "rgba(140, 115, 71, 0.06)";
  ctx.beginPath();
  ctx.moveTo(0, 72 * scale);
  ctx.lineTo(w, 362 * scale);
  ctx.stroke();

  for (const rest of [168, 492]) {
    const glow = ctx.createRadialGradient(
      rest * scale,
      206 * scale,
      0,
      rest * scale,
      206 * scale,
      54 * scale
    );
    glow.addColorStop(0, "rgba(209, 194, 168, 0.18)");
    glow.addColorStop(1, "rgba(209, 194, 168, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(rest * scale, 206 * scale, 54 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(196, 132, 58, 0.42)";
  ctx.lineCap = "round";
  ctx.lineWidth = 0.9 * scale;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 28 * scale, 58 * scale);
  ctx.lineTo(w / 2 + 28 * scale, 58 * scale);
  ctx.stroke();

  ctx.fillStyle = "rgba(28, 27, 25, 0.28)";
  ctx.font = `${13 * scale}px "Noto Serif"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const letters = ["J", "O", "T"];
  const spacing = 7.2 * scale;
  const widths = letters.map((ch) => ctx.measureText(ch).width);
  const total =
    widths.reduce((sum, width) => sum + width, 0) +
    spacing * (letters.length - 1);
  let cursor = (w - total) / 2;
  for (const [index, ch] of letters.entries()) {
    ctx.fillText(ch, cursor, 28 * scale);
    cursor += widths[index] + spacing;
  }

  const amber = "rgba(196, 132, 58, 0.92)";
  ctx.strokeStyle = amber;
  ctx.fillStyle = amber;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.2 * scale;
  ctx.beginPath();
  ctx.moveTo(268 * scale, 186 * scale);
  ctx.quadraticCurveTo(323 * scale, 194 * scale, 378 * scale, 186 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(372 * scale, 174 * scale);
  ctx.quadraticCurveTo(386 * scale, 186 * scale, 372 * scale, 198 * scale);
  ctx.lineTo(392 * scale, 186 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(268 * scale, 186 * scale, 2.1 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(196, 132, 58, 0.55)";
  ctx.lineWidth = 3.4 * scale;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 7 * scale, 348 * scale);
  ctx.lineTo(w / 2 + 7 * scale, 348 * scale);
  ctx.stroke();

  const image = ctx.getImageData(0, 0, w, h);
  return {
    h,
    png: canvas.toBuffer("image/png"),
    rgba: Buffer.from(image.data),
    w,
  };
};

const be16 = (n) => {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(n);
  return buf;
};
const be32 = (n) => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
};

const ifdEntry = (tag, type, count, value) =>
  Buffer.concat([be16(tag), be16(type), be32(count), be32(value)]);

const ENTRY_COUNT = 16;

/**
 * @param {Array<{ dpi: number, h: number, name: string, png: Buffer, rgba: Buffer, w: number }>} pages TIFF pages to pack.
 */
const encodeTiff = (pages) => {
  const parts = [Buffer.alloc(8)];
  const place = (buf) => {
    const offset = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(buf);
    return offset;
  };
  const pagesMeta = pages.map((page) => {
    const bytes = deflateSync(page.rgba);
    return {
      ...page,
      bits: place(Buffer.from([0, 8, 0, 8, 0, 8, 0, 8])),
      bytes,
      desc: place(Buffer.from(`${page.name}\0`)),
      strip: place(bytes),
      xres: place(Buffer.concat([be32(page.dpi), be32(1)])),
      yres: place(Buffer.concat([be32(page.dpi), be32(1)])),
    };
  });
  const ifdOffsets = [];
  for (const page of pagesMeta) {
    const entries = [
      ifdEntry(256, 3, 1, shortValue(page.w)),
      ifdEntry(257, 3, 1, shortValue(page.h)),
      ifdEntry(258, 3, 4, page.bits),
      ifdEntry(259, 3, 1, shortValue(8)),
      ifdEntry(262, 3, 1, shortValue(2)),
      ifdEntry(270, 2, page.name.length + 1, page.desc),
      ifdEntry(273, 4, 1, page.strip),
      ifdEntry(274, 3, 1, shortValue(1)),
      ifdEntry(277, 3, 1, shortValue(4)),
      ifdEntry(278, 4, 1, page.h),
      ifdEntry(279, 4, 1, page.bytes.length),
      ifdEntry(282, 5, 1, page.xres),
      ifdEntry(283, 5, 1, page.yres),
      ifdEntry(284, 3, 1, shortValue(1)),
      ifdEntry(296, 3, 1, shortValue(2)),
      ifdEntry(338, 3, 1, shortValue(2)),
    ];
    if (entries.length !== ENTRY_COUNT) {
      throw new Error(`tiff ifd has ${entries.length} entries`);
    }
    ifdOffsets.push(parts.reduce((sum, part) => sum + part.length, 0));
    parts.push(Buffer.concat([be16(entries.length), ...entries, be32(0)]));
  }
  const file = Buffer.concat(parts);
  file.write("MM", 0, "ascii");
  file.writeUInt16BE(42, 2);
  file.writeUInt32BE(ifdOffsets[0], 4);
  for (let i = 0; i < ifdOffsets.length - 1; i += 1) {
    const nextAt = ifdOffsets[i] + 2 + ENTRY_COUNT * 12;
    file.writeUInt32BE(ifdOffsets[i + 1], nextAt);
  }
  return file;
};

const one = render(1);
const two = render(2);
writeFileSync(path.join(outDir, "background.png"), one.png);
writeFileSync(path.join(outDir, "background@2x.png"), two.png);
writeFileSync(
  path.join(outDir, "background.tiff"),
  encodeTiff([
    { ...one, dpi: 72, name: "background.png" },
    { ...two, dpi: 144, name: "background@2x.png" },
  ])
);
console.log(`wrote ${outDir}/background.png`);
console.log(`wrote ${outDir}/background@2x.png`);
console.log(`wrote ${outDir}/background.tiff`);
