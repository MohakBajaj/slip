import { describe, expect, test } from "bun:test";

import { CAPTURE_PRESETS } from "./capture-bind";
import {
  createCaptureMatcher,
  FLAG_COMMAND,
  FLAG_CONTROL,
  FLAG_OPTION,
  FLAG_SHIFT,
  KEYCODES,
} from "./capture-match";

const tapMod = (
  matcher: ReturnType<typeof createCaptureMatcher>,
  mask: number
): boolean[] => [
  matcher.push({ flags: mask, type: "flags" }),
  matcher.push({ flags: 0, type: "flags" }),
];

const doubleTap = (
  matcher: ReturnType<typeof createCaptureMatcher>,
  mask: number
): boolean => {
  tapMod(matcher, mask);
  const second = tapMod(matcher, mask);
  return second[1];
};

describe("capture matcher", () => {
  test("default Shift Shift fires on the second release", () => {
    const matcher = createCaptureMatcher(["Shift", "Shift"]);
    expect(tapMod(matcher, FLAG_SHIFT)).toEqual([false, false]);
    expect(tapMod(matcher, FLAG_SHIFT)).toEqual([false, true]);
  });

  const PRESET_MASK = {
    Command: FLAG_COMMAND,
    Control: FLAG_CONTROL,
    Option: FLAG_OPTION,
    Shift: FLAG_SHIFT,
  } as const;

  test.each(CAPTURE_PRESETS)("$label $label fires", (preset) => {
    const matcher = createCaptureMatcher(preset.sequence);
    expect(doubleTap(matcher, PRESET_MASK[preset.label])).toBe(true);
  });

  test("switching presets keeps matching the new chord only", () => {
    const matcher = createCaptureMatcher(["Shift", "Shift"]);
    expect(doubleTap(matcher, FLAG_SHIFT)).toBe(true);
    matcher.setSequence(["Option", "Option"]);
    expect(doubleTap(matcher, FLAG_SHIFT)).toBe(false);
    expect(doubleTap(matcher, FLAG_OPTION)).toBe(true);
    matcher.setSequence(["Control", "Control"]);
    expect(doubleTap(matcher, FLAG_OPTION)).toBe(false);
    expect(doubleTap(matcher, FLAG_CONTROL)).toBe(true);
    matcher.setSequence(["Command", "Command"]);
    expect(doubleTap(matcher, FLAG_CONTROL)).toBe(false);
    expect(doubleTap(matcher, FLAG_COMMAND)).toBe(true);
  });

  test("stale first tap does not fire", () => {
    let t = 0;
    const matcher = createCaptureMatcher(["Shift", "Shift"], {
      now: () => t,
      windowMs: 400,
    });
    tapMod(matcher, FLAG_SHIFT);
    t = 400;
    expect(tapMod(matcher, FLAG_SHIFT)).toEqual([false, false]);
    expect(tapMod(matcher, FLAG_SHIFT)).toEqual([false, true]);
  });

  test("modifier keycodes do not reset a Shift sequence", () => {
    const matcher = createCaptureMatcher(["Shift", "Shift"]);
    tapMod(matcher, FLAG_SHIFT);
    expect(matcher.push({ code: 0x38, flags: 0, type: "key" })).toBe(false);
    expect(tapMod(matcher, FLAG_SHIFT)).toEqual([false, true]);
  });

  test("a real key after the first Shift resets", () => {
    const matcher = createCaptureMatcher(["Shift", "Shift"]);
    tapMod(matcher, FLAG_SHIFT);
    expect(matcher.push({ code: KEYCODES.A, flags: 0, type: "key" })).toBe(
      false
    );
    expect(tapMod(matcher, FLAG_SHIFT)).toEqual([false, false]);
  });

  test("Mod+C fires on the key, not the command flag", () => {
    const matcher = createCaptureMatcher(["Mod+C"]);
    expect(matcher.needsKeys()).toBe(true);
    expect(matcher.push({ flags: FLAG_COMMAND, type: "flags" })).toBe(false);
    expect(
      matcher.push({
        code: KEYCODES.C,
        flags: FLAG_COMMAND,
        type: "key",
      })
    ).toBe(true);
  });

  test("Mod+Shift+C requires both modifiers", () => {
    const matcher = createCaptureMatcher(["Mod+Shift+C"]);
    expect(
      matcher.push({
        code: KEYCODES.C,
        flags: FLAG_COMMAND,
        type: "key",
      })
    ).toBe(false);
    expect(
      matcher.push({
        code: KEYCODES.C,
        flags: FLAG_COMMAND | FLAG_SHIFT,
        type: "key",
      })
    ).toBe(true);
  });

  test("Shift+~ twice matches the backtick key with shift", () => {
    const matcher = createCaptureMatcher(["Shift+~", "Shift+~"]);
    expect(matcher.needsKeys()).toBe(true);
    const hit = {
      code: KEYCODES["`"],
      flags: FLAG_SHIFT,
      type: "key" as const,
    };
    expect(matcher.push(hit)).toBe(false);
    expect(matcher.push(hit)).toBe(true);
  });

  test("Shift+Backquote compiles to the same key as Shift+~", () => {
    const matcher = createCaptureMatcher(["Shift+Backquote"]);
    expect(matcher.needsKeys()).toBe(true);
    expect(
      matcher.push({
        code: KEYCODES["`"],
        flags: FLAG_SHIFT,
        type: "key",
      })
    ).toBe(true);
  });

  test("unknown key falls back to Shift Shift", () => {
    const matcher = createCaptureMatcher(["Mod+F20"]);
    expect(matcher.needsKeys()).toBe(false);
    expect(doubleTap(matcher, FLAG_SHIFT)).toBe(true);
  });

  test("Mod+Shift twice is command held and shift tapped twice", () => {
    const matcher = createCaptureMatcher(["Mod+Shift", "Mod+Shift"]);
    expect(matcher.needsKeys()).toBe(false);
    expect(matcher.push({ flags: FLAG_COMMAND, type: "flags" })).toBe(false);
    expect(
      matcher.push({ flags: FLAG_COMMAND | FLAG_SHIFT, type: "flags" })
    ).toBe(false);
    expect(matcher.push({ flags: FLAG_COMMAND, type: "flags" })).toBe(false);
    expect(
      matcher.push({ flags: FLAG_COMMAND | FLAG_SHIFT, type: "flags" })
    ).toBe(false);
    expect(matcher.push({ flags: FLAG_COMMAND, type: "flags" })).toBe(true);
  });

  test("Mod+Shift does not fire on a bare Shift Shift", () => {
    const matcher = createCaptureMatcher(["Mod+Shift", "Mod+Shift"]);
    expect(doubleTap(matcher, FLAG_SHIFT)).toBe(false);
    expect(doubleTap(matcher, FLAG_SHIFT)).toBe(false);
  });

  test("releasing command after the first Mod+Shift resets", () => {
    const matcher = createCaptureMatcher(["Mod+Shift", "Mod+Shift"]);
    matcher.push({ flags: FLAG_COMMAND, type: "flags" });
    matcher.push({ flags: FLAG_COMMAND | FLAG_SHIFT, type: "flags" });
    matcher.push({ flags: FLAG_COMMAND, type: "flags" });
    expect(matcher.push({ flags: 0, type: "flags" })).toBe(false);
    matcher.push({ flags: FLAG_COMMAND, type: "flags" });
    matcher.push({ flags: FLAG_COMMAND | FLAG_SHIFT, type: "flags" });
    expect(matcher.push({ flags: FLAG_COMMAND, type: "flags" })).toBe(false);
  });

  test("device bits on flags are ignored", () => {
    const matcher = createCaptureMatcher(["Option", "Option"]);
    expect(matcher.push({ flags: FLAG_OPTION | 0x20, type: "flags" })).toBe(
      false
    );
    expect(matcher.push({ flags: 0, type: "flags" })).toBe(false);
    expect(matcher.push({ flags: FLAG_OPTION | 0x20, type: "flags" })).toBe(
      false
    );
    expect(matcher.push({ flags: 0, type: "flags" })).toBe(true);
  });
});
