# Slip

A local capture inbox. Select text anywhere, press **Shift Shift**, and it becomes a markdown file in `~/Documents/Slip`. Hold **fn** to dictate into the app you are using. **⌃⌥A** annotates the screen.

No account, no sync, no telemetry. Agents read the folder.

## Install

Download the latest macOS archive from [Releases](https://github.com/MohakBajaj/slip/releases). Open the `.dmg` or unzip the `.zip`, then drag **Slip** into Applications.

The build is not notarized. Right-click **Slip** and choose Open the first time. Slip needs macOS 12 or newer.

Grant **Accessibility** the first time you capture, **Input Monitoring** to dictate with fn, and **Microphone** the first time you speak a slip. Closing the window hides it. The menu-bar item keeps capturing. **Check for Updates…** replaces the app in place. An ad-hoc signature changes every build, so macOS asks for Accessibility again after that kind of update.

The first spoken slip downloads the speech model (about 200 MB) into Application Support. Transcription defaults to [Parakeet Redux](https://huggingface.co/moondream/parakeet-redux) by Moondream, a 1.58-bit build of NVIDIA's parakeet-tdt-0.6b-v3, under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Cleanup defaults to Apple Intelligence on this Mac: fillers and false starts come out, and the wording stays. The original transcript is kept on the slip. Settings can send transcription, cleanup, or both to a cloud model through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). The gateway key is stored with the macOS keychain, not in the settings file. If a cloud transcription fails, Slip uses Parakeet. If a cloud cleanup fails, Slip uses Apple Intelligence, then the raw transcript.

## Capture

Defaults, remappable in Settings:

- **⇧ ⇧** — the current selection, including images in it, or a screenshot on the clipboard
- **fn** hold — dictate into the focused app. A short tap is ignored. Another key cancels. If fn opens the emoji picker, set Keyboard → Press 🌐 key to Do Nothing
- **⌃⌥A** — annotate a screenshot, or a region when the clipboard has no image. A drawing that is already open stays open
- **⌃ ⌃**, **⌥** hold, and **⌘⇧ ⌘⇧** — quick note, voice, and draw. Off until you set them. The Inbox menu opens each one
- Dictate's old **⌃⌥D** chord is off until you set a shortcut in Settings

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

`AI_GATEWAY_API_KEY=... bun scripts/bench-cleanup.ts` times cleanup models. `AI_GATEWAY_API_KEY=... bun scripts/bench-transcribe.ts <file.wav>` does the same for transcription.

## Release

Cutting a release does not publish it. From a clean tree:

```sh
bun run release patch   # or minor, or major
git push origin HEAD
git push origin vX.Y.Z
```

`bun run release` bumps `package.json`, moves the `Unreleased` notes in [CHANGELOG.md](CHANGELOG.md) under that version, commits, and tags. You push. The tag runs `.github/workflows/release.yml` on `macos-latest`, which checks the tag against `package.json`, runs typecheck, check, and tests, builds the arm64 dmg and zip, and publishes a GitHub Release with `latest.json` and `SHA256SUMS`. Packaging runs the same steps as `package:mac` before it signs: the CLI, `parakeet-cli`, and `slip-cleanup`. The zip must contain both helpers. The release notes are that version's changelog section. A pull request runs the same package and manifest steps and uploads artifacts. It does not publish. The updater copies the whole app, so those helpers come along, and it leaves the app in place if the download is missing either one. The speech model in Application Support is outside the app and is not touched.

`bun run release:mac` is the local pack (dmg, zip, and `latest.json`) and does not upload. `bun run package:mac` writes the unpacked app only, at `dist/mac-arm64/Slip.app`.

### Signing

`electron-builder.yml` sets `identity: null`, so electron-builder does not sign even if `CSC_LINK` is set. The release script signs afterwards with `@electron/osx-sign` and `hardenedRuntime: false`.

Both repository secrets must be set, or both left empty:

- `CSC_LINK` — base64 of a PKCS#12 file, with the line breaks removed
- `CSC_KEY_PASSWORD` — password for that file

The certificate is self-signed. It is not an Apple Developer ID. On a Mac:

1. Open Keychain Access → Certificate Assistant → Create a Certificate.
2. Name it `Slip Release`. Identity Type: Self Signed Root. Certificate Type: Code Signing.
3. Override the defaults and give it a long life, about ten years. Accept the rest.
4. Select the certificate and its private key, then File → Export Items as a `.p12`. Choose a password.
5. `base64 -i SlipRelease.p12 | tr -d '\n'`
6. Add the two secrets under Settings → Secrets and variables → Actions. Do not commit the `.p12` or the password.

When both secrets are present, the designated requirement stays `identifier "dev.mohak.slip" and certificate leaf = H"<that cert>"`, so the Accessibility and Input Monitoring grants can survive an update. When either secret is missing, the build is ad-hoc signed and that requirement includes a new cdhash every time, so macOS drops the grants.

That stable certificate would satisfy Squirrel.Mac's check: it compares the update to the running app's designated requirement, and a self-signed cert is valid for that comparison. It is still not how Slip updates. Copies installed before the certificate exist have no stable signature, so Squirrel refuses them, and ShipIt does not strip quarantine. Without a Developer ID, Gatekeeper still treats the app as unidentified. Slip downloads `latest.json` from this repo's releases, checks the zip's SHA-256, checks the bundle id and version, then a helper replaces the `.app` after quit and strips quarantine.
