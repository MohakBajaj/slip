import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js"
import { assertConfig, offerModel, siteConfig } from "../src/render"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = join(root, "public")
const fontDir = join(root, "assets/fonts")
const sans = join(fontDir, "InstrumentSans-Variable.ttf")
const serif = join(fontDir, "InstrumentSerif-Regular.ttf")

const font: ResvgRenderOptions["font"] = {
  loadSystemFonts: false,
  fontFiles: [sans, serif],
  defaultFontFamily: "Instrument Sans",
  sansSerifFamily: "Instrument Sans",
  serifFamily: "Instrument Serif",
}

const xml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

const raster = (svg: string, width?: number): Buffer => {
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: "width", value: width } : undefined,
    font,
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
  })
  const rendered = resvg.render()
  return Buffer.from(rendered.asPng())
}

const rasterExact = (svg: string): { png: Buffer; width: number; height: number } => {
  const resvg = new Resvg(svg, {
    font,
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
  })
  const rendered = resvg.render()
  return {
    png: Buffer.from(rendered.asPng()),
    width: rendered.width,
    height: rendered.height,
  }
}

const flatten = (png: Buffer, size: number): Buffer => {
  const href = `data:image/png;base64,${png.toString("base64")}`
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1b1e"/>
  <image href="${href}" width="${size}" height="${size}"/>
</svg>`
  const out = rasterExact(svg)
  if (out.width !== size || out.height !== size) {
    throw new Error(`expected ${size}px icon, got ${out.width}x${out.height}`)
  }
  return out.png
}

const priceBlock = (): string => {
  const offer = offerModel(siteConfig)
  if (offer.pending || offer.now == null) {
    return `<text x="600" y="500" font-family="Instrument Serif" font-size="54" fill="#f8efd9">price coming soon</text>
      <text x="600" y="556" font-family="Instrument Sans" font-size="22" fill="#c9bfae">one-time license</text>`
  }
  if (offer.was) {
    const was = xml(offer.was)
    const now = xml(offer.now)
    const note = xml(offer.note ?? "launch price")
    return `<text x="600" y="492" font-family="Instrument Sans" font-size="30" fill="#c9bfae">${was}</text>
      <line x1="598" y1="482" x2="676" y2="482" stroke="#c9bfae" stroke-width="2"/>
      <text x="696" y="506" font-family="Instrument Serif" font-size="78" fill="#ffbd46">${now}</text>
      <text x="600" y="556" font-family="Instrument Sans" font-size="22" fill="#f8efd9">${note}</text>
      <text x="600" y="592" font-family="Instrument Sans" font-size="18" fill="#c9bfae">one-time license</text>`
  }
  return `<text x="600" y="510" font-family="Instrument Serif" font-size="78" fill="#ffbd46">${xml(offer.now)}</text>
    <text x="600" y="566" font-family="Instrument Sans" font-size="22" fill="#f8efd9">one-time license</text>`
}

const ogSvg = (iconPng: Buffer): string => {
  const href = `data:image/png;base64,${iconPng.toString("base64")}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#232428"/>
  <radialGradient id="glow" cx="28%" cy="46%" r="52%">
    <stop offset="0%" stop-color="#3a3b40"/>
    <stop offset="72%" stop-color="#232428" stop-opacity="0"/>
  </radialGradient>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <image href="${href}" x="8" y="28" width="575" height="575"/>
  <text x="600" y="168" font-family="Instrument Sans" font-size="16" letter-spacing="3.4" fill="#ffbd46">macos</text>
  <text x="600" y="300" font-family="Instrument Serif" font-size="118" fill="#f8efd9">jot</text>
  <text x="600" y="362" font-family="Instrument Sans" font-size="30" fill="#f8efd9">hold fn. speak. it's typed.</text>
  <rect x="600" y="392" width="72" height="4" rx="2" fill="#ffac21"/>
  ${priceBlock()}
</svg>`
}

const fallbackSvg = (iconPng: Buffer): string => {
  const href = `data:image/png;base64,${iconPng.toString("base64")}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#232428"/>
  <image href="${href}" x="80" y="150" width="420" height="420"/>
  <text x="540" y="300" font-family="Instrument Serif" font-size="92" fill="#f8efd9">intro</text>
  <text x="540" y="370" font-family="Instrument Sans" font-size="32" fill="#f8efd9">hold fn. speak. it's typed.</text>
  <text x="540" y="440" font-family="Instrument Sans" font-size="24" fill="#c9bfae">the intro isn't up yet.</text>
</svg>`
}

const origin = siteConfig.siteUrl.replace(/\/$/, "")

assertConfig(siteConfig)

const iconSvg = readFileSync(join(publicDir, "icon.svg"), "utf8")
const smallSvg = readFileSync(join(publicDir, "favicon.svg"), "utf8")
const icon1024 = raster(iconSvg, 1024)
const icon180 = raster(iconSvg, 180)
const small32 = raster(smallSvg, 32)
const small16 = raster(smallSvg, 16)

writeFileSync(join(publicDir, "apple-touch-icon.png"), flatten(icon180, 180))
writeFileSync(join(publicDir, "favicon-32.png"), flatten(small32, 32))
writeFileSync(join(publicDir, "favicon-16.png"), flatten(small16, 16))

const og = rasterExact(ogSvg(icon1024))
if (og.width !== 1200 || og.height !== 630) {
  throw new Error(`og.png is ${og.width}x${og.height}, expected 1200x630`)
}
writeFileSync(join(publicDir, "og.png"), og.png)

const videoPath = join(publicDir, "intro.mp4")
const hasVideo = existsSync(videoPath) && statSync(videoPath).size > 0
const fallbackPath = join(publicDir, "intro-fallback.png")
if (hasVideo) {
  if (existsSync(fallbackPath)) unlinkSync(fallbackPath)
  const poster = join(publicDir, "intro-poster.jpg")
  if (!existsSync(poster) || statSync(poster).size === 0) {
    throw new Error(
      "public/intro.mp4 is present but public/intro-poster.jpg is missing. Extract the frame at 38.8s."
    )
  }
} else {
  const fallback = rasterExact(fallbackSvg(icon1024))
  if (fallback.width !== 1280 || fallback.height !== 720) {
    throw new Error(
      `intro fallback is ${fallback.width}x${fallback.height}, expected 1280x720`
    )
  }
  writeFileSync(fallbackPath, fallback.png)
}

const fontsOut = join(publicDir, "fonts")
mkdirSync(fontsOut, { recursive: true })
copyFileSync(join(fontDir, "OFL-sans.txt"), join(fontsOut, "OFL-sans.txt"))
copyFileSync(join(fontDir, "OFL-serif.txt"), join(fontsOut, "OFL-serif.txt"))

writeFileSync(
  join(publicDir, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
)
writeFileSync(
  join(publicDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${xml(origin)}/</loc>\n  </url>\n</urlset>\n`
)

console.log(
  `assets ready (${hasVideo ? "intro video" : "intro fallback"}, og ${og.width}x${og.height})`
)
