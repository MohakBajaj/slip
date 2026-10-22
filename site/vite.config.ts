import { existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, type Plugin } from "vite"
import { renderPage } from "./src/render"

const root = fileURLToPath(new URL(".", import.meta.url))

const hasIntroVideo = (): boolean => {
  const path = resolve(root, "public/intro.mp4")
  return existsSync(path) && statSync(path).size > 0
}

const siteHtml = (): Plugin => ({
  name: "jot-site-html",
  transformIndexHtml(html) {
    return renderPage(html, { hasVideo: hasIntroVideo() })
  },
})

export default defineConfig({
  plugins: [tailwindcss(), siteHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
