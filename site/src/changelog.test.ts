import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  changelogMarkup,
  loadChangelog,
  parseChangelog,
  repoChangelogPath,
  sitemapXml,
  versionAnchor,
} from "./changelog"

const sample = `# Changelog

## [Unreleased]

- not a release yet

## [1.0.8] - 2026-10-22

### Changed

- Jot is the app. The bundle id is \`dev.mohak.jot\`.
- A line that
  continues.

### Fixed

- Quitting no longer stays stuck.

## [2.0.0] - 2027-01-02

Introduced in this cut. See [notes](https://example.com/notes).

### Added

- <script>alert(1)</script> stays text.

[1.0.8]: https://github.com/example/compare/v1.0.7...v1.0.8
[2.0.0]: https://github.com/example/releases/tag/v2.0.0
`

describe("changelog parser", () => {
  test("turns dated headings into anchored groups", () => {
    const entries = parseChangelog(sample)
    expect(entries.map((entry) => entry.version)).toEqual(["1.0.8", "2.0.0"])
    expect(entries[0]?.anchor).toBe("v1-0-8")
    expect(versionAnchor("2.10.0")).toBe("v2-10-0")
    expect(entries[0]?.date).toBe("2026-10-22")
    expect(entries[0]?.groups.map((group) => group.name)).toEqual([
      "Changed",
      "Fixed",
    ])
    expect(entries[0]?.groups[0]?.items[1]).toBe("A line that continues.")
    expect(entries[1]?.notes).toEqual([
      "Introduced in this cut. See [notes](https://example.com/notes).",
    ])
    expect(JSON.stringify(entries)).not.toContain("not a release yet")
    expect(JSON.stringify(entries)).not.toContain("github.com")
  })

  test("renders version anchors, groups, code, and escaped text", () => {
    const html = changelogMarkup(parseChangelog(sample))
    expect(html).toContain('id="v1-0-8"')
    expect(html).toContain('id="v2-0-0"')
    expect(html).toContain('datetime="2026-10-22"')
    expect(html).toContain("<h3>Changed</h3>")
    expect(html).toContain("<code>dev.mohak.jot</code>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>alert")
    expect(html).toContain('href="https://example.com/notes"')
    expect(html).toContain('rel="noopener"')
    expect(html).not.toContain("Unreleased")
  })

  test("fails on an empty changelog or one with no versions", () => {
    expect(() => parseChangelog("")).toThrow("empty")
    expect(() => parseChangelog("   \n")).toThrow("empty")
    expect(() => parseChangelog("# Changelog\n\n## [Unreleased]\n")).toThrow(
      "no version sections"
    )
    expect(() =>
      parseChangelog(
        "## [1.0.0] - 2026-01-01\n\n## [1.0.0] - 2026-01-02\n"
      )
    ).toThrow("repeats version 1.0.0")
  })

  test("fails the load when the file is missing or empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "jot-changelog-"))
    expect(() => loadChangelog(join(dir, "CHANGELOG.md"))).toThrow("missing")
    const empty = join(dir, "empty.md")
    writeFileSync(empty, "\n")
    expect(() => loadChangelog(empty)).toThrow("empty")
  })

  test("parses the repo changelog", () => {
    const entries = loadChangelog(repoChangelogPath(join(import.meta.dir, "..")))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/u)
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
      expect(entry.anchor).toBe(versionAnchor(entry.version))
    }
  })

  test("lists the home page and the changelog in the sitemap", () => {
    const xml = sitemapXml("https://sayjot.xyz/")
    expect(xml).toContain("<loc>https://sayjot.xyz/</loc>")
    expect(xml).toContain("<loc>https://sayjot.xyz/changelog</loc>")
  })
})
