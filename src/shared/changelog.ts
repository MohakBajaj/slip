const REPO = "https://github.com/MohakBajaj/slip";
const VERSION_HEADING = /^## \[(?<version>\d+\.\d+\.\d+)\]/u;
const FOOTER = /^\[[^\]]+\]: https:\/\/github\.com\/MohakBajaj\/slip\//u;

export type ReleaseLevel = "major" | "minor" | "patch";

export const bumpVersion = (version: string, level: ReleaseLevel): string => {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(version);
  if (match?.groups === undefined) {
    throw new Error(`invalid version ${version}`);
  }
  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor);
  const patch = Number(match.groups.patch);
  if (level === "major") {
    return `${major + 1}.0.0`;
  }
  if (level === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
};

const sectionBounds = (
  lines: string[],
  version: string
): { end: number; start: number } | null => {
  const start = lines.findIndex((line) =>
    version === "unreleased"
      ? line === "## [Unreleased]"
      : line.startsWith(`## [${version}]`)
  );
  if (start === -1) {
    return null;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").startsWith("## [")) {
      end = index;
      break;
    }
  }
  return { end, start };
};

export const changelogSection = (
  markdown: string,
  version: string
): string | null => {
  const lines = markdown.split(/\r?\n/u);
  const bounds = sectionBounds(lines, version);
  if (bounds === null) {
    return null;
  }
  return lines
    .slice(bounds.start + 1, bounds.end)
    .join("\n")
    .trim();
};

export const unreleasedNotes = (markdown: string): string | null => {
  const body = changelogSection(markdown, "unreleased");
  if (body === null) {
    return null;
  }
  const meaningful = body.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });
  if (meaningful.length === 0) {
    return null;
  }
  return body;
};

const versionsIn = (markdown: string): string[] => {
  const versions: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = VERSION_HEADING.exec(line);
    const version = match?.groups?.version;
    if (version !== undefined) {
      versions.push(version);
    }
  }
  return versions;
};

export const rebuildFooter = (markdown: string): string => {
  const body = markdown
    .split(/\r?\n/u)
    .filter((line) => !FOOTER.test(line))
    .join("\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trimEnd();
  const versions = versionsIn(body);
  const newest = versions[0] ?? "0.0.0";
  const links = ["", `[Unreleased]: ${REPO}/compare/v${newest}...HEAD`];
  for (let index = 0; index < versions.length; index += 1) {
    const version = versions[index];
    const previous = versions[index + 1];
    if (version === undefined) {
      continue;
    }
    const target =
      previous === undefined
        ? `${REPO}/releases/tag/v${version}`
        : `${REPO}/compare/v${previous}...v${version}`;
    links.push(`[${version}]: ${target}`);
  }
  return `${body}\n${links.join("\n")}\n`;
};

export const releaseTagPending = (
  version: string,
  headSubject: string,
  tagExists: boolean
): boolean => !tagExists && headSubject === `Bump version to ${version}.`;

export const insertRelease = (
  markdown: string,
  version: string,
  date: string
): string => {
  const notes = unreleasedNotes(markdown);
  if (notes === null) {
    throw new Error("Nothing to release. Add notes under ## [Unreleased].");
  }
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`invalid version ${version}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`invalid date ${date}`);
  }
  const lines = markdown.split(/\r?\n/u);
  const bounds = sectionBounds(lines, "unreleased");
  if (bounds === null) {
    throw new Error("CHANGELOG.md is missing ## [Unreleased].");
  }
  const next = [
    ...lines.slice(0, bounds.start),
    "## [Unreleased]",
    "",
    `## [${version}] - ${date}`,
    "",
    ...notes.split("\n"),
    "",
    ...lines.slice(bounds.end),
  ];
  return rebuildFooter(next.join("\n"));
};
