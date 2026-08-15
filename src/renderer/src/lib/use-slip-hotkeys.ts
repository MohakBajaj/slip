import { normalizeHotkey, useHotkeys } from "@tanstack/react-hotkeys";

import { neighborId, rangeIds } from "@/lib/range-ids";

import type { Shortcuts } from "../../../shared/shortcuts";

const typingIn = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, [contenteditable=true]"));
};

const inControl = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest("[data-slip-row]")) {
    return false;
  }
  return Boolean(
    target.closest("button, input, textarea, [contenteditable=true]")
  );
};

export const runMenuCommand = (
  name: string,
  actions: {
    copy_as_list: () => void;
    copy_as_prompt: () => void;
    merge: () => void;
    palette: () => void;
    settings: () => void;
    undo: () => void;
  }
): void => {
  if (name === "settings") {
    actions.settings();
  }
  if (name === "palette") {
    actions.palette();
  }
  if (name === "copy_as_list") {
    actions.copy_as_list();
  }
  if (name === "copy_as_prompt") {
    actions.copy_as_prompt();
  }
  if (name === "merge") {
    actions.merge();
  }
  if (name === "undo") {
    actions.undo();
  }
};

export const useSlipHotkeys = ({
  focused,
  listIds,
  marked,
  onArchive,
  onCopy,
  onPalette,
  onToggleDone,
  onUndo,
  paletteOpen,
  paused,
  setFocused,
  setMarked,
  setQuery,
  setSettingsOpen,
  settingsOpen,
  shortcuts,
}: {
  focused: string | null;
  listIds: string[];
  marked: string[];
  onArchive: () => void;
  onCopy: () => void;
  onPalette: () => void;
  onToggleDone: () => void;
  onUndo: () => void;
  paletteOpen: boolean;
  paused: boolean;
  setFocused: (id: string | null) => void;
  setMarked: (ids: string[]) => void;
  setQuery: (query: string) => void;
  setSettingsOpen: (open: boolean) => void;
  settingsOpen: boolean;
  shortcuts: Shortcuts;
}): void => {
  const listOn = !(paused || paletteOpen || settingsOpen);
  const move = (delta: number, extend: boolean): void => {
    const next = neighborId(listIds, focused, delta);
    if (next === null) {
      return;
    }
    if (extend) {
      const anchor = focused ?? marked[0] ?? next;
      setFocused(next);
      setMarked(rangeIds(listIds, anchor, next));
      return;
    }
    setFocused(next);
    setMarked([]);
  };

  useHotkeys(
    [
      {
        callback: onUndo,
        hotkey: normalizeHotkey(shortcuts.undo),
        options: { enabled: !paused, requireReset: true },
      },
      {
        callback: onPalette,
        hotkey: normalizeHotkey(shortcuts.palette),
        options: { enabled: !paused, requireReset: true },
      },
      {
        callback: (event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("[data-search]")
          ) {
            event.preventDefault();
            setQuery("");
            return;
          }
          if (typingIn(event.target) || paletteOpen) {
            return;
          }
          event.preventDefault();
          if (settingsOpen) {
            setSettingsOpen(false);
            return;
          }
          if (marked.length > 0) {
            setMarked([]);
            return;
          }
          if (focused !== null) {
            setFocused(null);
          }
        },
        hotkey: normalizeHotkey(shortcuts.dismiss),
        options: {
          enabled: !paused,
          ignoreInputs: false,
          preventDefault: false,
          requireReset: true,
        },
      },
      {
        callback: () => {
          setMarked(listIds);
        },
        hotkey: normalizeHotkey(shortcuts.selectAll),
        options: { enabled: listOn, requireReset: true },
      },
      {
        callback: onArchive,
        hotkey: normalizeHotkey(shortcuts.archive),
        options: { enabled: listOn, requireReset: true },
      },
      {
        callback: () => {
          move(1, false);
        },
        hotkey: normalizeHotkey(shortcuts.focusNext),
        options: { enabled: listOn },
      },
      {
        callback: () => {
          move(-1, false);
        },
        hotkey: normalizeHotkey(shortcuts.focusPrev),
        options: { enabled: listOn },
      },
      {
        callback: () => {
          move(1, true);
        },
        hotkey: normalizeHotkey(shortcuts.extendNext),
        options: { enabled: listOn },
      },
      {
        callback: () => {
          move(-1, true);
        },
        hotkey: normalizeHotkey(shortcuts.extendPrev),
        options: { enabled: listOn },
      },
      {
        callback: () => {
          if (inControl(document.activeElement) || focused === null) {
            return;
          }
          onCopy();
        },
        hotkey: normalizeHotkey(shortcuts.copy),
        options: { enabled: listOn, requireReset: true },
      },
      {
        callback: () => {
          if (inControl(document.activeElement) || focused === null) {
            return;
          }
          onToggleDone();
        },
        hotkey: normalizeHotkey(shortcuts.done),
        options: { enabled: listOn, requireReset: true },
      },
      {
        callback: () => {
          if (
            inControl(document.activeElement) ||
            focused === null ||
            settingsOpen
          ) {
            return;
          }
          setMarked(
            marked.includes(focused)
              ? marked.filter((id) => id !== focused)
              : [...marked, focused]
          );
        },
        hotkey: normalizeHotkey(shortcuts.toggleMark),
        options: { enabled: listOn, requireReset: true },
      },
    ],
    { conflictBehavior: "replace", ignoreInputs: true }
  );
};
