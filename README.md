# Slip

A local capture inbox. Select text anywhere, press **Shift Shift**, and it becomes a markdown file in `~/Documents/Slip`. Hold **Option** to speak, and Slip transcribes it on this Mac. **⌘⇧ ⌘⇧** opens a draw overlay.

No account, no sync, no telemetry. Agents read the folder.

## Install

Download the latest macOS archive from [Releases](https://github.com/MohakBajaj/slip/releases). Open the `.dmg` or unzip the `.zip`, then drag **Slip** into Applications.

The build is unsigned. Right-click **Slip** and choose Open the first time.

Grant **Accessibility** the first time you capture, and **Microphone** the first time you speak a slip. Closing the window hides it. The menu-bar item keeps capturing.

The first spoken slip downloads the speech model (about 200 MB) into Application Support. Nothing else leaves the machine. Transcription uses [Parakeet Redux](https://huggingface.co/moondream/parakeet-redux) by Moondream, a 1.58-bit build of NVIDIA's parakeet-tdt-0.6b-v3, under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Spoken slips are cleaned up on device with Apple Intelligence when it is turned on: fillers and false starts come out, and the wording stays. The original transcript is kept on the slip. Settings can send that cleanup to an OpenAI-compatible endpoint instead. The API key is stored with the macOS keychain, not in the settings file.

## Capture

Defaults, remappable in Settings:

- **⇧ ⇧** — the current selection, including images in it, or a screenshot on the clipboard
- **⌃ ⌃** — a quick note, without bringing Slip forward
- **⌥** hold — speak; the text is saved. **⌥ ⌥** latches the recorder
- **⌘⇧ ⌘⇧** — draw on a transparent overlay. Annotate draws on a slip image and saves a new png next to the original

Drop images onto a slip. Merge selected slips from the command palette.

## CLI

The CLI lives inside the app. There is no separate binary or npm package. The app does not need to be running.

```sh
/Applications/Slip.app/Contents/Helpers/slip list
/Applications/Slip.app/Contents/Helpers/slip add "a note"
```

Optional PATH shim (still the app binary):

```sh
ln -sf /Applications/Slip.app/Contents/Helpers/slip /usr/local/bin/slip
```

`--vault <dir>` or `SLIP_VAULT` overrides the folder. Otherwise the CLI uses the vault path from Slip settings.

See [SKILL.md](SKILL.md) for the full command list.

## Vault

`~/Documents/Slip/`

- `YYYY-MM-DD-<id>.md` — one slip. Never renamed or moved.
- `INDEX.md` — generated
- `SKILL.md` — how agents should use the vault
- `attachments/<id>/` — images and drawings. Older slips may still include a recording.

## Develop

```sh
bun install
bun run dev
```

Grant Accessibility to Electron while developing.

Voice needs the transcriber binary: `sh scripts/fetch-parakeet.sh`. On a Mac, `sh scripts/build-cleanup.sh` builds the Apple Intelligence helper.

## Release

```sh
bun run release:mac
```

Writes `dist/Slip-<version>.dmg` and `dist/Slip-<version>-arm64-mac.zip`. Both contain `Slip.app` with the CLI at `Contents/Helpers/slip`. `bun run package:mac` writes the unpacked app only, at `dist/mac-arm64/Slip.app`.
