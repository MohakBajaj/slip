import { describe, expect, test } from "bun:test";

import { matchesKeyboardEvent, normalizeHotkey } from "@tanstack/hotkeys";

import {
  CHEATSHEET,
  defaultShortcuts,
  matchableHotkey,
  menuAccelerator,
  sanitizeShortcuts,
  searchEscape,
  SHORTCUT_ALIASES,
  SHORTCUT_CORE,
  shortcutInField,
  shortcutLabel,
  shortcutTip,
} from "./shortcuts";

if (typeof globalThis.KeyboardEvent !== "function") {
  globalThis.KeyboardEvent = class KeyboardEvent extends Event {
    readonly altKey: boolean;
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly key: string;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;

    constructor(
      _type: string,
      init: Partial<{
        altKey: boolean;
        code: string;
        ctrlKey: boolean;
        key: string;
        metaKey: boolean;
        shiftKey: boolean;
      }> = {}
    ) {
      super("keydown");
      this.altKey = init.altKey ?? false;
      this.code = init.code ?? "";
      this.ctrlKey = init.ctrlKey ?? false;
      this.key = init.key ?? "";
      this.metaKey = init.metaKey ?? false;
      this.shiftKey = init.shiftKey ?? false;
    }
  } as unknown as typeof KeyboardEvent;
}

const press = (init: {
  code: string;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent => new KeyboardEvent("keydown", init);

describe("shortcuts", () => {
  test("defaults and aliases do not share a key", () => {
    const seen = new Set<string>();
    const own = Object.entries(defaultShortcuts());
    for (const [id, hotkey] of own) {
      const key = hotkey.toLowerCase();
      if (key.length === 0) {
        continue;
      }
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      for (const alias of SHORTCUT_ALIASES[
        id as keyof typeof SHORTCUT_ALIASES
      ] ?? []) {
        const aliasKey = alias.toLowerCase();
        expect(seen.has(aliasKey)).toBe(false);
        seen.add(aliasKey);
      }
    }
  });

  test("labels read as macOS keys", () => {
    const shortcuts = defaultShortcuts();
    expect(shortcutLabel(shortcuts.delete)).toBe("⌘⌫");
    expect(shortcutLabel(shortcuts.search)).toBe("⌘F");
    expect(shortcutLabel(shortcuts.settings)).toBe("⌘,");
    expect(shortcutLabel(shortcuts.compose)).toBe("⌘N");
    expect(shortcutLabel(shortcuts.open)).toBe("↩");
    expect(shortcutLabel(shortcuts.dismiss)).toBe("Esc");
    expect(shortcutLabel(shortcuts.cheatsheet)).toBe("?");
    expect(shortcutLabel("Mod+Slash")).toBe("⌘/");
    expect(shortcutLabel(shortcuts.focusNext)).toBe("↓");
    expect(shortcutLabel("Space")).toBe("Space");
    expect(shortcutTip("Copy", "")).toBe("Copy");
  });

  test("single keys stay out of text fields", () => {
    const shortcuts = defaultShortcuts();
    expect(shortcutInField(shortcuts.archive)).toBe(false);
    expect(shortcutInField(shortcuts.delete)).toBe(false);
    expect(shortcutInField(shortcuts.undo)).toBe(false);
    expect(shortcutInField(shortcuts.selectAll)).toBe(false);
    expect(shortcutInField(shortcuts.search)).toBe(true);
    expect(shortcutInField(shortcuts.compose)).toBe(true);
    expect(shortcutInField(shortcuts.settings)).toBe(true);
    expect(shortcutInField("Mod+Slash")).toBe(true);
    expect(shortcutInField(shortcuts.dismiss)).toBe(true);
  });

  test("legacy copy and archive defaults move forward", () => {
    const next = sanitizeShortcuts({
      archive: "Mod+E",
      copy: "Enter",
      done: "D",
    });
    expect(next.archive).toBe("E");
    expect(next.copy).toBe("");
    expect(next.open).toBe("Enter");
    expect(next.done).toBe("D");
    expect(next.delete).toBe("Mod+Backspace");
  });

  test("retired single-key defaults unbind and a custom one stays", () => {
    const next = sanitizeShortcuts({
      annotate: "A",
      copy: "C",
      done: "Space",
      edit: "Q",
      pin: "P",
      toggleMark: "X",
    });
    expect(next.annotate).toBe("");
    expect(next.copy).toBe("");
    expect(next.done).toBe("");
    expect(next.pin).toBe("");
    expect(next.toggleMark).toBe("");
    expect(next.edit).toBe("Q");
  });

  test("menu accelerators use Electron names", () => {
    const shortcuts = defaultShortcuts();
    expect(menuAccelerator(shortcuts.delete)).toBe("Command+Backspace");
    expect(menuAccelerator(shortcuts.open)).toBe("Return");
    expect(menuAccelerator(shortcuts.settings)).toBe("Command+,");
    expect(menuAccelerator(shortcuts.focusNext)).toBe("Down");
  });

  test("slash and comma names match the keys the browser sends", () => {
    const question = press({ code: "Slash", key: "?", shiftKey: true });
    const commandSlash = press({ code: "Slash", key: "/", metaKey: true });
    const commandComma = press({ code: "Comma", key: ",", metaKey: true });
    expect(
      matchesKeyboardEvent(
        question,
        normalizeHotkey(matchableHotkey("Shift+Slash"), "mac"),
        "mac"
      )
    ).toBe(true);
    expect(
      matchesKeyboardEvent(
        commandSlash,
        normalizeHotkey(matchableHotkey("Mod+Slash"), "mac"),
        "mac"
      )
    ).toBe(true);
    expect(
      matchesKeyboardEvent(
        commandComma,
        normalizeHotkey(matchableHotkey("Mod+Comma"), "mac"),
        "mac"
      )
    ).toBe(true);
    expect(
      matchesKeyboardEvent(
        question,
        normalizeHotkey("Shift+Slash", "mac"),
        "mac"
      )
    ).toBe(false);
  });

  test("escape clears a search query before it blurs the field", () => {
    expect(searchEscape("draft")).toBe("clear");
    expect(searchEscape("")).toBe("blur");
  });

  test("cheatsheet is the core set", () => {
    const shown = CHEATSHEET.flatMap((group) =>
      group.rows.map((row) => row.id)
    );
    expect(shown).toEqual([...SHORTCUT_CORE]);
    expect(shown).not.toContain("done");
    expect(shown).not.toContain("pin");
  });
});
