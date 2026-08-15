# Slip

A local capture inbox. Select text anywhere, press **Shift Shift**, and it becomes a markdown file in `~/Documents/Slip`.

No account, no sync, no telemetry. Agents read the folder.

## Install

Download the latest macOS archive from [Releases](https://github.com/MohakBajaj/slip/releases). Open the `.dmg` or unzip the `.zip`, then drag **Slip** into Applications.

Grant **Accessibility** the first time you capture. Closing the window hides it. The menu-bar item keeps capturing.

Do not run Slip and Copper at the same time — both listen for the capture sequence.

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
- `attachments/<id>/` — images

## Develop

```sh
bun install
bun run dev
```

Grant Accessibility to Electron while developing.

## Release

```sh
bun run release:mac
```

Writes `dist/slip-<version>.dmg` and `dist/Slip-<version>-arm64-mac.zip`. Both contain `Slip.app` with the CLI at `Contents/Helpers/slip`.
