import { normalizeHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { useRef } from "react";

import { moveListCursor } from "../../../shared/list-cursor";
import {
  SHORTCUT_ALIASES,
  matchableHotkey,
  searchEscape,
  shortcutInField,
} from "../../../shared/shortcuts";
import type { ShortcutId, Shortcuts } from "../../../shared/shortcuts";

const searchField = (target: EventTarget | null): HTMLInputElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const field = target.closest("[data-search]");
  return field instanceof HTMLInputElement ? field : null;
};

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
    cheatsheet: () => void;
    compose: () => void;
    copy_as_list: () => void;
    copy_as_prompt: () => void;
    merge: () => void;
    palette: () => void;
    search: () => void;
    settings: () => void;
    undo: () => void;
    voice: () => void;
    zoom_in: () => void;
    zoom_out: () => void;
    zoom_reset: () => void;
  }
): void => {
  const run: Record<string, () => void> = actions;
  run[name]?.();
};

const keysFor = (id: ShortcutId, shortcuts: Shortcuts): string[] => [
  shortcuts[id],
  ...(SHORTCUT_ALIASES[id] ?? []),
];

export const useSlipHotkeys = ({
  binding,
  editing,
  focused,
  helpOpen,
  listIds,
  marked,
  onAnnotate,
  onArchive,
  onCheatsheet,
  onCompose,
  onCopy,
  onDelete,
  onEdit,
  onOpen,
  onPalette,
  onPin,
  onSearch,
  onSettings,
  onToggleDone,
  onUndo,
  paletteOpen,
  setFocused,
  setHelpOpen,
  setMarked,
  setQuery,
  setSettingsOpen,
  settingsOpen,
  shortcuts,
}: {
  binding: boolean;
  editing: boolean;
  focused: string | null;
  helpOpen: boolean;
  listIds: string[];
  marked: string[];
  onAnnotate: () => void;
  onArchive: () => void;
  onCheatsheet: () => void;
  onCompose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onPalette: () => void;
  onPin: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onToggleDone: () => void;
  onUndo: () => void;
  paletteOpen: boolean;
  setFocused: (id: string | null) => void;
  setHelpOpen: (open: boolean) => void;
  setMarked: (ids: string[]) => void;
  setQuery: (query: string) => void;
  setSettingsOpen: (open: boolean) => void;
  settingsOpen: boolean;
  shortcuts: Shortcuts;
}): (() => void) => {
  const anchor = useRef<string | null>(null);
  const held = binding || editing;
  const listOn = !(held || paletteOpen || settingsOpen || helpOpen);
  const move = (delta: number, extend: boolean): void => {
    const next = moveListCursor(
      listIds,
      { anchor: anchor.current, focused, marked },
      delta,
      extend
    );
    anchor.current = next.anchor;
    if (next.focused !== focused) {
      setFocused(next.focused);
    }
    if (extend && next.marked !== marked) {
      setMarked(next.marked);
    }
  };
  const slipKey = (run: () => void) => (): void => {
    if (inControl(document.activeElement)) {
      return;
    }
    run();
  };

  const bind = (
    id: ShortcutId,
    callback: () => void,
    options: UseHotkeyDefinition["options"]
  ): UseHotkeyDefinition[] =>
    keysFor(id, shortcuts).map((hotkey) => ({
      callback,
      hotkey: normalizeHotkey(matchableHotkey(hotkey)),
      options: {
        ...options,
        ignoreInputs: !shortcutInField(hotkey),
      },
    }));

  useHotkeys(
    [
      ...bind("undo", onUndo, { enabled: !held, requireReset: true }),
      ...bind("palette", onPalette, { enabled: !binding, requireReset: true }),
      ...bind("search", onSearch, { enabled: !binding, requireReset: true }),
      ...bind("compose", onCompose, { enabled: !binding, requireReset: true }),
      ...bind("settings", onSettings, {
        enabled: !binding,
        requireReset: true,
      }),
      ...bind("cheatsheet", onCheatsheet, {
        enabled: !binding,
        requireReset: true,
      }),
      {
        callback: (event) => {
          const field = searchField(event.target);
          if (field !== null) {
            event.preventDefault();
            if (searchEscape(field.value) === "clear") {
              setQuery("");
              return;
            }
            field.blur();
            return;
          }
          if (typingIn(event.target) || paletteOpen) {
            return;
          }
          event.preventDefault();
          if (helpOpen) {
            setHelpOpen(false);
            return;
          }
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
        hotkey: normalizeHotkey(matchableHotkey(shortcuts.dismiss)),
        options: {
          enabled: !binding,
          ignoreInputs: false,
          preventDefault: false,
          requireReset: true,
        },
      },
      ...bind(
        "selectAll",
        () => {
          setMarked(listIds);
        },
        { enabled: listOn, requireReset: true }
      ),
      ...bind("archive", slipKey(onArchive), {
        enabled: listOn,
        requireReset: true,
      }),
      ...bind("delete", slipKey(onDelete), {
        enabled: listOn,
        requireReset: true,
      }),
      ...bind("copy", slipKey(onCopy), { enabled: listOn, requireReset: true }),
      ...bind("done", slipKey(onToggleDone), {
        enabled: listOn,
        requireReset: true,
      }),
      ...bind("pin", slipKey(onPin), { enabled: listOn, requireReset: true }),
      ...bind("edit", slipKey(onEdit), { enabled: listOn, requireReset: true }),
      ...bind("annotate", slipKey(onAnnotate), {
        enabled: listOn,
        requireReset: true,
      }),
      ...bind(
        "open",
        slipKey(() => {
          onOpen();
        }),
        { enabled: listOn, requireReset: true }
      ),
      ...bind(
        "toggleMark",
        () => {
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
        { enabled: listOn, requireReset: true }
      ),
      ...bind(
        "focusNext",
        () => {
          move(1, false);
        },
        { enabled: listOn }
      ),
      ...bind(
        "focusPrev",
        () => {
          move(-1, false);
        },
        { enabled: listOn }
      ),
      ...bind(
        "extendNext",
        () => {
          move(1, true);
        },
        { enabled: listOn }
      ),
      ...bind(
        "extendPrev",
        () => {
          move(-1, true);
        },
        { enabled: listOn }
      ),
    ],
    { conflictBehavior: "replace", ignoreInputs: true }
  );

  return () => {
    anchor.current = null;
  };
};
