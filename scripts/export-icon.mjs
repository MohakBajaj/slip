// Rasterize the Jot SVG masters with resvg so blur filters survive.
//   node scripts/export-icon.mjs
//
// build/icon.svg is the 1024 master (squircle, shadows). Used at 64px and up,
// including 32@2x, which is a 64px image. At 64 it keeps more edge detail
// than the small master.
// build/icon-small.svg is the simplified mark for 16, 16@2x, and 32.
// build/tray-slip.svg is the 22px menu-bar template (black and alpha).
// The app loads slipTemplate.png at 16 and slipTemplate@2x.png at 32,
// same as the other tray glyphs. slipTemplate@22.png is the native size.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(import.meta.dirname, "..");

/**
 * @param {string} file SVG master path.
 * @param {number} size Output side in pixels.
 */
const raster = (file, size) => {
  const svg = readFileSync(file);
  const resvg = new Resvg(svg, {
    background: "rgba(0, 0, 0, 0)",
    fitTo: { mode: "width", value: size },
  });
  return Buffer.from(resvg.render().asPng());
};

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 4, "ascii");
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
};

const full = path.join(root, "build/icon.svg");
const small = path.join(root, "build/icon-small.svg");
const tray = path.join(root, "build/tray-slip.svg");
const png16 = raster(small, 16);
const png32 = raster(small, 32);
const png48 = raster(small, 48);
const png64 = raster(full, 64);
const png128 = raster(full, 128);
const png256 = raster(full, 256);
const png512 = raster(full, 512);
const png1024 = raster(full, 1024);
const chunks = Buffer.concat([
  chunk("icp4", png16),
  chunk("icp5", png32),
  chunk("icp6", png64),
  chunk("ic07", png128),
  chunk("ic08", png256),
  chunk("ic09", png512),
  chunk("ic10", png1024),
  chunk("ic11", png32),
  chunk("ic12", png64),
  chunk("ic13", png256),
  chunk("ic14", png512),
]);
const icnsHead = Buffer.alloc(8);
icnsHead.write("icns", 0, 4, "ascii");
icnsHead.writeUInt32BE(chunks.length + 8, 4);
writeFileSync(
  path.join(root, "build/icon.icns"),
  Buffer.concat([icnsHead, chunks])
);
writeFileSync(path.join(root, "build/icon.png"), png1024);

const icoImages = [
  { png: png16, size: 16 },
  { png: png32, size: 32 },
  { png: png48, size: 48 },
  { png: png64, size: 64 },
  { png: png128, size: 128 },
  { png: png256, size: 256 },
];
const headerLen = 6 + icoImages.length * 16;
const dir = Buffer.alloc(headerLen);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(icoImages.length, 4);
let offset = headerLen;
const parts = [dir];
for (const [index, image] of icoImages.entries()) {
  const at = 6 + index * 16;
  const side = image.size >= 256 ? 0 : image.size;
  dir.writeUInt8(side, at);
  dir.writeUInt8(side, at + 1);
  dir.writeUInt16LE(1, at + 4);
  dir.writeUInt16LE(32, at + 6);
  dir.writeUInt32LE(image.png.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += image.png.length;
  parts.push(image.png);
}
writeFileSync(path.join(root, "build/icon.ico"), Buffer.concat(parts));

for (const file of [
  "resources/dock/light.png",
  "resources/dock/dark.png",
  "src/renderer/src/assets/dock-light.png",
  "src/renderer/src/assets/dock-dark.png",
]) {
  writeFileSync(path.join(root, file), png1024);
}

writeFileSync(
  path.join(root, "resources/tray/slipTemplate.png"),
  raster(tray, 16)
);
writeFileSync(
  path.join(root, "resources/tray/slipTemplate@22.png"),
  raster(tray, 22)
);
writeFileSync(
  path.join(root, "resources/tray/slipTemplate@2x.png"),
  raster(tray, 32)
);
console.log("exported icon, dock, and tray images");
