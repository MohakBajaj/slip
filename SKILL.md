# Slip

Local capture inbox. One markdown file per slip. Never rename or move files. Vault is `~/Documents/Slip` unless Slip settings or `SLIP_VAULT` say otherwise.

## CLI

The CLI ships inside Slip.app only. The app does not need to be running. Do not call `bun src/cli` — that path is not part of a release.

`/Applications/Slip.app/Contents/Helpers/slip <command>`

If Slip is not in Applications, use `Slip.app/Contents/Helpers/slip` from wherever the app lives.

```sh
/Applications/Slip.app/Contents/Helpers/slip list
/Applications/Slip.app/Contents/Helpers/slip search <query>
/Applications/Slip.app/Contents/Helpers/slip add "text"
/Applications/Slip.app/Contents/Helpers/slip done <id>
/Applications/Slip.app/Contents/Helpers/slip archive <id>
/Applications/Slip.app/Contents/Helpers/slip tag <id> <tag>
/Applications/Slip.app/Contents/Helpers/slip path <id>
/Applications/Slip.app/Contents/Helpers/slip prompt <id> [id...]
/Applications/Slip.app/Contents/Helpers/slip vault
```

`--vault <dir>` or `SLIP_VAULT` overrides the folder.

## Files

Frontmatter holds `id`, `section`, `tags`, `pin`, `done`, `archived`, `source`, `url`, `page`, `images`, `audio`, `transcript`, `created`, `updated`. `images` and `audio` are path lists. Drawings land in `images`. Annotating an image adds a new png there and leaves the original file in place. The body is the note. First line is the title. `INDEX.md` is generated — do not edit it.

`source` is the app, `cli`, `note` for a quick note, or `voice` for speech. Browser captures also set `url` and `page`. A voice slip's body is the cleaned note, and `transcript` is the original speech. Older voice captures may set `audio` to a recording path instead.
