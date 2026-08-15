export const SKILL_MD = `# Slip

Local capture inbox. One markdown file per slip. Never rename or move files.

## Layout

\`~/Documents/Slip/\` (or the vault path in settings)

- \`YYYY-MM-DD-<6id>.md\` — a slip. State lives in frontmatter.
- \`INDEX.md\` — generated list. Do not edit.
- \`SKILL.md\` — this file.
- \`attachments/<id>/\` — images for that slip.

## Frontmatter

\`\`\`yaml
id: a1b2c3
section: ""
tags: []
pin: false
done: false
archived: false
source: ""
images: []
created: 2026-08-15T00:00:00.000Z
updated: 2026-08-15T00:00:00.000Z
\`\`\`

The body is the note. First line is the title.

## CLI

From the Slip repo (files only — the app does not need to be running):

\`\`\`sh
bun src/cli/slip.ts list
bun src/cli/slip.ts search <query>
bun src/cli/slip.ts add "text"
bun src/cli/slip.ts done <id>
bun src/cli/slip.ts archive <id>
bun src/cli/slip.ts tag <id> <tag>
bun src/cli/slip.ts path <id>
bun src/cli/slip.ts prompt <id> [id...]
\`\`\`

\`SLIP_VAULT\` overrides the folder. Default is \`~/Documents/Slip\`.

## Rules

- Prefer editing the \`.md\` body. Keep \`id\` and \`filename\` stable.
- To file a slip, set \`section\` or \`tags\` — do not move the file.
- To drop it from the inbox, set \`archived: true\`.
- \`INDEX.md\` is rewritten by the app and the CLI after every write.
`;
