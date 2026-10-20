export const SHORTCUT_IDS = [
  "annotate",
  "archive",
  "cheatsheet",
  "compose",
  "copy",
  "delete",
  "dismiss",
  "done",
  "edit",
  "extendNext",
  "extendPrev",
  "focusNext",
  "focusPrev",
  "open",
  "palette",
  "pin",
  "search",
  "selectAll",
  "settings",
  "toggleMark",
  "undo",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export type Shortcuts = Record<ShortcutId, string>;

export const defaultShortcuts = (): Shortcuts => ({
  annotate: "A",
  archive: "E",
  cheatsheet: "Shift+Slash",
  compose: "Mod+N",
  copy: "C",
  delete: "Mod+Backspace",
  dismiss: "Escape",
  done: "Space",
  edit: "I",
  extendNext: "Shift+ArrowDown",
  extendPrev: "Shift+ArrowUp",
  focusNext: "ArrowDown",
  focusPrev: "ArrowUp",
  open: "Enter",
  palette: "Mod+K",
  pin: "P",
  search: "Mod+F",
  selectAll: "Mod+A",
  settings: "Mod+Comma",
  toggleMark: "X",
  undo: "Mod+Z",
});

// Fixed aliases. Arrows stay rebindable; j/k and ⌘/ stay put.
export const SHORTCUT_ALIASES: Partial<Record<ShortcutId, readonly string[]>> =
  {
    cheatsheet: ["Mod+Slash"],
    extendNext: ["Shift+J"],
    extendPrev: ["Shift+K"],
    focusNext: ["J"],
    focusPrev: ["K"],
  };

const LEGACY_SHORTCUTS: Partial<Shortcuts> = {
  archive: "Mod+E",
  copy: "Enter",
};

export const SHORTCUT_META: {
  id: ShortcutId;
  label: string;
}[] = [
  { id: "focusNext", label: "Next slip" },
  { id: "focusPrev", label: "Previous slip" },
  { id: "extendNext", label: "Extend down" },
  { id: "extendPrev", label: "Extend up" },
  { id: "open", label: "Open" },
  { id: "dismiss", label: "Close" },
  { id: "done", label: "Done" },
  { id: "pin", label: "Pin" },
  { id: "archive", label: "Archive" },
  { id: "edit", label: "Edit" },
  { id: "annotate", label: "Annotate" },
  { id: "copy", label: "Copy" },
  { id: "delete", label: "Delete" },
  { id: "toggleMark", label: "Select" },
  { id: "compose", label: "New slip" },
  { id: "search", label: "Search" },
  { id: "palette", label: "Commands" },
  { id: "settings", label: "Settings" },
  { id: "cheatsheet", label: "Shortcuts" },
  { id: "undo", label: "Undo" },
  { id: "selectAll", label: "Select all" },
];

export interface CheatRow {
  alias?: string;
  id: ShortcutId;
  label: string;
}

export const CHEATSHEET: { rows: CheatRow[]; title: string }[] = [
  {
    rows: [
      { alias: "J", id: "focusNext", label: "Next" },
      { alias: "K", id: "focusPrev", label: "Previous" },
      { alias: "Shift+J", id: "extendNext", label: "Extend down" },
      { alias: "Shift+K", id: "extendPrev", label: "Extend up" },
      { id: "open", label: "Open" },
      { id: "dismiss", label: "Close" },
    ],
    title: "Move",
  },
  {
    rows: [
      { id: "done", label: "Done" },
      { id: "pin", label: "Pin" },
      { id: "archive", label: "Archive" },
      { id: "edit", label: "Edit" },
      { id: "annotate", label: "Annotate" },
      { id: "copy", label: "Copy" },
      { id: "delete", label: "Delete" },
      { id: "toggleMark", label: "Select" },
    ],
    title: "Slip",
  },
  {
    rows: [
      { id: "compose", label: "New slip" },
      { id: "search", label: "Search" },
      { id: "palette", label: "Commands" },
      { id: "settings", label: "Settings" },
      { alias: "Mod+Slash", id: "cheatsheet", label: "This list" },
      { id: "undo", label: "Undo" },
      { id: "selectAll", label: "Select all" },
    ],
    title: "App",
  },
];

const MOD_LABEL: Record<string, string> = {
  Alt: "⌥",
  Command: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Meta: "⌘",
  Mod: "⌘",
  Option: "⌥",
  Shift: "⇧",
};

const KEY_LABEL: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "⌫",
  Comma: ",",
  Delete: "⌦",
  Enter: "↩",
  Escape: "Esc",
  Slash: "/",
  Space: "Space",
};

export const shortcutLabel = (hotkey: string): string => {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const mods = parts.slice(0, -1);
  if (mods.length === 1 && mods[0] === "Shift" && key === "Slash") {
    return "?";
  }
  return [
    ...mods.map((mod) => MOD_LABEL[mod] ?? mod),
    KEY_LABEL[key] ?? key,
  ].join("");
};

export const shortcutTip = (label: string, hotkey: string): string =>
  `${label} · ${shortcutLabel(hotkey)}`;

// Text-editing chords stay with the field. Other ⌘ chords work while typing.
const FIELD_KEYS = new Set(["A", "Backspace", "C", "V", "X", "Z"]);

export const shortcutInField = (hotkey: string): boolean => {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const mods = new Set(parts.slice(0, -1));
  if (key === "Escape") {
    return true;
  }
  if (!mods.has("Mod") && !mods.has("Meta") && !mods.has("Command")) {
    return false;
  }
  return !FIELD_KEYS.has(key);
};

export const menuAccelerator = (hotkey: string): string =>
  hotkey
    .split("+")
    .map((part) => {
      if (part === "Mod" || part === "Meta") {
        return "Command";
      }
      if (part === "ArrowDown") {
        return "Down";
      }
      if (part === "ArrowUp") {
        return "Up";
      }
      if (part === "ArrowLeft") {
        return "Left";
      }
      if (part === "ArrowRight") {
        return "Right";
      }
      if (part === "Enter") {
        return "Return";
      }
      if (part === "Slash") {
        return "/";
      }
      if (part === "Comma") {
        return ",";
      }
      return part;
    })
    .join("+");

export const sanitizeShortcuts = (raw: unknown): Shortcuts => {
  const defaults = defaultShortcuts();
  if (raw === null || typeof raw !== "object") {
    return defaults;
  }
  const input = raw as Partial<Record<string, unknown>>;
  const next = { ...defaults };
  for (const id of SHORTCUT_IDS) {
    const value = input[id];
    if (typeof value !== "string" || value.length === 0 || value.length >= 48) {
      continue;
    }
    const legacy = LEGACY_SHORTCUTS[id];
    next[id] = legacy === value ? defaults[id] : value;
  }
  return next;
};
