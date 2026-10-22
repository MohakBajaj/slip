// Rasterize the Jot SVG masters. Drop new artwork in first, then run:
//   node scripts/export-icon.mjs
//
// build/icon.svg is the full-size icon.
// Optional stand-ins for small sizes: build/icon-16.svg, build/icon-32.svg.
// Optional dock variant: build/icon-dark.svg (light falls back to icon.svg).
// build/tray-slip.svg is the menu-bar template (black on transparent).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = path.resolve(import.meta.dirname, "..");

const raster = async (file, size) => {
  const image = await loadImage(file);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  return canvas.toBuffer("image/png");
};

/**
 * @param {string[]} names Candidate master paths, first hit wins.
 */
const firstExisting = (names) => {
  for (const name of names) {
    const file = path.join(root, name);
    try {
      readFileSync(file);
      return file;
    } catch {
      // Try the next master.
    }
  }
  throw new Error(`missing icon master: ${names.join(", ")}`);
};

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 4, "ascii");
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
};

const main = async () => {
  const full = firstExisting(["build/icon.svg"]);
  const at16 = firstExisting(["build/icon-16.svg", "build/icon.svg"]);
  const at32 = firstExisting(["build/icon-32.svg", "build/icon.svg"]);
  const dark = firstExisting(["build/icon-dark.svg", "build/icon.svg"]);
  const tray = firstExisting(["build/tray-slip.svg"]);
  const png16 = await raster(at16, 16);
  const png32 = await raster(at32, 32);
  const png48 = await raster(full, 48);
  const png64 = await raster(full, 64);
  const png128 = await raster(full, 128);
  const png256 = await raster(full, 256);
  const png512 = await raster(full, 512);
  const png1024 = await raster(full, 1024);
  const ic11 = await raster(at16, 32);
  const chunks = Buffer.concat([
    chunk("icp4", png16),
    chunk("icp5", png32),
    chunk("icp6", png64),
    chunk("ic07", png128),
    chunk("ic08", png256),
    chunk("ic09", png512),
    chunk("ic10", png1024),
    chunk("ic11", ic11),
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

  const darkPng = await raster(dark, 1024);
  for (const file of [
    "resources/dock/light.png",
    "src/renderer/src/assets/dock-light.png",
  ]) {
    writeFileSync(path.join(root, file), png1024);
  }
  for (const file of [
    "resources/dock/dark.png",
    "src/renderer/src/assets/dock-dark.png",
  ]) {
    writeFileSync(path.join(root, file), darkPng);
  }
  writeFileSync(
    path.join(root, "resources/tray/slipTemplate.png"),
    await raster(tray, 16)
  );
  writeFileSync(
    path.join(root, "resources/tray/slipTemplate@2x.png"),
    await raster(tray, 32)
  );
  console.log("exported icon, dock, and tray images");
};

await main();
