import type { Slip } from "./types";

export const filenameFor = (createdAt: string, id: string): string =>
  `${createdAt.slice(0, 10)}-${id}.md`;

const headingPrefix = /^#+\s*/u;

export const titleOf = (content: string): string => {
  const line = content.split("\n").find((row) => row.trim());
  return (line ?? "Untitled").replace(headingPrefix, "").trim() || "Untitled";
};

export const bodyOf = (content: string): string => {
  const lines = content.split("\n");
  const first = lines.findIndex((row) => row.trim().length > 0);
  if (first === -1) {
    return "";
  }
  return lines
    .slice(first + 1)
    .join("\n")
    .trim();
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
    .map((slip) => `## ${titleOf(slip.content)}\n\n${slip.content.trim()}`)
    .join("\n\n---\n\n");

export const listMarkdown = (slips: Slip[]): string =>
  slips.map((slip) => `- ${titleOf(slip.content)}`).join("\n");
