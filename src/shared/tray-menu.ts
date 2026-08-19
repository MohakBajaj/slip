import { titleOf } from "./format";
import { visibleSlips, whenLabel } from "./logic";
import type { Slip } from "./types";

export const TRAY_PREVIEW = 8;
export const TRAY_TITLE = 42;

export const trayOpen = (slips: Slip[]): Slip[] =>
  visibleSlips(slips, "", false, false);

export const trayShown = (
  slips: Slip[],
  limit = TRAY_PREVIEW
): { hidden: number; open: number; shown: Slip[] } => {
  const open = trayOpen(slips);
  return {
    hidden: Math.max(0, open.length - limit),
    open: open.length,
    shown: open.slice(0, limit),
  };
};

export const clipMenu = (text: string, max = TRAY_TITLE): string => {
  const next = text.replaceAll(/\s+/gu, " ").trim();
  if (next.length <= max) {
    return next;
  }
  return `${next.slice(0, max - 1).trimEnd()}…`;
};

export const trayLabel = (slip: Slip): string => {
  const title = titleOf(slip.content);
  return clipMenu(slip.pin ? `✦ ${title}` : title);
};

export const trayTip = (slip: Slip, now = Date.now()): string => {
  const when = whenLabel(slip.createdAt, now);
  const where = slip.section || "Inbox";
  const preview = slip.content.replaceAll(/\s+/gu, " ").trim().slice(0, 160);
  if (!preview) {
    return `${where} · ${when}`;
  }
  return `${where} · ${when}\n${preview}`;
};

export const trayHead = (open: number): string =>
  open > 0 ? `${open} open` : "Nothing captured yet";
