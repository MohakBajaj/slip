import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buyMarkup, escapeHtml, siteConfig } from "./render"

const versionHeading = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/u
const groupHeading = /^###\s+(.+?)\s*$/u
const bulletLine = /^[-*]\s+(.+)$/u
const continuedLine = /^ {2,}(\S.*)$/u
const referenceLine = /^\[[^\]]+\]:\s+\S+/u

export type ChangelogGroup = {
  name: string
  items: string[]
}

export type ChangelogEntry = {
  version: string
  date: string
  anchor: string
  notes: string[]
  groups: ChangelogGroup[]
}

export const versionAnchor = (version: string): string =>
  `v${version.replaceAll(".", "-")}`

export const repoChangelogPath = (siteRoot: string): string =>
  join(siteRoot, "..", "CHANGELOG.md")

const flushNote = (entry: ChangelogEntry | null, buffer: string[]): void => {
  const note = buffer.join(" ").trim()
  buffer.length = 0
  if (entry && note.length > 0) entry.notes.push(note)
}

/** Dated `## [x.y.z] - YYYY-MM-DD` sections. Unreleased and link refs are skipped. */
export const parseChangelog = (markdown: string): ChangelogEntry[] => {
  if (markdown.trim().length === 0) {
    throw new Error("CHANGELOG.md is empty")
  }
  const entries: ChangelogEntry[] = []
  const seen = new Set<string>()
  let current: ChangelogEntry | null = null
  let group: ChangelogGroup | null = null
  const notes: string[] = []

  for (const line of markdown.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const version = versionHeading.exec(line)
    if (version) {
      flushNote(current, notes)
      const number = version[1] ?? ""
      const anchor = versionAnchor(number)
      if (seen.has(anchor)) {
        throw new Error(`CHANGELOG.md repeats version ${number}`)
      }
      seen.add(anchor)
      current = {
        version: number,
        date: version[2] ?? "",
        anchor,
        notes: [],
        groups: [],
      }
      entries.push(current)
      group = null
      continue
    }
    if (!current) continue
    if (/^##\s/u.test(line)) {
      flushNote(current, notes)
      current = null
      group = null
      continue
    }
    const heading = groupHeading.exec(line)
    if (heading) {
      flushNote(current, notes)
      group = { name: heading[1] ?? "", items: [] }
      current.groups.push(group)
      continue
    }
    if (referenceLine.test(line)) continue
    const bullet = bulletLine.exec(line)
    if (bullet) {
      flushNote(current, notes)
      if (!group) {
        group = { name: "Notes", items: [] }
        current.groups.push(group)
      }
      group.items.push((bullet[1] ?? "").trim())
      continue
    }
    const continued = continuedLine.exec(line)
    if (continued && group && group.items.length > 0) {
      const last = group.items.length - 1
      group.items[last] = `${group.items[last]} ${(continued[1] ?? "").trim()}`
      continue
    }
    if (line.trim().length === 0) {
      flushNote(current, notes)
      continue
    }
    if (!group) notes.push(line.trim())
  }
  flushNote(current, notes)
  if (entries.length === 0) {
    throw new Error("CHANGELOG.md has no version sections")
  }
  return entries
}

export const loadChangelog = (path: string): ChangelogEntry[] => {
  if (!existsSync(path)) {
    throw new Error(`CHANGELOG.md is missing at ${path}`)
  }
  const text = readFileSync(path, "utf8")
  if (text.trim().length === 0) {
    throw new Error(`CHANGELOG.md is empty at ${path}`)
  }
  return parseChangelog(text)
}

const linkify = (value: string): string => {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/gu
  let out = ""
  let last = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    out += escapeHtml(value.slice(last, index))
    const label = match[1] ?? ""
    const href = match[2] ?? ""
    const rel = href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""
    out += `<a href="${escapeHtml(href)}"${rel}>${escapeHtml(label)}</a>`
    last = index + match[0].length
  }
  return out + escapeHtml(value.slice(last))
}

export const renderInline = (value: string): string => {
  const parts = value.split("`")
  if (parts.length % 2 === 0) return linkify(value)
  return parts
    .map((part, index) =>
      index % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : linkify(part)
    )
    .join("")
}

export const changelogMarkup = (entries: ChangelogEntry[]): string =>
  entries
    .map((entry) => {
      const notes = entry.notes
        .map((note) => `<p class="release-note">${renderInline(note)}</p>`)
        .join("")
      const groups = entry.groups
        .map((item) => {
          const bullets = item.items
            .map((bullet) => `<li>${renderInline(bullet)}</li>`)
            .join("")
          return `<section><h3>${escapeHtml(item.name)}</h3><ul>${bullets}</ul></section>`
        })
        .join("")
      return `<article class="release" id="${escapeHtml(entry.anchor)}">
        <header class="release-head">
          <h2>${escapeHtml(entry.version)}</h2>
          <time datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date)}</time>
        </header>
        ${notes}
        ${groups}
      </article>`
    })
    .join("")

export const sitemapXml = (origin: string): string => {
  const base = origin.replace(/\/$/u, "")
  const urls = ["/", "/changelog"]
    .map(
      (path) =>
        `  <url>\n    <loc>${escapeHtml(`${base}${path}`)}</loc>\n  </url>`
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export const renderChangelogPage = (
  html: string,
  entries: ChangelogEntry[]
): string => {
  const origin = siteConfig.siteUrl.replace(/\/$/u, "")
  const replacements: Record<string, string> = {
    __ORIGIN__: origin,
    __BUY_HEADER__: buyMarkup(siteConfig, "link"),
    __CHANGELOG__: changelogMarkup(entries),
  }
  let out = html
  for (const [token, value] of Object.entries(replacements)) {
    if (!out.includes(token)) throw new Error(`missing token ${token}`)
    out = out.replaceAll(token, value)
  }
  const leftover = out.match(/__[A-Z0-9_]+__/g)
  if (leftover) throw new Error(`unreplaced tokens: ${leftover.join(", ")}`)
  return out
}
