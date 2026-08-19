import { describe, expect, test } from "bun:test";

import { createVoiceHold } from "./capture-hold";
import { FLAG_COMMAND, FLAG_OPTION, FLAG_SHIFT } from "./capture-match";

describe("voice hold", () => {
  test("Option down arms, up before start disarms", () => {
    const hold = createVoiceHold(["Option", "Option"]);
    expect(hold.push({ flags: FLAG_OPTION, type: "flags" })).toBe("arm");
    expect(hold.push({ flags: 0, type: "flags" })).toBe("disarm");
  });

  test("release after start ends", () => {
    const hold = createVoiceHold(["Option", "Option"]);
    expect(hold.push({ flags: FLAG_OPTION, type: "flags" })).toBe("arm");
    hold.markStarted();
    expect(hold.push({ flags: 0, type: "flags" })).toBe("end");
  });

  test("a real key while Option is down is not talk", () => {
    const hold = createVoiceHold(["Option", "Option"]);
    expect(hold.push({ flags: FLAG_OPTION, type: "flags" })).toBe("arm");
    expect(hold.push({ code: 0x0e, flags: FLAG_OPTION, type: "key" })).toBe(
      "disarm"
    );
  });

  test("a real key after start cancels", () => {
    const hold = createVoiceHold(["Option", "Option"]);
    expect(hold.push({ flags: FLAG_OPTION, type: "flags" })).toBe("arm");
    hold.markStarted();
    expect(hold.push({ code: 0x0e, flags: FLAG_OPTION, type: "key" })).toBe(
      "cancel"
    );
  });

  test("device bits are ignored", () => {
    const hold = createVoiceHold(["Option", "Option"]);
    expect(hold.push({ flags: FLAG_OPTION | 0x01, type: "flags" })).toBe("arm");
  });

  test("a key chord arms on the key", () => {
    const hold = createVoiceHold(["Mod+Shift+V"]);
    expect(
      hold.push({
        code: 0x09,
        flags: FLAG_COMMAND | FLAG_SHIFT,
        type: "key",
      })
    ).toBe("arm");
    hold.markStarted();
    expect(hold.push({ flags: FLAG_SHIFT, type: "flags" })).toBe("end");
  });
});
