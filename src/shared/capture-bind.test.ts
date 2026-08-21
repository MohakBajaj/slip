import { describe, expect, test } from "bun:test";

import {
  defaultCapture,
  defaultDrawCapture,
  defaultVoiceCapture,
  formatHold,
  sanitizeDrawCapture,
  sanitizeVoiceCapture,
  unusedCapture,
} from "./capture-bind";
import { sanitizeSettings } from "./types";

describe("voice capture bind", () => {
  test("default voice chord is the first unused preset", () => {
    expect(defaultVoiceCapture()).toEqual(["Option", "Option"]);
    expect(unusedCapture(defaultCapture())).toEqual(["Option", "Option"]);
  });

  test("colliding voice chord moves to the next preset", () => {
    expect(
      sanitizeVoiceCapture(["Shift", "Shift"], ["Shift", "Shift"])
    ).toEqual(["Option", "Option"]);
    expect(
      sanitizeVoiceCapture(["Option", "Option"], ["Option", "Option"])
    ).toEqual(["Shift", "Shift"]);
  });

  test("hold label uses the first modifier", () => {
    expect(formatHold(["Option", "Option"])).toBe("hold ⌥");
    expect(formatHold(["Mod+Shift+V"])).toBe("hold ⌘ ⇧ V");
  });

  test("settings keep a distinct voice chord", () => {
    const next = sanitizeSettings({
      capture: ["Option", "Option"],
      voiceCapture: ["Option", "Option"],
    });
    expect(next.capture).toEqual(["Option", "Option"]);
    expect(next.voiceCapture).toEqual(["Shift", "Shift"]);
  });
});

describe("draw capture bind", () => {
  test("default draw chord is command plus shift twice", () => {
    expect(defaultDrawCapture()).toEqual(["Mod+Shift", "Mod+Shift"]);
  });

  test("draw chord yields when it matches capture", () => {
    expect(
      sanitizeDrawCapture(
        ["Shift", "Shift"],
        ["Shift", "Shift"],
        ["Option", "Option"]
      )
    ).toEqual(["Mod+Shift", "Mod+Shift"]);
  });

  test("settings keep a distinct draw chord", () => {
    const next = sanitizeSettings({
      capture: ["Mod+Shift", "Mod+Shift"],
      drawCapture: ["Mod+Shift", "Mod+Shift"],
    });
    expect(next.drawCapture).not.toEqual(next.capture);
  });
});
