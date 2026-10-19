export const SLIP_CLI = "/Applications/Slip.app/Contents/Helpers/slip";

export const SKILL_MD = `# Slip

Local capture inbox. One markdown file per slip. Never rename or move
files.

## Layout

\`~/Documents/Slip/\` (or the vault path in Slip settings)

- \`YYYY-MM-DD-<6id>.md\` — a slip. State lives in frontmatter.
- \`INDEX.md\` — generated list. Do not edit.
- \`SKILL.md\` — this file.
- \`attachments/<id>/\` — images and drawings for that slip. Older slips may still include a recording.

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

\`source\` is the app, \`cli\`, \`note\` for a quick note, or \`voice\` for
speech. Captures from a browser also set \`url\` and \`page\`. A voice
slip's body is the cleaned note, and \`transcript\` is what was said.
\`cost\` is that slip's transcription plus cleanup spend in USD.
Older voice captures may set \`audio\` to a recording path. Drawings land
in \`images\`. Annotating an image adds a new png there and leaves the
original file in place.

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

export const AGENT_SKILL_MD = `---
name: slip
description: >
  Local capture inbox. One markdown file per slip. Use when reading,
  searching, filing, tagging, or adding slips; using the Slip CLI;
  or when the user mentions Slip, their inbox, or captured notes.
---

${SKILL_MD}`;
