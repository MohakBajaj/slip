import { sourcePrompt } from "./source";
import type { Slip } from "./types";

export const filenameFor = (createdAt: string, id: string): string =>
  `${createdAt.slice(0, 10)}-${id}.md`;

const headingPrefix = /^#+\s*/u;

export const titleOf = (content: string): string => {
  const line = content.split("\n").find((row) => row.trim());
  return (line ?? "Untitled").replace(headingPrefix, "").trim() || "Untitled";
};

export const renderIndex = (slips: Slip[]): string => {
  const open = slips.filter((slip) => !slip.archived);
  const lines = [
    "# Slip index",
    "",
    "Generated. Agents: prefer this list, then open the `.md` file.",
    "",
  ];
  for (const slip of open) {
    const tags = slip.tags.length ? ` \`${slip.tags.join("` `")}\`` : "";
    const pin = slip.pin ? " ✦" : "";
    const done = slip.done ? " ~~" : "";
    lines.push(
      `- [${done}${titleOf(slip.content)}${done}](./${slip.filename})${pin}${tags}`
    );
  }
  return `${lines.join("\n")}\n`;
};

export const promptFor = (slips: Slip[]): string =>
  slips
    .map((slip) => {
      const from = sourcePrompt(slip);
      const body = from
        ? `${from}\n\n${slip.content.trim()}`
        : slip.content.trim();
      return `## ${titleOf(slip.content)}\n\n${body}`;
    })
    .join("\n\n---\n\n");

export const listMarkdown = (slips: Slip[]): string =>
  slips.map((slip) => `- ${titleOf(slip.content)}`).join("\n");
