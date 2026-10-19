# Changelog

All notable changes to Slip are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Transcription and cleanup each choose on-device or cloud. Cloud models come from Vercel AI Gateway, with one key stored in the keychain. A failed cloud transcription falls back to Parakeet. A failed cloud cleanup falls back to Apple Intelligence, then the raw transcript.
- Quick note. Control Control writes a note into the vault without raising Slip (#3).
- Draw can annotate an image and save the drawing as a new PNG beside it (#5).
- Spoken slips are transcribed on this Mac. The release includes `parakeet-cli` and `slip-cleanup`, and an update will not replace the app if either is missing. The speech model stays in Application Support (#4).
- Check for Updates, in the Slip menu and every few hours. The app downloads its own GitHub release zip, checks the SHA-256 from `latest.json`, then replaces the running app.
- `bun run release patch|minor|major` bumps the version from this file, commits, and tags. It does not push.

### Changed

- Speech cleanup only deletes filler and fixes punctuation; it no longer rewrites words (#7).
- Draw uses Quickdraw in place of the old draw overlay (#10).

### Fixed

- A voice slip shows its transcription plus cleanup cost beside the time, and keeps that cost in frontmatter.
- Cloud cleanup asks for effort `none` instead of the catalog value `instant`, and the default cleanup model is alibaba/qwen3.7-flash.
- Stylesheet build, clipboard capture, and macOS CI (#2).
- Remote capture images time out, stay under a byte cap, and do not follow redirects onto private hosts (#2).
- Draw toolbar tooltips stay inside the window instead of being clipped (#11).
- A release without `latest.json` counts as up to date, so the updater no longer shows a "Couldn't check for updates" error when that file is missing (#12).

## [1.0.4] - 2026-08-22

### Fixed

- Menu bar extra stays put when macOS changes the activation policy.

## [1.0.3] - 2026-08-20

### Fixed

- Menu bar extra no longer dismisses itself when the vault updates.

## [1.0.2] - 2026-08-20

### Added

- Settings can install the Slip skill into ~/.agents.

## [1.0.1] - 2026-08-20

### Added

- Mixed slips copy as one clipboard item, including images from a capture selection.

## [1.0.0] - 2026-08-19

### Added

- Local capture inbox. Shift Shift saves the selection as markdown in ~/Documents/Slip.
- Menu bar extra, dock icon, and settings for theme, accent, zoom, and capture keys.
- Images, voice notes, a draw overlay, and slip merge.
- Source app, page, and URL stored on a capture.
- CLI shipped inside Slip.app at Contents/Helpers/slip.
- macOS disk image styled like Slip paper.

[Unreleased]: https://github.com/MohakBajaj/slip/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/MohakBajaj/slip/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/MohakBajaj/slip/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/MohakBajaj/slip/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/MohakBajaj/slip/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/MohakBajaj/slip/releases/tag/v1.0.0
