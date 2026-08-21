export const SHORTCUT_IDS = [
  "archive",
  "copy",
  "dismiss",
  "done",
  "extendNext",
  "extendPrev",
  "focusNext",
  "focusPrev",
  "palette",
  "selectAll",
  "toggleMark",
  "undo",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export type Shortcuts = Record<ShortcutId, string>;

export const defaultShortcuts = (): Shortcuts => ({
  archive: "Mod+E",
  copy: "Enter",
  dismiss: "Escape",
  done: "Space",
  extendNext: "Shift+ArrowDown",
  extendPrev: "Shift+ArrowUp",
  focusNext: "ArrowDown",
  focusPrev: "ArrowUp",
  palette: "Mod+K",
  selectAll: "Mod+A",
  toggleMark: "X",
  undo: "Mod+Z",
});

export const SHORTCUT_META: {
  id: ShortcutId;
  label: string;
}[] = [
  { id: "palette", label: "Command palette" },
  { id: "undo", label: "Undo" },
  { id: "dismiss", label: "Dismiss" },
  { id: "focusNext", label: "Next slip" },
  { id: "focusPrev", label: "Previous slip" },
  { id: "extendNext", label: "Extend down" },
  { id: "extendPrev", label: "Extend up" },
  { id: "copy", label: "Copy" },
  { id: "done", label: "Done" },
  { id: "toggleMark", label: "Mark" },
  { id: "archive", label: "Archive" },
  { id: "selectAll", label: "Select all" },
];

export const sanitizeShortcuts = (raw: unknown): Shortcuts => {
  const defaults = defaultShortcuts();
  if (raw === null || typeof raw !== "object") {
    return defaults;
  }
  const input = raw as Partial<Record<string, unknown>>;
  const next = { ...defaults };
  for (const id of SHORTCUT_IDS) {
    const value = input[id];
    if (typeof value === "string" && value.length > 0 && value.length < 48) {
      next[id] = value;
    }
  }
  return next;
};
