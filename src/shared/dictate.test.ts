import { describe, expect, test } from "bun:test";

import {
  dictateHold,
  dictateToggle,
  NOTICE_DISMISS_MS,
  noticeLine,
  voiceReplySettles,
} from "./dictate";

describe("dictate after a notice", () => {
  test("a copied notice or an error settles the session", () => {
    expect(
      voiceReplySettles({
        error: "",
        notice: "Copied. Allow Accessibility to paste.",
      })
    ).toBe(true);
    expect(
      voiceReplySettles({ error: "Could not transcribe", notice: "" })
    ).toBe(true);
    expect(voiceReplySettles({ error: "", notice: "" })).toBe(false);
  });

  test("the hotkey restarts a settled pill instead of committing", () => {
    const settled = { open: true, settled: true, window: true };
    expect(dictateToggle(settled)).toBe("restart");
    expect(dictateHold({ out: true, settled: true, window: true })).toBe(
      "restart"
    );
    expect(dictateToggle({ open: true, settled: false, window: true })).toBe(
      "commit"
    );
    expect(dictateToggle({ open: false, settled: false, window: false })).toBe(
      "start"
    );
  });

  test("the notice shows the cost and closes itself", () => {
    expect(noticeLine("Copied. Allow Accessibility to paste.", "$0.01")).toBe(
      "Copied. Allow Accessibility to paste. · $0.01"
    );
    expect(noticeLine("Copied. Allow Accessibility to paste.", "")).toBe(
      "Copied. Allow Accessibility to paste."
    );
    expect(NOTICE_DISMISS_MS).toBe(6000);
  });
});
