# Slip

A local capture inbox. Select text anywhere, press **Shift Shift**, and it becomes a markdown file in `~/Documents/Slip`.

No account, no sync, no telemetry. Agents read the folder.

## Run

```sh
bun install
bun run dev
```

```sh
bun src/cli/index.ts list
bun src/cli/index.ts add "a note"
```

Do not run Slip and Copper at the same time — both listen for Shift Shift.

Grant **Accessibility** to Electron while developing, or to Slip once packaged. Closing the window hides it. The menu-bar item keeps capturing.

## Vault

`~/Documents/Slip/`

- `YYYY-MM-DD-<id>.md` — one slip. Never renamed or moved.
- `INDEX.md` — generated
- `SKILL.md` — how agents should use the vault
- `attachments/<id>/` — images
