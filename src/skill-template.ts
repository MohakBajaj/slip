export const SLIP_CLI = "/Applications/Slip.app/Contents/Helpers/slip";

export const SKILL_MD = `# Slip

Local capture inbox. One markdown file per slip. Never rename or move
files.

## Layout

\`~/Documents/Slip/\` (or the vault path in Slip settings)

- \`YYYY-MM-DD-<6id>.md\` — a slip. State lives in frontmatter.
- \`INDEX.md\` — generated list. Do not edit.
- \`SKILL.md\` — this file.
- \`attachments/<id>/\` — images and voice notes for that slip.

## Frontmatter

\`\`\`yaml
id: a1b2c3
section: ""
tags: []
pin: false
done: false
archived: false
source: ""
url: ""
page: ""
images: []
audio: []
created: 2026-08-15T00:00:00.000Z
updated: 2026-08-15T00:00:00.000Z
\`\`\`

The body is the note. First line is the title.

\`source\` is the app (or \`cli\`). Captures from a browser also set \`url\`
and \`page\`. Voice captures set \`audio\` to the recording path(s).

## CLI

The CLI is inside Slip.app. The app does not need to be running. There
is no separate CLI install.

\`${SLIP_CLI} <command>\`

If Slip is not in Applications, use \`Slip.app/Contents/Helpers/slip\`
from wherever the app lives.

\`\`\`sh
${SLIP_CLI} list
${SLIP_CLI} search <query>
${SLIP_CLI} add "text"
${SLIP_CLI} done <id>
${SLIP_CLI} archive <id>
${SLIP_CLI} tag <id> <tag>
${SLIP_CLI} path <id>
${SLIP_CLI} prompt <id> [id...]
${SLIP_CLI} vault
\`\`\`

\`--vault <dir>\` or \`SLIP_VAULT\` overrides the folder. Otherwise the
CLI uses the vault path from Slip settings, then
\`~/Documents/Slip\`.

## Rules

- Prefer editing the \`.md\` body. Keep \`id\` and \`filename\` stable.
- To file a slip, set \`section\` or \`tags\` — do not move the file.
- To drop it from the inbox, set \`archived: true\`.
- \`INDEX.md\` is rewritten by the app and the CLI after every write.
`;
