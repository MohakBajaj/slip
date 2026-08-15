import { titleOf } from "./format";
import type { Slip } from "./types";

export type InboxRow =
  | { kind: "header"; key: string; name: string }
  | { kind: "slip"; key: string; slip: Slip };

export const visibleSlips = (
  slips: Slip[],
  query: string,
  showDone: boolean,
  showArchived: boolean
): Slip[] => {
  const q = query.trim().toLowerCase();
  return slips
    .filter((slip) => (showArchived ? slip.archived : !slip.archived))
    .filter((slip) => showDone || !slip.done)
    .filter((slip) => {
      if (!q) {
        return true;
      }
      return (
        titleOf(slip.content).toLowerCase().includes(q) ||
        slip.content.toLowerCase().includes(q) ||
        slip.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        slip.section.toLowerCase().includes(q) ||
        slip.source.toLowerCase().includes(q)
      );
    })
    .toSorted((a, b) => {
      if (a.pin !== b.pin) {
        return a.pin ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
};

export const sectionsOf = (slips: Slip[]): string[] =>
  [...new Set(slips.map((slip) => slip.section).filter(Boolean))].toSorted();

export const groupedRows = (slips: Slip[]): InboxRow[] => {
  const rows: InboxRow[] = [];
  for (const slip of slips) {
    if (slip.section.length > 0 || slip.done) {
      continue;
    }
    rows.push({ key: slip.id, kind: "slip", slip });
  }
  for (const slip of slips) {
    if (slip.section.length > 0 || !slip.done) {
      continue;
    }
    rows.push({ key: slip.id, kind: "slip", slip });
  }
  const seen: string[] = [];
  for (const slip of slips) {
    if (slip.section.length === 0 || seen.includes(slip.section)) {
      continue;
    }
    seen.push(slip.section);
    rows.push({
      key: `h:${slip.section}`,
      kind: "header",
      name: slip.section,
    });
    for (const member of slips) {
      if (member.section !== slip.section || member.done) {
        continue;
      }
      rows.push({ key: member.id, kind: "slip", slip: member });
    }
    for (const member of slips) {
      if (member.section !== slip.section || !member.done) {
        continue;
      }
      rows.push({ key: member.id, kind: "slip", slip: member });
    }
  }
  return rows;
};

export const slipIdsOf = (rows: InboxRow[]): string[] =>
  rows.flatMap((row) => (row.kind === "slip" ? [row.slip.id] : []));

export const whenLabel = (iso: string, now = Date.now()): string => {
  const then = Date.parse(iso);
  if (!then) {
    return "";
  }
  const elapsed = Math.max(0, (now - then) / 1000);
  if (elapsed < 5) {
    return "just now";
  }
  if (elapsed < 60) {
    return `${Math.trunc(elapsed)} sec ago`;
  }
  if (elapsed < 3600) {
    return `${Math.trunc(elapsed / 60)} min ago`;
  }
  if (elapsed < 86_400) {
    return `${Math.trunc(elapsed / 3600)} hr ago`;
  }
  if (elapsed < 172_800) {
    return "yesterday";
  }
  return new Date(then).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
};
