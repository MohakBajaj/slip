import { existsSync, statSync } from "node:fs"
import { resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, type Connect, type Plugin } from "vite"
import { loadChangelog, renderChangelogPage, repoChangelogPath } from "./src/changelog"
import { renderPage } from "./src/render"

const root = fileURLToPath(new URL(".", import.meta.url))

const hasIntroVideo = (): boolean => {
  const path = resolve(root, "public/intro.mp4")
  return existsSync(path) && statSync(path).size > 0
}

const rewriteChangelog = (req: Connect.IncomingMessage): void => {
  const url = req.url ?? ""
  const path = url.split("?")[0]
  if (path === "/changelog") {
    req.url = `/changelog/${url.slice(path.length)}`
  }
}

const changelogRoute = (): Plugin => ({
  name: "jot-changelog-route",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      rewriteChangelog(req)
      next()
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      rewriteChangelog(req)
      next()
    })
  },
})

const siteHtml = (): Plugin => ({
  name: "jot-site-html",
  transformIndexHtml: {
    order: "pre",
    handler(html, ctx) {
      const file = ctx.filename ?? ""
      if (file.endsWith(`${sep}changelog${sep}index.html`)) {
        return renderChangelogPage(html, loadChangelog(repoChangelogPath(root)))
      }
      return renderPage(html, { hasVideo: hasIntroVideo() })
    },
  },
})

export default defineConfig({
  plugins: [tailwindcss(), changelogRoute(), siteHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        changelog: fileURLToPath(new URL("./changelog/index.html", import.meta.url)),
      },
    },
  },
})
