import { describe, expect, test } from "bun:test";

import {
  assignCapture,
  defaultCapture,
  defaultDrawCapture,
  defaultNoteCapture,
  defaultVoiceCapture,
  formatDrawHint,
  formatHold,
  sanitizeDrawCapture,
  sanitizeNoteCapture,
  sanitizeVoiceCapture,
  unusedCapture,
} from "./capture-bind";
import { sanitizeSettings } from "./types";

describe("voice capture bind", () => {
  test("voice starts off, and the first free preset is still Option", () => {
    expect(defaultVoiceCapture()).toEqual([]);
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

  test("draw hint explains the double-tap instead of four keys", () => {
    expect(formatDrawHint(["Mod+Shift", "Mod+Shift"])).toBe(
      "hold ⌘, double-tap ⇧"
    );
    expect(formatDrawHint(["Mod+K"])).toBe("⌘ K");
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
  test("draw starts off", () => {
    expect(defaultDrawCapture()).toEqual([]);
  });

  test("a colliding draw chord turns off", () => {
    expect(
      sanitizeDrawCapture(
        ["Shift", "Shift"],
        ["Shift", "Shift"],
        ["Option", "Option"]
      )
    ).toEqual([]);
  });

  test("settings keep a distinct draw chord", () => {
    const next = sanitizeSettings({
      capture: ["Mod+Shift", "Mod+Shift"],
      drawCapture: ["Mod+Shift", "Mod+Shift"],
    });
    expect(next.drawCapture).not.toEqual(next.capture);
  });
});

describe("note capture bind", () => {
  test("note starts off", () => {
    expect(defaultNoteCapture()).toEqual([]);
  });

  test("a colliding note chord turns off", () => {
    expect(
      sanitizeNoteCapture(
        ["Control", "Control"],
        ["Shift", "Shift"],
        ["Option", "Option"],
        ["Control", "Control"]
      )
    ).toEqual([]);
  });

  test("new settings keep selection and annotate, and the rest off", () => {
    const next = sanitizeSettings({});
    expect(next.capture).toEqual(["Shift", "Shift"]);
    expect(next.voiceCapture).toEqual([]);
    expect(next.drawCapture).toEqual([]);
    expect(next.noteCapture).toEqual([]);
    expect(next.annotateOut).toEqual(["Control+Option+A"]);
    expect(next.dictateCapture).toEqual([]);
    expect(next.cleanTranscripts).toBe(true);
    expect(
      sanitizeSettings({ dictateCapture: ["Control+Option+Space"] })
        .dictateCapture
    ).toEqual(["Control+Option+Space"]);
    expect(next.keepDictations).toBe(false);
    const collided = sanitizeSettings({
      capture: ["Control", "Control"],
      noteCapture: ["Control", "Control"],
    });
    expect(collided.capture).toEqual(["Control", "Control"]);
    expect(collided.noteCapture).toEqual([]);
  });

  test("editing one chord keeps the others distinct", () => {
    const next = assignCapture(
      {
        annotateOut: ["Control+Option+A"],
        capture: ["Shift", "Shift"],
        dictateCapture: ["Control+Option+Space"],
        drawCapture: ["Mod+Shift", "Mod+Shift"],
        noteCapture: ["Control", "Control"],
        voiceCapture: ["Option", "Option"],
      },
      "noteCapture",
      ["Shift", "Shift"]
    );
    expect(next.noteCapture).toEqual(["Shift", "Shift"]);
    const chords = [
      next.capture,
      next.voiceCapture,
      next.drawCapture,
      next.noteCapture,
    ].map((seq) => seq.join("|"));
    expect(new Set(chords).size).toBe(4);
  });
});
