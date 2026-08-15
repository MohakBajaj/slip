# Slip

Local capture inbox. Vault is `~/Documents/Slip`. One `.md` file per slip. Never rename or move files.

## CLI

From this repo:

```sh
bun src/cli/index.ts list
bun src/cli/index.ts search <query>
bun src/cli/index.ts add "text"
bun src/cli/index.ts done <id>
bun src/cli/index.ts archive <id>
bun src/cli/index.ts tag <id> <tag>
bun src/cli/index.ts path <id>
bun src/cli/index.ts prompt <id> [id...]
```

`SLIP_VAULT` overrides the folder.

## Files

Frontmatter holds `id`, `section`, `tags`, `pin`, `done`, `archived`, `source`, `images`, `created`, `updated`. The body is the note. First line is the title. `INDEX.md` is generated — do not edit it.
