# Changelog

All notable changes to Jot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.8] - 2026-10-22

### Changed

- Jot is the app. The bundle id is `dev.mohak.jot`. Notes that already live in Documents/Slip stay there. The first launch moves Application Support from Slip to Jot.
- Releases 1.0.5–1.0.7 cannot install this build on their own. Install the dmg or zip once by hand. After that, Check for Updates works.

### Fixed

- Quitting from the Dock, the Apple menu, or an update no longer stays stuck on the quick-note window, and a second launch does not add another Dock tile.

## [1.0.7] - 2026-10-21

### Added

- Hold fn to dictate anywhere. If fn opens something else, set System Settings → Keyboard → Press 🌐 key to Do Nothing.
- Clean up transcripts, on by default. Off pastes the trimmed transcript and skips cleanup.

### Changed

- Fewer shortcuts by default. Less-used actions stay on the buttons and menus. A chord you already saved is kept, and you can clear it.
- Settings is slimmer.

## [1.0.6] - 2026-10-20

1.0.5 was tagged on October 19 and never published. This is the first release since 1.0.4.

### Added

- Annotate anywhere. Control-Option-A marks up the image on the clipboard, or a region of the screen if the clipboard has none. Copy puts the drawing on the clipboard. Inbox saves a slip. Escape throws it away. Nothing is saved unless you ask.
- Dictate anywhere. Control-Option-D. Hold to talk, or tap to start and stop. A small pill shows the level. Slip types the text into the app you were using. If it cannot paste, the text stays on the clipboard and the pill tells you to allow Accessibility. Dictations stay out of the inbox unless you turn on Keep dictations in inbox.
- Annotate and Dictate are in the command palette, the menus, Settings, and the shortcut list.
- Quick note. Control Control writes a note into the vault without opening Slip.
- Draw can mark up an image you already captured and save a new PNG next to it.
- Spoken slips are transcribed on this Mac. Transcription and cleanup can each stay on this Mac or use the cloud, with one Vercel AI Gateway key stored in the keychain. If cloud transcription fails, Slip uses the on-device model. If cloud cleanup fails, it tries Apple Intelligence, then keeps the raw transcript.
- Check for Updates, in the Slip menu and every few hours. Slip downloads its own release, checks the checksum, and replaces itself. The speech model in Application Support is left alone.

### Changed

- Delete any slip right away, from the inbox or the archive, with Command-Delete, the menu, or the action menu. Undo puts the files back. When that undo is gone, or Slip quits, the files go to the Trash.
- Inbox shortcuts match across the window and show on the buttons. Arrows or J and K move, Return opens, Escape closes, and ? lists them. Single-key actions stay quiet while you are typing.
- Settings opens on capture, voice notes, and theme. The rest is under Advanced.
- Slip uses the system font and simpler icons.
- The buttons on an open slip stay inside the window.
- The draw window has room for its toolbar. A failed capture is stated once. When a key, a copy, or a shortcut fails, Slip says what happened.
- Starting a new slip leaves the archive.
- Speech cleanup only removes filler and fixes punctuation. It does not rewrite what you said.
- A single sentence of 20 words or fewer, with no correction or command cue, skips cleanup. Dictate pastes that transcript trimmed, as spoken.
- A voice slip shows what cloud transcription and cleanup cost, next to the time.

### Fixed

- Dictating into another app no longer quits Slip. Pasting the transcript was crashing the app (#18).
- A date in a slip stays the date you wrote, and a quoted "false" does not mark it done.
- An update no longer removes Slip before the new copy is in place. If the swap fails, Slip puts the old app back and opens it.
- Undo changes only the slips that action touched.
- Refreshing the inbox no longer puts older settings back over a change you just made.
- A page image is not fetched when its name points at this Mac, and a slip cannot copy a file outside its attachments.
- A markdown file that is not a slip is left alone.
- A bad message from the window is ignored instead of being saved as a slip.
- If a release stops after the version bump, running it again adds the tag instead of bumping once more.
- A blank line at the end of a note is kept.
- Escape on a new note no longer marks it edited.
- You can dictate again after a notice, and you can retake an annotation that came out blank.
- Annotate does not open on top of the draw window.
- Selecting a range of slips works, and amber text is easier to read.
- Draw tooltips stay inside the window.
- If a release has no update file, Slip treats that as up to date instead of showing an error.
- Images fetched for a capture time out, stay under a size limit, and are not loaded from private addresses.
- Copying a selection that includes images works again.

## [1.0.5] - 2026-10-19

Tagged on this date and not published. The changes below are included in 1.0.6.

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

[Unreleased]: https://github.com/MohakBajaj/slip/compare/v1.0.8...HEAD
[1.0.8]: https://github.com/MohakBajaj/slip/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/MohakBajaj/slip/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/MohakBajaj/slip/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/MohakBajaj/slip/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/MohakBajaj/slip/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/MohakBajaj/slip/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/MohakBajaj/slip/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/MohakBajaj/slip/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/MohakBajaj/slip/releases/tag/v1.0.0
