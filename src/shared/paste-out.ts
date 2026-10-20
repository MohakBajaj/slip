import type { PasteSnap } from "./capture-clip";

/** Time for the focused app to read the clipboard before we put the old one back. */
export const PASTE_SETTLE_MS = 120;

export interface PastePorts {
  paste: () => boolean;
  read: () => PasteSnap;
  restore: (snap: PasteSnap) => void;
  trusted: boolean;
  wait: (ms: number) => Promise<void>;
  writeText: (text: string) => void;
}

export type PasteOutcome = "copied" | "empty" | "pasted";

export const pasteIntoFocus = async (
  text: string,
  ports: PastePorts
): Promise<PasteOutcome> => {
  const body = text.trim();
  if (body.length === 0) {
    return "empty";
  }
  if (!ports.trusted) {
    ports.writeText(body);
    return "copied";
  }
  const before = ports.read();
  ports.writeText(body);
  let posted = false;
  try {
    posted = ports.paste();
  } catch {
    posted = false;
  }
  if (!posted) {
    return "copied";
  }
  await ports.wait(PASTE_SETTLE_MS);
  ports.restore(before);
  return "pasted";
};

export const annotatePlan = (hasImage: boolean): "clipboard" | "region" =>
  hasImage ? "clipboard" : "region";

export const regionFileOk = (code: number | null, size: number): boolean =>
  code === 0 && size > 0;
